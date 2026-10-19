/** Animation Studio + Facebook AI jobs: storyboard logic, audio graph, Veo first/last frame, job builders. No network. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { audioMixPlan, continuityIssues, dialogueTimeline, firstFrameFor, nextAction, toSavePayload, toScenario, type ShotRow } from '../../lib/animation/storyboard.ts';
import { validateScenario } from '../../lib/animation/scenario.ts';
import { animationError } from '../../lib/animation/errors.ts';
import { segmentAudioGraph } from '../../lib/video/plan.ts';
import { veoAdapter } from '../../lib/providers/adapters/veo.ts';
import { ProviderError, validateRequest, type VideoRequest } from '../../lib/providers/contracts.ts';
import { clipRequest, JOB_FLAG, JOB_STAGE, keyframeRequest, placeVoiceLines, socialRequest, validateSocialInput, voiceLines } from '../../lib/ai/jobs.ts';
import { mockTextAdapter } from '../../lib/providers/mocks.ts';
import type { FetchLike } from '../../lib/providers/http.ts';

const shot = (n: number, extra: Partial<ShotRow> = {}): ShotRow => ({
  id: `00000000-0000-0000-0000-00000000000${n}`, shot_number: n, duration_seconds: 8, description: '[d]', environment: '[e]', camera: '[c]', characters: ['limo_man'], actions: { limo_man: '[a]' },
  expressions: {}, dialogue: [{ speaker: 'limo_man', text: 'un deux trois' }], narration: '', sound: '', continuity: {}, reference_asset_ids: ['r1'], status: 'draft',
  keyframe_asset_id: null, first_frame_asset_id: null, last_frame_asset_id: null, clip_asset_id: null, voice_tracks: [], clip_audio: 'keep', revision: 1, last_error: null, ...extra,
});
const project = { title: '[t]', language_code: 'fr' as const, aspect: '9:16' as const, music_note: '', music_asset_id: null, settings: { voice_mode: 'separate' as const } };

test('storyboard rows ⇄ scenario: same validation as the planner; save payload carries only editable fields', () => {
  const shots = [shot(2), shot(1, { duration_seconds: 6 })];
  const sc = toScenario(project, shots);
  assert.deepEqual(sc.scenes.map((s) => s.number), [1, 2]);
  assert.equal(validateScenario(sc).filter((i) => i.level === 'error').length, 0);
  const payload = toSavePayload([{ ...shot(1), status: 'approved', clip_asset_id: 'x' }]);
  assert.equal('status' in payload[0]!, false);
  assert.equal('clip_asset_id' in payload[0]!, false);
  assert.equal(payload[0]!.duration_seconds, 8);
});

test('dialogue timeline: planned from text when no audio exists, measured from voice tracks, positioned in the whole video', () => {
  const planned = dialogueTimeline([shot(1, { narration: 'bonjour à tous' }), shot(2)]);
  assert.equal(planned.length, 3);
  assert.deepEqual([planned[0]!.kind, planned[0]!.start_ms, planned[0]!.measured], ['narration', 300, false]);
  assert.equal(planned[2]!.start_ms, 8000 + 300, 'second shot starts after 8 s');
  const measured = dialogueTimeline([shot(1, { voice_tracks: [{ line: 0, speaker: 'limo_man', asset_id: 'v', offset_ms: 500, duration_ms: 1200 }] })]);
  assert.deepEqual([measured[0]!.start_ms, measured[0]!.end_ms, measured[0]!.measured], [500, 1700, true]);
});

test('continuity checks: speech overrun, missing previous last frame, changed location, missing references', () => {
  const long = shot(1, { duration_seconds: 4, dialogue: [{ speaker: 'limo_man', text: Array(30).fill('mot').join(' ') }] });
  const codes = continuityIssues([long, shot(2, { continuity: { use_previous_last_frame: true, continues_from_previous: true, environment_key: 'kitchen' }, reference_asset_ids: [] })]).map((i) => i.code);
  assert.ok(codes.includes('speech_overruns_shot'));
  assert.ok(codes.includes('previous_last_frame_missing'));
  assert.ok(codes.includes('reference_missing'));
  const loc = continuityIssues([shot(1, { continuity: { environment_key: 'street' } }), shot(2, { continuity: { continues_from_previous: true, environment_key: 'kitchen' } })]).map((i) => i.code);
  assert.ok(loc.includes('continuity_environment_changed'));
  assert.deepEqual(continuityIssues([shot(1)]), []);
});

test('first frame, next action and audio mix plan', () => {
  const prev = shot(1, { last_frame_asset_id: 'last-1' });
  assert.equal(firstFrameFor(shot(2, { keyframe_asset_id: 'k2', continuity: { use_previous_last_frame: true } }), prev), 'last-1');
  assert.equal(firstFrameFor(shot(2, { keyframe_asset_id: 'k2', first_frame_asset_id: 'f2' }), prev), 'f2');
  assert.deepEqual(['draft', 'keyframe_queued', 'keyframe_review', 'keyframe_approved', 'clip_review', 'approved'].map((s) => nextAction({ status: s as ShotRow['status'] })), ['request_keyframe', 'wait', 'review_keyframe', 'request_clip', 'review_clip', 'done']);
  const mix = audioMixPlan({ music_asset_id: 'm' }, [shot(1, { clip_audio: 'mute', voice_tracks: [{ line: 0, speaker: 'limo_man', asset_id: 'v', offset_ms: 300, duration_ms: 900 }] }), shot(2)]);
  assert.deepEqual(mix.shots.map((s) => [s.start_ms, s.clip_audio_volume, s.layers.length]), [[0, 0, 1], [8000, 1, 0]]);
  assert.equal(mix.total_ms, 16000);
  assert.deepEqual(mix.music, { asset_id: 'm', volume: 0.25 });
});

test('segment audio graph: unchanged for normal exports; clip sound and delayed voice layers mixed for animation', () => {
  assert.equal(segmentAudioGraph(4, { clipAudioVolume: null, layers: [] }), '[2:a]aresample=48000,aformat=channel_layouts=stereo,apad,atrim=0:4,asetpts=PTS-STARTPTS[aout]');
  const g = segmentAudioGraph(8, { clipAudioVolume: 0.8, layers: [{ input: 3, offset_ms: 1500, volume: 1 }] });
  assert.match(g, /\[0:a\]aresample=48000,aformat=channel_layouts=stereo,volume=0\.8/);
  assert.match(g, /\[3:a\].*adelay=1500\|1500/);
  assert.match(g, /\[main\]\[clip\]\[l0\]amix=inputs=3:duration=first:normalize=0,atrim=0:8\[aout\]/);
  assert.doesNotMatch(segmentAudioGraph(8, { clipAudioVolume: 0, layers: [] }), /\[0:a\]/, 'muted clip sound is not mixed');
});

test('Veo first + last frame: lastFrame sent with image; refused without a first frame or with reference images', async () => {
  const calls: Array<{ body: any }> = [];
  const fetch: FetchLike = async (_u, init = {}) => {
    calls.push({ body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify({ name: 'models/veo-3.1-fast-generate-preview/operations/op9' }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const loadAsset = async (id: string) => ({ bytes: new TextEncoder().encode(id), mime: 'image/png' });
  const a = veoAdapter({ apiKey: 'k', fetch, tier: 'fast', loadAsset });
  const req: VideoRequest = { requestKey: 'k1', organizationId: 'o', locale: 'fr', kind: 'video', prompt: 'p', firstFrameAssetId: 'first', lastFrameAssetId: 'last', references: [], durationSeconds: 8, videoTotalSeconds: 30, aspect: '9:16', scriptRevisionId: 'r' };
  await a.submit(req, new AbortController().signal);
  assert.ok(calls[0]!.body.instances[0].image.inlineData);
  assert.equal(Buffer.from(calls[0]!.body.instances[0].lastFrame.inlineData.data, 'base64').toString(), 'last');
  assert.deepEqual(validateRequest({ ...req, firstFrameAssetId: null }), ['a last frame needs a first frame']);
  await assert.rejects(a.submit({ ...req, references: [{ character: 'limo_man', specVersion: 1, assetIds: ['r'] }] }, new AbortController().signal), (e: unknown) => e instanceof ProviderError && /either reference images or first \+ last frame/.test(e.message));
  assert.equal(calls.length, 1, 'refused requests are never sent');
});

test('job builders: keyframe uses approved references (identity lock), clip uses the approved first frame, voices need a voice identity', () => {
  const k = keyframeRequest(shot(1, { reference_asset_ids: ['f', 'q'] }), project, 'org', 'key');
  assert.equal(k.kind, 'character_image');
  assert.deepEqual(k.kind === 'character_image' ? k.references[0]!.assetIds : [], ['f', 'q']);
  assert.match(k.prompt, /LIMO adult man/);
  assert.match(k.prompt, /FIRST FRAME/);
  assert.deepEqual(k.size, { width: 1080, height: 1920 });
  assert.equal(keyframeRequest(shot(1, { characters: [], reference_asset_ids: [] }), { ...project, aspect: '16:9' }, 'org', 'key').kind, 'image');
  const c = clipRequest(shot(1, { last_frame_asset_id: 'L' }), project, 'org', 'key', 'F', 'L', 30);
  assert.deepEqual([c.firstFrameAssetId, c.lastFrameAssetId, c.durationSeconds, c.videoTotalSeconds], ['F', 'L', 8, 30]);
  assert.match(c.prompt, /voice added separately/);
  const v = voiceLines(shot(1, { narration: 'intro' }), 'fr', {}, 'Kore', 'org');
  assert.deepEqual(v.map((x) => [x.speaker, x.missingVoice]), [['narrator', false], ['limo_man', true]]);
  assert.deepEqual(placeVoiceLines([1000, 500]), [300, 1550]);
  assert.equal(JOB_FLAG.social_image, 'ai_social_images');
  assert.equal(JOB_STAGE.animation_clip, 'scene_video');
});

test('social jobs: validation, caption facts + brand, rewrite modes, image size; mock output is clearly labelled', async () => {
  assert.deepEqual(validateSocialInput('social_caption', { language: 'fr', prompt: '' }), ['prompt_required']);
  assert.deepEqual(validateSocialInput('social_rewrite', { language: 'fr', text: 'x', mode: 'translate' }), ['target_language']);
  assert.deepEqual(validateSocialInput('social_image', { language: 'xx' as never, prompt: 'p', aspect: '3:2' as never }), ['language', 'aspect']);
  const cap = socialRequest('social_caption', { language: 'ar', prompt: 'menu', business_type: 'restaurant', facts: { business_name: 'Chez Amina', price: '' }, brand: { name: 'Amina', cta: 'Réservez' } }, 'o', 'k');
  assert.equal(cap.kind === 'text' && cap.task, 'post_caption');
  assert.deepEqual(cap.kind === 'text' ? cap.facts : {}, { business_name: 'Chez Amina', brand: 'Amina', call_to_action: 'Réservez' });
  assert.match(cap.kind === 'text' ? cap.instructions : '', /Arabic/);
  const tr = socialRequest('social_rewrite', { language: 'fr', text: 'Bonjour', mode: 'translate', target_language: 'de' }, 'o', 'k');
  assert.equal(tr.locale, 'de');
  const img = socialRequest('social_image', { language: 'fr', prompt: 'couscous', aspect: '4:5', brand: { primary: '#7157ef' } }, 'o', 'k');
  assert.deepEqual(img.kind === 'image' ? img.size : null, { width: 1080, height: 1350 });
  assert.match(img.kind === 'image' ? img.prompt : '', /#7157ef/);
  const mock = await mockTextAdapter().run(cap as never, new AbortController().signal);
  assert.match(String(mock.json?.caption), /^\[Mock AI caption — no AI was used\]/);
  const rw = await mockTextAdapter().run(tr as never, new AbortController().signal);
  assert.equal(rw.json?.text, '[Mock rewrite — no AI was used] Bonjour');
});

test('database errors map to stable API codes', () => {
  assert.deepEqual(animationError('Videos are limited to 30 seconds'), { code: 'video_too_long', status: 400 });
  assert.deepEqual(animationError('AI animation is not enabled'), { code: 'not_enabled', status: 403 });
  assert.deepEqual(animationError('Character limo_man is not ready: missing_front'), { code: 'character_not_ready', status: 409 });
  assert.deepEqual(animationError('No generated clip to approve'), { code: 'nothing_to_review', status: 409 });
  assert.deepEqual(animationError('something odd'), { code: 'unavailable', status: 500 });
});
