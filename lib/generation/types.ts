/**
 * Provider-agnostic generation contracts.
 *
 * The database (generation_runs / generation_run_stages / ai_provider_registry) owns the job
 * lifecycle, budget reservation and audit trail. Adapters only translate one stage request into
 * one provider call. No adapter may be called unless `assertLiveGenerationAllowed` passes.
 */
export type StageType = 'safety' | 'script' | 'voice' | 'scene_image' | 'scene_video' | 'render' | 'export';

export type TaskStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';

export interface ProviderCapabilities {
  stage: StageType;
  /** Provider accepts a reference image to keep a character's appearance stable. */
  referenceImages: boolean;
  maxDurationSeconds?: number;
  /** Provider returns a task id that must be polled (or delivered via webhook). */
  asynchronous: boolean;
}

export interface StageRequest {
  /** Idempotency key: generation run id + stage key. Providers must not be called twice for the same key. */
  requestKey: string;
  organizationId: string;
  stage: StageType;
  prompt: string;
  durationSeconds?: number;
  /** Canonical character reference assets (storage paths). Required for scene_image/scene_video with characters. */
  referenceAssets?: string[];
  aspectRatio?: string;
}

export interface CostEstimate {
  cents: number;
  basis: string;
}

export interface SubmitResult {
  taskId: string;
  status: TaskStatus;
}

export interface PollResult {
  status: TaskStatus;
  /** Storage path or provider URL of the produced asset when succeeded. */
  outputUrl?: string;
  errorCode?: string;
  actualCostCents?: number;
}

export interface ProviderAdapter {
  readonly code: string;
  readonly paid: boolean;
  readonly capabilities: ProviderCapabilities;
  estimate(req: StageRequest): CostEstimate;
  submit(req: StageRequest): Promise<SubmitResult>;
  poll(taskId: string): Promise<PollResult>;
}
