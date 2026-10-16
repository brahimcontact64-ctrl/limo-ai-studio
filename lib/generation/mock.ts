import type { PollResult, ProviderAdapter, StageRequest, StageType, SubmitResult } from './types.ts';

/**
 * Deterministic, free provider for development and tests. Tasks complete after `pollsToComplete`
 * polls; prompts containing "[mock:fail]" fail with a provider error so retry/failure paths can be tested.
 * Never makes network calls.
 */
export class MockProvider implements ProviderAdapter {
  readonly paid = false;
  readonly code: string;
  readonly capabilities;
  private tasks = new Map<string, { req: StageRequest; polls: number }>();
  private byKey = new Map<string, string>();
  private readonly pollsToComplete: number;

  constructor(stage: StageType, pollsToComplete = 2) {
    this.pollsToComplete = pollsToComplete;
    this.code = `mock_${stage}_v1`;
    this.capabilities = { stage, referenceImages: true, maxDurationSeconds: 15, asynchronous: true };
  }

  estimate(req: StageRequest) {
    return { cents: 0, basis: `mock:${req.stage}` };
  }

  async submit(req: StageRequest): Promise<SubmitResult> {
    const existing = this.byKey.get(req.requestKey);
    if (existing) return { taskId: existing, status: 'queued' }; // idempotent
    if (this.capabilities.maxDurationSeconds && (req.durationSeconds ?? 0) > this.capabilities.maxDurationSeconds) {
      throw new Error('duration_exceeds_provider_limit');
    }
    const taskId = `mock-${this.tasks.size + 1}-${req.requestKey}`;
    this.tasks.set(taskId, { req, polls: 0 });
    this.byKey.set(req.requestKey, taskId);
    return { taskId, status: 'queued' };
  }

  async poll(taskId: string): Promise<PollResult> {
    const task = this.tasks.get(taskId);
    if (!task) return { status: 'failed', errorCode: 'unknown_task' };
    task.polls += 1;
    if (task.req.prompt.includes('[mock:fail]')) return { status: 'failed', errorCode: 'mock_provider_error', actualCostCents: 0 };
    if (task.polls < this.pollsToComplete) return { status: 'running' };
    const ext = task.req.stage === 'scene_image' ? 'png' : task.req.stage === 'voice' ? 'mp3' : task.req.stage === 'script' ? 'json' : 'mp4';
    return { status: 'succeeded', outputUrl: `mock://${task.req.organizationId}/${task.req.requestKey}.${ext}`, actualCostCents: 0 };
  }
}
