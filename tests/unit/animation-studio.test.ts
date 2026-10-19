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

// ---- quality gate (2026-10-19) ----------------------------------------------------------------------------------------
import { clipReview, keyframeReview, lumaSpread, paletteCoverage } from '../../lib/animation/identity.ts';
import { parseScenarioJson } from '../../lib/animation/scenario-import.ts';
import { assemblyGraph, duckFilter, planRender, speechWindows } from '../../lib/video/plan.ts';

const px = (w: number, h: number, f: (x: number, y: number) => [number, number, number]) => {
  const a = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) a.set([...f(x, y), 255], (y * w + x) * 4);
  return a;
};

test('identity checks are deterministic and never a verdict: blank, aspect, palette, references, mock', () => {
  const tomato = px(90, 160, (x) => (x < 45 ? [232, 65, 44] : [62, 155, 63]));
  assert.ok(paletteCoverage(tomato, ['#E8412C'])['#E8412C']! > 0.45);
  assert.equal(lumaSpread(px(10, 10, () => [9, 9, 9])), 0);
  const ok = keyframeReview({ image: { width: 1080, height: 1920, rgba: tomato }, expectedAspect: 9 / 16, characters: [{ id: 'limo_man', lockedColours: ['#E8412C', '#3E9B3F'] }], attachedReferences: ['a', 'b'], usedReferences: ['a', 'b'], mock: false });
  assert.equal(ok.verdict, 'needs_human_review', 'even when every check passes, a person decides');
  assert.ok(ok.checks.every((c) => c.status === 'pass'));
  assert.match(ok.disclaimer, /do not prove/);
  const bad = keyframeReview({ image: { width: 1920, height: 1080, rgba: px(16, 9, () => [20, 20, 200]) }, expectedAspect: 9 / 16, characters: [{ id: 'limo_man', lockedColours: ['#E8412C'] }, { id: 'custom:x', lockedColours: [] }], attachedReferences: ['a'], usedReferences: [], mock: true });
  const st = Object.fromEntries(bad.checks.map((c) => [c.code, c.status]));
  assert.deepEqual(st, { mock_output: 'warn', not_blank: 'fail', aspect_matches_shot: 'fail', 'palette:limo_man': 'warn', 'palette:custom:x': 'not_applicable', references_used: 'warn' });
  assert.equal(keyframeReview({ image: null, expectedAspect: 1, characters: [], attachedReferences: [], usedReferences: [], mock: false }).checks[0]!.status, 'fail');
});

test('clip review separates real animation from mock and never measures motion or lip-sync', () => {
  const mock = clipReview({ mock: true, hasFile: false, mime: null, expectedSeconds: 8, reportedSeconds: null, firstFrameUsed: true });
  assert.equal(mock.animated, false);
  assert.equal(mock.checks.find((c) => c.code === 'animated_file')!.status, 'fail');
  const real = clipReview({ mock: false, hasFile: true, mime: 'video/mp4', expectedSeconds: 8, reportedSeconds: 8, firstFrameUsed: true });
  assert.equal(real.animated, true);
  assert.equal(real.checks.find((c) => c.code === 'motion_and_lip_sync')!.status, 'not_applicable');
  assert.equal(real.verdict, 'needs_human_review');
});

test('scenario import: the owner template fills shots; problems are listed, nothing is invented', () => {
  const ok = parseScenarioJson(JSON.stringify({ title: '[t]', language: 'ar', aspect: '16:9', music: '[m]', scenes: [{ number: 1, durationSeconds: 8, description: '[d]', environment: '[e]', characters: ['limo_man'], actions: { limo_man: '[a]', ghost: 'x' }, expressions: { limo_man: 'happy' }, camera: '[c]', dialogue: [{ speaker: 'limo_man', text: '[l]', emotion: 'happy' }], narration: '[n]', sound: '[s]' }] }));
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.scenario!.language, 'ar');
  assert.deepEqual(ok.scenario!.shots[0]!.actions, { limo_man: '[a]' }, 'actions only for characters in the scene');
  assert.equal(ok.scenario!.shots[0]!.dialogue[0]!.emotion, 'happy');
  const bad = parseScenarioJson(JSON.stringify({ scenes: [{ durationSeconds: 5, characters: ['limo_man'], dialogue: [{ speaker: 'nova_girl', text: 'x' }] }, ...Array(4).fill({ durationSeconds: 8 })] }));
  assert.ok(bad.errors.some((e) => /4, 6 or 8/.test(e)));
  assert.ok(bad.errors.some((e) => /nova_girl/.test(e)));
  assert.ok(bad.errors.some((e) => /over the 30 s limit/.test(e)));
  assert.deepEqual(parseScenarioJson('{oops').errors, ['not valid JSON']);
});

test('music ducking: speech windows from narration and voice layers, merged and padded; no windows = no ducking', () => {
  const base = { on_screen_text: '', narration: '', dialogue: '', transition: 'cut' as const, visual: null, fit: 'cover' as const, show_text: false, participants: [] };
  const media = (id: string, ms: number | null) => ({ asset_id: id, path: id, media_type: 'audio' as const, mime: 'audio/wav', width: null, height: null, duration_ms: ms });
  const spec = { scenes: [
    { ...base, scene_number: 1, title: '', duration_ms: 4000, start_ms: 0, audio: media('n', 2000) },
    { ...base, scene_number: 2, title: '', duration_ms: 4000, start_ms: 4000, audio: null, audio_layers: [{ ...media('a', 1000), offset_ms: 300, volume: 1 }, { ...media('b', 1000), offset_ms: 1350, volume: 1 }] },
  ] };
  assert.deepEqual(speechWindows(spec), [[0, 2.15], [4.15, 6.5]], "layer b ends at 4 + 1.35 + 1 = 6.35 s, + 150 ms");
  assert.equal(duckFilter([[0, 2.15]]), "volume='if(gt(between(t,0,2.15),0),0.35,1)':eval=frame");
  assert.equal(duckFilter([]), null);
  const g = assemblyGraph(planRender({ scenes: spec.scenes as never, fps: 24, transition_seconds: 0 }), { volume: 0.3, duck: duckFilter(speechWindows(spec)) });
  assert.match(g, /volume=0\.3,volume='if\(gt\(between\(t,0,2\.15\)\+between\(t,4\.15,6\.5\),0\),0\.35,1\)':eval=frame,afade/);
  assert.doesNotMatch(assemblyGraph(planRender({ scenes: spec.scenes as never, fps: 24, transition_seconds: 0 }), { volume: 0.3 }), /eval=frame/);
});

test('continuity: a character keeps its references across consecutive shots; lighting holds in a continuing shot', () => {
  const owner = { r1: 'limo_man', r2: 'limo_man' };
  const issues = continuityIssues([shot(1, { reference_asset_ids: ['r1'], continuity: { lighting: 'warm' } }), shot(2, { reference_asset_ids: ['r2'], continuity: { continues_from_previous: true, lighting: 'cold' } })], owner).map((i) => i.code);
  assert.ok(issues.includes('character_reference_changed'));
  assert.ok(issues.includes('lighting_changed'));
  assert.deepEqual(continuityIssues([shot(1, { reference_asset_ids: ['r1'] }), shot(2, { reference_asset_ids: ['r1'] })], owner).map((i) => i.code).filter((c) => c === 'character_reference_changed'), []);
});

test('scenario import carries optional continuity metadata and clip sound (never on the first shot\'s "previous")', () => {
  const r = parseScenarioJson(JSON.stringify({ scenes: [
    { durationSeconds: 4, continuity: { continuesFromPrevious: true, environmentKey: 'hall', lighting: 'warm' } },
    { durationSeconds: 4, clipAudio: 'mute', continuity: { continuesFromPrevious: true, usePreviousLastFrame: true, environmentKey: 'hall', notes: 'same moment' } },
  ] }));
  assert.deepEqual(r.scenario!.shots[0]!.continuity, { environment_key: 'hall', lighting: 'warm' }, 'shot 1 has no previous shot');
  assert.deepEqual(r.scenario!.shots[1]!.continuity, { continues_from_previous: true, use_previous_last_frame: true, environment_key: 'hall', notes: 'same moment' });
  assert.equal(r.scenario!.shots[1]!.clip_audio, 'mute');
});

import { rtlVisualRuns } from '../../lib/images/render.ts';
test('server-canvas bidi: RTL lines are laid out run by run (numbers and Latin keep their place in Arabic text)', () => {
  assert.deepEqual(rtlVisualRuns('1,200 دج'), [{ text: 'دج', rtl: true }, { text: '1,200', rtl: false }]);
  assert.deepEqual(rtlVisualRuns('LIMO AI… خيالك، يخدم وحدو!'), [{ text: 'خيالك، يخدم وحدو!', rtl: true }, { text: 'LIMO AI…', rtl: false }]);
  assert.deepEqual(rtlVisualRuns('السعر الحقيقي: 1,200 دج'), [{ text: 'دج', rtl: true }, { text: '1,200', rtl: false }, { text: 'السعر الحقيقي:', rtl: true }]);
  assert.deepEqual(rtlVisualRuns('اصنع. برمج. انشر.'), [{ text: 'اصنع. برمج. انشر.', rtl: true }]);
});

import { ADAM_MAN_FORMAL_ANGRY, variantPrompt } from '../../lib/characters/variants.ts';
import { canonFor, EXPRESSION_KEYS } from '../../lib/characters/canon.ts';
test('father variant is proposed only and never changes the canonical spec', () => {
  assert.equal(ADAM_MAN_FORMAL_ANGRY.status, 'proposed');
  const spec = canonFor('adam_man')!;
  assert.deepEqual(spec.outfits.map((o) => o.key), ['everyday', 'special'], 'canonical outfits unchanged');
  assert.ok(!(EXPRESSION_KEYS as readonly string[]).includes('angry'), 'canonical expressions unchanged');
  const front = variantPrompt(ADAM_MAN_FORMAL_ANGRY, { view: 'front' });
  assert.match(front, /ADAM adult man/);
  assert.match(front, /charcoal three-piece suit/);
  assert.match(front, /scene variant "angry"/);
  assert.match(front, /#C99A62/);
  assert.match(variantPrompt(ADAM_MAN_FORMAL_ANGRY, { view: 'side' }), /Neutral expression/);
});
