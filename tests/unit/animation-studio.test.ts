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
  assert.deepEqual(rtlVisualRuns('تخيّل. صمّم. وجدول.'), [{ text: 'تخيّل. صمّم. وجدول.', rtl: true }]);
});

import { ADAM_MAN_FORMAL_ANGRY, VARIANTS, VARIANT_EXPRESSION_KEYS, approvedVariant, expressionAllowed, variantPrompt, variantSceneText } from '../../lib/characters/variants.ts';
import { canonFor, EXPRESSION_KEYS } from '../../lib/characters/canon.ts';
test('father variant is owner-approved (variant only) and never changes the canonical spec', () => {
  assert.equal(ADAM_MAN_FORMAL_ANGRY.status, 'approved');
  assert.match(ADAM_MAN_FORMAL_ANGRY.approvalNote ?? '', /owner.*2026-10-19.*no artwork approved/);
  assert.equal(ADAM_MAN_FORMAL_ANGRY.key, 'adam_man.formal_angry');
  assert.match(ADAM_MAN_FORMAL_ANGRY.outfit!.accessories.join(' '), /gold wristwatch on the LEFT wrist/);
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

test('variants: the variant expression is allowed only with that approved variant and that character', () => {
  for (const v of VARIANTS) if (v.expression && !(EXPRESSION_KEYS as readonly string[]).includes(v.expression.key)) assert.ok((VARIANT_EXPRESSION_KEYS as readonly string[]).includes(v.expression.key));
  assert.equal(expressionAllowed('angry', undefined, 'adam_man'), false);
  assert.equal(expressionAllowed('angry', 'adam_man.formal_angry', 'adam_man'), true);
  assert.equal(expressionAllowed('angry', 'adam_man.formal_angry', 'adam_boy'), false, 'variant of another character');
  assert.equal(expressionAllowed('happy', undefined, 'adam_boy'), true);
  assert.equal(approvedVariant('adam_man.formal_angry', 'limo_boy'), undefined);
  assert.match(variantSceneText('adam_man.formal_angry', 'adam_man'), /charcoal three-piece suit.*LEFT wrist.*"angry"/);
  assert.equal(variantSceneText(undefined, 'adam_man'), '');
});

import { readFileSync as readFlagship } from 'node:fs';
import { parseScenarioJson as parseFlagship } from '../../lib/animation/scenario-import.ts';
import { validateScenario as validateFlagship, clipPrompt as clipFlagship } from '../../lib/animation/scenario.ts';
import { toScenario as toFlagshipScenario, toSavePayload as toFlagshipPayload } from '../../lib/animation/storyboard.ts';
test('flagship scenario: 30 s, 3 characters, father variant in shot 1, new tagline, valid', () => {
  const { scenario, errors } = parseFlagship(readFlagship('docs/flagship/supernatural-eye.scenario.json', 'utf8'));
  assert.deepEqual(errors, []);
  const shots = scenario!.shots;
  assert.equal(shots.reduce((a, s) => a + s.duration_seconds, 0), 30);
  assert.deepEqual([...new Set(shots.flatMap((s) => s.characters))].sort(), ['adam_boy', 'adam_man', 'limo_boy']);
  assert.deepEqual(shots[0]!.character_variants, { adam_man: 'adam_man.formal_angry' });
  assert.equal(shots[0]!.expressions.adam_man, 'angry');
  assert.ok(shots.slice(1).every((s) => Object.keys(s.character_variants).length === 0));
  assert.equal(shots[5]!.overlays[0]!.text, 'تخيّل. صمّم. وجدول.');
  const raw = readFlagship('docs/flagship/supernatural-eye.scenario.json', 'utf8');
  assert.ok(!raw.includes('اصنع. برمج. انشر.'), 'old tagline removed');
  const rows = shots.map((s, i) => ({ ...s, id: `s${i}`, shot_number: i + 1, status: 'draft' as const, keyframe_asset_id: null, first_frame_asset_id: null, last_frame_asset_id: null, clip_asset_id: null, voice_tracks: [], revision: 1, last_error: null, reference_asset_ids: [] }));
  const sc = toFlagshipScenario({ title: 't', language_code: 'ar', aspect: '9:16', music_note: '' }, rows);
  const errs = validateFlagship(sc).filter((x) => x.level === 'error');
  assert.deepEqual(errs, []);
  assert.match(clipFlagship(sc.scenes[0]!, 'separate'), /charcoal three-piece suit/);
  assert.doesNotMatch(clipFlagship(sc.scenes[1]!, 'separate'), /three-piece suit/);
  assert.deepEqual(toFlagshipPayload(rows)[0]!.character_variants, { adam_man: 'adam_man.formal_angry' });
  // An unapproved variant or its expression without the variant is rejected.
  const bad = parseFlagship(JSON.stringify({ scenes: [{ durationSeconds: 4, characters: ['adam_boy'], variants: { adam_boy: 'adam_man.formal_angry' }, expressions: { adam_boy: 'angry' } }] }));
  assert.ok(bad.errors.some((e) => /not an approved variant/.test(e)));
  assert.deepEqual(bad.scenario!.shots[0]!.expressions, {});
});

import { keyframeRequest as kfVariant } from '../../lib/ai/jobs.ts';
test('generator: the keyframe prompt carries the approved variant of the shot (outfit + expression), canonical otherwise', () => {
  const shot = { id: 'x', shot_number: 1, duration_seconds: 4 as const, description: '[d]', environment: '[e]', camera: '', characters: ['adam_man'], actions: { adam_man: '[a]' }, expressions: { adam_man: 'angry' as const }, character_variants: { adam_man: 'adam_man.formal_angry' }, dialogue: [], narration: '', sound: '', continuity: {}, reference_asset_ids: ['r1'], status: 'draft' as const, keyframe_asset_id: null, first_frame_asset_id: null, last_frame_asset_id: null, clip_asset_id: null, voice_tracks: [], clip_audio: 'keep' as const, revision: 1, last_error: null };
  const req = kfVariant(shot, { aspect: '9:16', language_code: 'ar' }, 'org', 'k');
  assert.match(req.prompt, /charcoal three-piece suit.*gold wristwatch on the LEFT wrist/s);
  assert.match(req.prompt, /Variant expression "angry"/);
  const plain = kfVariant({ ...shot, character_variants: {}, expressions: {} }, { aspect: '9:16', language_code: 'ar' }, 'org', 'k');
  assert.doesNotMatch(plain.prompt, /three-piece suit/);
});

import { ADAM_BOY_SHEETS, artworkPackage } from '../../lib/generation/artwork-package.ts';
import { sheetPrompt as canonicalSheetPrompt } from '../../lib/characters/artwork.ts';
test('adam_boy artwork package: canonical prompts only, front first, others locked to the approved front, manifest in sync', () => {
  const pkg = artworkPackage('adam_boy', ADAM_BOY_SHEETS, '<workspace id>');
  assert.deepEqual(pkg.sheets.map((s) => s.slot), ['view:front', 'view:three_quarter', 'view:side', 'expression:surprised', 'expression:determined']);
  assert.equal(pkg.sheets[0]!.request.kind, 'image');
  assert.equal(pkg.sheets[0]!.request.prompt, canonicalSheetPrompt(canonFor('adam_boy')!, ADAM_BOY_SHEETS[0]!));
  for (const s of pkg.sheets.slice(1)) {
    assert.equal(s.request.kind, 'character_image');
    assert.ok(s.request.prompt.startsWith(canonicalSheetPrompt(canonFor('adam_boy')!, s.sheet)));
    assert.equal(s.needsApprovedFront, true);
  }
  for (const s of pkg.sheets) {
    assert.doesNotMatch(s.request.prompt, /\.\.|\. \(colours/, 'no doubled punctuation');
    assert.equal(s.upload.provenance, 'ai_generated');
    assert.deepEqual(s.request.size, { width: 2048, height: 2731 });
  }
  assert.equal(pkg.priceKey, 'google/gemini-3-pro-image@4K');
  assert.equal(pkg.researchedUsdPerImage, 0.24);
  const manifest = JSON.parse(readFlagship('docs/flagship/packages/adam_boy.artwork.v1.json', 'utf8')) as typeof pkg;
  assert.deepEqual(manifest.sheets.map((s) => [s.slot, s.request.requestKey, s.request.prompt]), pkg.sheets.map((s) => [s.slot, s.request.requestKey, s.request.prompt]), 'manifest regenerated after a prompt change');
});

import { SPEC_REVISIONS, latestSpecVersion, specFor, specRevision, specVersionsOf } from '../../lib/characters/spec-versions.ts';
import { CANON as ALL_CANON } from '../../lib/characters/canon.ts';
import { DESIGN_SOURCE, APPROVED_FRONT } from '../../lib/generation/artwork-package.ts';
test('spec versions: adam_boy v2 is the only new version; v1 and the other 17 characters are unchanged', () => {
  assert.deepEqual(Object.keys(SPEC_REVISIONS), ['adam_boy']);
  assert.equal(ALL_CANON.length, 18);
  for (const c of ALL_CANON) {
    assert.equal(specFor(c.character_id), c, 'no version → v1');
    assert.equal(specFor(c.character_id, 1), c);
    if (c.character_id !== 'adam_boy') assert.deepEqual(specVersionsOf(c.character_id), [1]);
  }
  assert.deepEqual(specVersionsOf('adam_boy'), [1, 2]);
  assert.equal(latestSpecVersion('adam_boy'), 2);
  assert.equal(specFor('adam_boy', 3), undefined);
  const v1 = specFor('adam_boy', 1)!;
  const v2 = specFor('adam_boy', 2)!;
  assert.match(v1.crown, /two-leaf green sprout/i, "v1 kept");
  assert.equal(v2.spec_version, 2);
  assert.equal(v2.species, 'anthropomorphic potato');
  assert.match(v2.crown, /No sprout/);
  assert.match(v2.consistency.identity_prompt, /never a human child/);
  assert.match(v2.surface, /many small natural darker speckles/);
  assert.match(v2.face, /Large expressive eyes with warm-brown irises.*rosy cheeks.*small potato-shaped nose/);
  assert.equal(v2.outfits[0]!.key, 'school');
  assert.match(v2.outfits[0]!.description, /Navy school blazer.*white shirt.*red tie.*brown trousers.*brown leather shoes.*backpack.*potato emblem/);
  assert.equal(v2.personality, 'kind, intelligent, sensitive and brave');
  assert.ok(v2.consistency.negative_prompt.some((n) => /a human child/.test(n)));
  assert.ok(v2.consistency.negative_prompt.some((n) => /only the small decorative potato emblem/.test(n)));
  assert.deepEqual(v2.expressions.map((e) => e.key), [...EXPRESSION_KEYS]);
  const rev = specRevision('adam_boy', 2)!;
  assert.equal(rev.designSource!.sha256, '6ffe3206a853a35933848c65a549051adbe5ccb3e807c2bbc01576d5301fd20a');
  assert.match(rev.designSource!.provenance, /ChatGPT Image Generation/);
  assert.doesNotMatch(rev.designSource!.provenance, /Gemini/);
  assert.match(rev.designSource!.limits, /NOT generated, reviewed or approved/);
  assert.ok(rev.changes.some((c) => /^Crown:/.test(c)) && rev.changes.some((c) => /^Outfit:/.test(c)));
  assert.ok(rev.continuityFlags.some((f) => /adam_man.*v1/.test(f)));
  assert.equal(specFor('adam_man', 1)!.crown, ALL_CANON.find((c) => c.character_id === 'adam_man')!.crown, 'father untouched');
});

test('adam_boy v2 artwork package: design sheet as a source image (never a view), approved front first, manifest in sync', () => {
  const pkg = artworkPackage('adam_boy', ADAM_BOY_SHEETS, '<workspace id>', 2);
  assert.equal(pkg.id, 'adam_boy.artwork.v2');
  assert.equal(pkg.specVersion, 2);
  assert.equal(pkg.designSource!.sha256, '6ffe3206a853a35933848c65a549051adbe5ccb3e807c2bbc01576d5301fd20a');
  const front = pkg.sheets[0]!;
  assert.equal(front.request.kind, 'image');
  assert.deepEqual((front.request as { inputAssetIds: string[] }).inputAssetIds, [DESIGN_SOURCE]);
  assert.match(front.request.prompt, /owner-approved DESIGN SHEET.*output ONE clean single front sheet with no text/);
  assert.match(front.request.prompt, /No sprout/);
  assert.doesNotMatch(front.request.prompt, /two-leaf green sprout/i);
  assert.equal(front.upload.view, 'front');
  for (const s of pkg.sheets.slice(1)) {
    assert.equal(s.request.kind, 'character_image');
    const refs = (s.request as { references: Array<{ specVersion: number; assetIds: string[] }> }).references;
    assert.deepEqual(refs, [{ character: 'adam_boy', specVersion: 2, assetIds: [APPROVED_FRONT, DESIGN_SOURCE] }]);
    assert.match(s.request.prompt, /first attached image is the APPROVED canonical front.*second attached image is the owner-approved DESIGN SHEET/s);
  }
  assert.notEqual(front.request.requestKey, artworkPackage('adam_boy', ADAM_BOY_SHEETS, 'x', 1).sheets[0]!.request.requestKey);
  const manifest = JSON.parse(readFlagship('docs/flagship/packages/adam_boy.artwork.v2.json', 'utf8')) as typeof pkg;
  assert.deepEqual(manifest.sheets.map((s) => [s.slot, s.request.requestKey, s.request.prompt]), pkg.sheets.map((s) => [s.slot, s.request.requestKey, s.request.prompt]));
  assert.equal(artworkPackage('adam_boy', ADAM_BOY_SHEETS, 'x', 1).designSource, null, 'v1 has no design source');
});

test('storyboard spec pins: scenario import, validation, prompts and keyframe requests use each shot\'s version', () => {
  const imp = parseFlagship(JSON.stringify({ scenes: [{ durationSeconds: 4, description: 'd', environment: 'e', characters: ['adam_boy', 'adam_man'], specVersions: { adam_boy: 2 } }, { durationSeconds: 4, characters: ['adam_boy'], specVersions: { adam_boy: 9 } }] }));
  assert.deepEqual(imp.scenario!.shots[0]!.character_spec_versions, { adam_boy: 2 });
  assert.ok(imp.errors.some((e) => /adam_boy has no design spec version 9/.test(e)));
  const base = { id: 'x', shot_number: 1, duration_seconds: 4 as const, description: '[d]', environment: '[e]', camera: '', characters: ['adam_boy'], actions: { adam_boy: '[a]' }, expressions: {}, dialogue: [], narration: '', sound: '', continuity: {}, reference_asset_ids: ['r1'], status: 'draft' as const, keyframe_asset_id: null, first_frame_asset_id: null, last_frame_asset_id: null, clip_asset_id: null, voice_tracks: [], clip_audio: 'keep' as const, revision: 1, last_error: null };
  const v2 = kfVariant({ ...base, character_spec_versions: { adam_boy: 2 } }, { aspect: '9:16', language_code: 'ar' }, 'org', 'k');
  assert.match(v2.prompt, /No sprout/);
  assert.equal((v2 as { references: Array<{ specVersion: number }> }).references[0]!.specVersion, 2);
  const v1 = kfVariant(base, { aspect: '9:16', language_code: 'ar' }, 'org', 'k');
  assert.match(v1.prompt, /two-leaf green sprout/i);
  assert.equal((v1 as { references: Array<{ specVersion: number }> }).references[0]!.specVersion, 1);
  const sc = toFlagshipScenario({ title: 't', language_code: 'ar', aspect: '9:16', music_note: '' }, [{ ...base, character_spec_versions: { adam_boy: 7 } }]);
  assert.ok(validateFlagship(sc).some((i) => i.code === 'spec_version_unknown'));
  assert.deepEqual(toFlagshipPayload([{ ...base, character_spec_versions: { adam_boy: 2 } }])[0]!.character_spec_versions, { adam_boy: 2 });
});

test('adam_boy v2 sheets: school outfit in every prompt, emblem-aware text rule, approved spec JSON unchanged, v1 untouched', () => {
  const v2 = artworkPackage('adam_boy', ADAM_BOY_SHEETS, '', 2);
  assert.equal(v2.primaryOutfit.key, 'school');
  assert.match(v2.textRule!, /only permitted mark is the small decorative potato emblem/);
  assert.match(v2.textRule!, /brand logos or watermarks/);
  for (const s of v2.sheets) {
    assert.match(s.request.prompt, /Navy school blazer.*white shirt.*red tie.*brown trousers.*brown leather shoes.*backpack.*potato emblem/s, s.slot);
    assert.equal((s.request as { textRule?: string }).textRule, v2.textRule);
    assert.equal(s.upload.outfit_key, null, 'views/expressions in the primary outfit carry no outfit key (readiness counts them)');
  }
  assert.ok(!('imageTextRule' in specFor('adam_boy', 2)!), 'the rule lives next to the spec, not inside the approved spec JSON');
  const v1 = artworkPackage('adam_boy', ADAM_BOY_SHEETS, '', 1);
  assert.equal(v1.textRule, null);
  assert.ok(v1.sheets.every((s) => !('textRule' in s.request)));
});
