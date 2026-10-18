import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generationError, proposalItems } from '../../lib/generation/proposals.ts';

test('proposals come only from a completed render stage, per scene, with the recorded decisions', () => {
  const stages = [
    { stage_type: 'render', scene_number: null, status: 'completed', output_asset_id: null, output_payload: { proposal: [{ scene_number: 1, customer_media: 'photo', image_asset_id: null, video_asset_id: 'v1', voice_asset_id: 'a1' }, { scene_number: 2, image_asset_id: 'i2', video_asset_id: null, voice_asset_id: null }] } },
  ];
  const items = proposalItems(stages, [{ scene_number: 2, asset_id: 'i2', decision: 'rejected' }]);
  assert.deepEqual(items, [
    { scene_number: 1, asset_id: 'v1', role: 'video', decision: null },
    { scene_number: 1, asset_id: 'a1', role: 'voice', decision: null },
    { scene_number: 2, asset_id: 'i2', role: 'image', decision: 'rejected' },
  ]);
  assert.deepEqual(proposalItems([{ ...stages[0]!, status: 'processing' }], []), [], 'nothing is proposed before the run finished');
});

test('generation errors map to API codes', () => {
  assert.deepEqual(generationError('Generation providers are not enabled yet: script'), { code: 'not_enabled', status: 409 });
  assert.deepEqual(generationError('Videos are limited to 30 seconds'), { code: 'video_too_long', status: 422 });
  assert.deepEqual(generationError('AI monthly budget exceeded'), { code: 'budget_exceeded', status: 402 });
  assert.deepEqual(generationError('Character visual reference is not configured: limo_boy'), { code: 'missing_reference', status: 409 });
  assert.deepEqual(generationError('Project is not ready for a new generation request'), { code: 'already_generated', status: 409 });
  assert.deepEqual(generationError('This file was not produced by that generation'), { code: 'not_from_generation', status: 422 });
});
