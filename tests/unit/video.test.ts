import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assemblyGraph, fitFilter, musicLoops, planRender, progressSeconds, XFADE } from '../../lib/video/plan.ts';
import { normalizeVideoSettings, renderError } from '../../lib/video/settings.ts';
import { sceneOverlay, subtitleText } from '../../lib/video/overlay.ts';
import { renderSize, type RenderSpec, type SpecScene } from '../../lib/video/types.ts';

const scene = (n: number, ms: number, extra: Partial<SpecScene> = {}): SpecScene => ({
  scene_number: n, title: `S${n}`, duration_ms: ms, start_ms: 0, on_screen_text: '', narration: '', dialogue: '', transition: 'fade',
  visual: { asset_id: `a${n}`, path: 'p', media_type: 'image', mime: 'image/png', width: 10, height: 10, duration_ms: null }, audio: null, fit: 'cover', show_text: true, participants: [], ...extra,
});

test('render sizes match the database (even numbers, all four formats)', () => {
  assert.deepEqual(renderSize('9:16', 1080), { width: 1080, height: 1920 });
  assert.deepEqual(renderSize('16:9', 720), { width: 1280, height: 720 });
  assert.deepEqual(renderSize('1:1', 480), { width: 480, height: 480 });
  assert.deepEqual(renderSize('4:5', 1080), { width: 1080, height: 1350 });
  for (const a of ['9:16', '16:9', '1:1', '4:5'] as const) for (const r of [480, 720, 1080] as const) {
    const s = renderSize(a, r);
    assert.ok(s.width % 2 === 0 && s.height % 2 === 0);
  }
});

test('timeline plan keeps every scene start and the total equal to the approved durations', () => {
  const plan = planRender({ fps: 30, transition_seconds: 0.5, scenes: [scene(1, 3000, { transition: 'cut' }), scene(2, 2500, { transition: 'crossfade' }), scene(3, 4000)] });
  assert.equal(plan.total, 9.5);
  assert.deepEqual(plan.segments.map((s) => s.offset), [3, 5.5, null]);
  assert.equal(plan.segments[0]!.transition, 0.033);
  assert.equal(plan.segments[1]!.transition, 0.5);
  assert.deepEqual(plan.segments.map((s) => s.length), [3.033, 3, 4]);
  assert.equal(plan.segments[1]!.xfade, XFADE.crossfade);
  // A transition is never longer than half of the shorter scene.
  const short = planRender({ fps: 30, transition_seconds: 1.5, scenes: [scene(1, 1000), scene(2, 1000)] });
  assert.equal(short.segments[0]!.transition, 0.5);
  // Output length after chained xfades = sum(segment lengths) − sum(transitions) = total.
  const sum = plan.segments.reduce((a, s) => a + s.length - s.transition, 0);
  assert.ok(Math.abs(sum - plan.total) < 0.001);
});

test('FFmpeg graphs: crossfades chain in scene order; music is trimmed, faded and mixed; finite music loops', () => {
  const plan = planRender({ fps: 30, transition_seconds: 0.5, scenes: [scene(1, 3000), scene(2, 3000), scene(3, 4000)] });
  const g = assemblyGraph(plan, { volume: 0.3 });
  assert.match(g, /\[v0\]\[v1\]xfade=transition=fadeblack:duration=0\.5:offset=3\[vx1\]/);
  assert.match(g, /\[vx1\]\[v2\]xfade=transition=fadeblack:duration=0\.5:offset=6\[vx2\]/);
  assert.match(g, /\[3:a\].*atrim=0:10.*volume=0\.3,afade=t=out:st=8\.5:d=1\.5\[music\]/);
  assert.match(g, /amix=inputs=2:duration=first/);
  assert.doesNotMatch(assemblyGraph(plan, null), /music/);
  assert.equal(musicLoops(10, 4), 2);
  assert.equal(musicLoops(10, 12), 0);
  assert.equal(musicLoops(10, 0), 0);
  assert.match(fitFilter(1080, 1920, 'contain', '#7157ef', 30), /pad=1080:1920:.*color=0x7157ef/);
  assert.match(fitFilter(1080, 1920, 'cover', '#7157ef', 30), /force_original_aspect_ratio=increase,crop=1080:1920/);
  assert.equal(progressSeconds('out_time_us=2500000'), 2.5);
  assert.equal(progressSeconds('frame=10'), null);
});

test('video settings are normalised: unknown values fall back, ids must be UUIDs, limits clamp', () => {
  const s = normalizeVideoSettings({ aspect: '21:9', resolution: 4000, quality: 'ultra', transition: 'spin', transition_seconds: 9, music_asset_id: 'x', music_volume: 3, subtitles: 'all', logo: 'yes', scenes: { '1': { media_asset_id: '11111111-1111-4111-8111-111111111111', fit: 'contain', show_text: false, transition: 'wipe' }, abc: {} } });
  assert.deepEqual([s.aspect, s.resolution, s.quality, s.transition, s.transition_seconds, s.music_asset_id, s.music_volume, s.subtitles, s.logo], ['9:16', 720, 'standard', 'fade', 1.5, null, 1, 'off', false]);
  assert.deepEqual(Object.keys(s.scenes), ['1']);
  assert.deepEqual(s.scenes['1'], { media_asset_id: '11111111-1111-4111-8111-111111111111', fit: 'contain', show_text: false, transition: 'wipe' });
  assert.equal(renderError('Approve the script before exporting a video').code, 'script_not_approved');
  assert.equal(renderError('Too many videos are rendering; wait for one to finish').status, 429);
  assert.equal(renderError('Background music must be an audio file of this workspace').code, 'foreign_asset');
});

test('overlays: approved on-screen text, optional subtitles, logo; scenes without media become text cards', () => {
  const spec = { width: 1080, height: 1920, subtitles: 'narration', text_position: 'bottom', text_size: 'medium', brand: { primary: '#7157ef', secondary: '#211e2b' }, logo: { asset_id: 'logo' } } as unknown as RenderSpec;
  const ctx = { font: '', measureText: (t: string) => ({ width: t.length * 30 }) };
  const withText = sceneOverlay(spec, scene(1, 3000, { on_screen_text: '2 400 DA', narration: 'Meet our serum.' }), ctx);
  assert.equal(withText.background.kind, 'color');
  const texts = withText.layers.filter((l) => l.type === 'text').map((l) => (l as { content: string }).content);
  assert.deepEqual(texts, ['Meet our serum.', '2 400 DA']);
  assert.ok(withText.layers.some((l) => l.type === 'image' && l.role === 'logo'));
  const sub = withText.layers[0]!;
  const main = withText.layers[1]!;
  assert.ok(main.y + main.h <= sub.y, 'text sits above the subtitle');
  const card = sceneOverlay({ ...spec, logo: null, subtitles: 'off' }, scene(2, 3000, { visual: null, title: 'Our shop' }), ctx);
  assert.equal(card.background.kind, 'gradient');
  assert.deepEqual(card.layers.map((l) => (l as { content?: string }).content), ['Our shop']);
  const hidden = sceneOverlay({ ...spec, logo: null, subtitles: 'off' }, scene(3, 3000, { on_screen_text: 'x', show_text: false }), ctx);
  assert.equal(hidden.layers.length, 0);
  const arabic = sceneOverlay({ ...spec, logo: null }, scene(4, 3000, { on_screen_text: 'سيروم التوهج' }), ctx, { latin: 'Arial', rtl: 'Tahoma' });
  assert.equal((arabic.layers.find((l) => l.type === 'text') as { font: string }).font, 'Tahoma');
  assert.equal(subtitleText({ subtitles: 'dialogue' }, { narration: 'n', dialogue: ' LIMO: hi ' }), 'LIMO: hi');
});
