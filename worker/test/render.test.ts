/**
 * Real rendering test (no database): sample images, a video clip and audio are generated with FFmpeg,
 * then the worker renders the same 3-scene timeline in all four formats. Every MP4 is probed and fully
 * decoded; scene order is checked by sampling the colour in the middle of each scene.
 * Run: node --test worker/test/render.test.ts   (RENDER_OUT=<dir> keeps the files for inspection)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderSpec } from '../src/render.ts';
import { FFMPEG, probe } from '../src/ffmpeg.ts';
import { renderSize, type RenderSpec, type SpecMedia, type VideoAspect } from '../../lib/video/types.ts';

const work = mkdtempSync(join(tmpdir(), 'limo-render-test-'));
const ff = (...args: string[]) => execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args]);

// Sample media: red and blue stills, a green test clip, a narration tone, a music tone, a logo.
const RED = join(work, 'red.png');
const BLUE = join(work, 'blue.jpg');
const CLIP = join(work, 'clip.mp4');
const VOICE = join(work, 'voice.wav');
const MUSIC = join(work, 'music.mp3');
const LOGO = join(work, 'logo.png');
ff('-f', 'lavfi', '-i', 'color=c=0xd02020:s=800x600', '-frames:v', '1', RED);
ff('-f', 'lavfi', '-i', 'color=c=0x2040d0:s=1200x900', '-frames:v', '1', BLUE);
ff('-f', 'lavfi', '-i', 'color=c=0x20b040:s=640x360:r=25', '-f', 'lavfi', '-i', 'sine=f=330:d=2', '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', CLIP);
ff('-f', 'lavfi', '-i', 'sine=f=440:d=2.5', '-ar', '48000', VOICE);
ff('-f', 'lavfi', '-i', 'sine=f=220:d=4', '-c:a', 'libmp3lame', MUSIC);
ff('-f', 'lavfi', '-i', 'color=c=white:s=200x200', '-frames:v', '1', LOGO);

const media = (id: string, path: string, type: SpecMedia['media_type'], mime: string): SpecMedia => ({ asset_id: id, path, media_type: type, mime, width: null, height: null, duration_ms: null });
const files: Record<string, string> = { a: RED, b: CLIP, c: BLUE, v: VOICE, m: MUSIC, l: LOGO };
const fetchMedia = async (m: SpecMedia, dest: string) => {
  copyFileSync(files[m.asset_id]!, dest);
  return dest;
};

function spec(aspect: VideoAspect, overrides: Partial<RenderSpec> = {}): RenderSpec {
  // RENDER_RESOLUTION=1080 RENDER_QUALITY=high renders full-size files (default: fast 480p drafts).
  const { width, height } = renderSize(aspect, Number(process.env.RENDER_RESOLUTION || 480) as 480 | 720 | 1080);
  return {
    version: 1, title: 'Render test', language_code: 'en', width, height, fps: 30, quality: (process.env.RENDER_QUALITY as RenderSpec['quality']) || 'draft', transition_seconds: 0.4,
    subtitles: 'narration', text_position: 'top', text_size: 'small', brand: { primary: '#7157ef', secondary: '#211e2b' },
    music: { ...media('m', 'm', 'audio', 'audio/mpeg'), volume: 0.3 },
    logo: media('l', 'l', 'image', 'image/png'),
    scenes: [
      { scene_number: 1, title: 'Red', duration_ms: 3000, start_ms: 0, on_screen_text: 'Fresh serum', narration: 'Meet our serum.', dialogue: '', transition: 'cut', visual: media('a', 'a', 'image', 'image/png'), audio: media('v', 'v', 'audio', 'audio/wav'), fit: 'cover', show_text: true, participants: [] },
      { scene_number: 2, title: 'Green', duration_ms: 2500, start_ms: 3000, on_screen_text: '', narration: '', dialogue: '', transition: 'crossfade', visual: media('b', 'b', 'video', 'video/mp4'), audio: null, fit: 'cover', show_text: true, participants: [] },
      { scene_number: 3, title: 'Blue', duration_ms: 3500, start_ms: 5500, on_screen_text: 'سيروم التوهج — 2 400 دج', narration: '', dialogue: '', transition: 'fade', visual: media('c', 'c', 'image', 'image/jpeg'), audio: null, fit: 'contain', show_text: true, participants: [] },
    ],
    ...overrides,
  };
}

/** Average colour of a small area at the left edge (away from text/logo) at time t. */
function colourAt(file: string, t: number, w: number, h: number): [number, number, number] {
  const raw = execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-vf', `crop=${Math.round(w * 0.1)}:${Math.round(h * 0.1)}:4:${Math.round(h * 0.45)},scale=1:1`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
  return [raw[0]!, raw[1]!, raw[2]!];
}
const dominant = ([r, g, b]: [number, number, number]) => (r > g + 60 && r > b + 60 ? 'red' : g > r + 60 && g > b + 60 ? 'green' : b > r + 60 && b > g + 60 ? 'blue' : `other(${r},${g},${b})`);

const keep = process.env.RENDER_OUT;
const results: string[] = [];

for (const aspect of ['9:16', '16:9', '1:1', '4:5'] as const) {
  test(`renders a real ${aspect} MP4: size, duration, audio, decodes, scene order`, async () => {
    const s = spec(aspect);
    const out = await renderSpec(s, join(work, aspect.replace(':', 'x')), fetchMedia, () => {}, new AbortController().signal, { stepTimeoutMs: 120_000, maxInputBytes: 100 * 1024 * 1024 });
    const p = await probe(out.file);
    assert.match(p.format, /mp4/);
    assert.equal(p.video?.codec, 'h264');
    assert.deepEqual([p.video?.width, p.video?.height], [s.width, s.height]);
    assert.ok(Math.abs(p.duration - 9) < 0.25, `duration ${p.duration}`);
    assert.equal(p.audio?.codec, 'aac');
    // Full decode: any corrupt frame makes ffmpeg exit non-zero.
    execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-i', out.file, '-f', 'null', '-']);
    // Scene order: red (0–3 s), green clip (3–5.5 s), blue (5.5–9 s).
    assert.deepEqual([1.5, 4.2, 7.5].map((t) => dominant(colourAt(out.file, t, s.width, s.height))), ['red', 'green', 'blue']);
    const size = statSync(out.file).size;
    results.push(`${aspect} ${p.video?.width}x${p.video?.height} ${p.duration.toFixed(3)}s ${(size / 1024).toFixed(0)} KB h264+${p.audio?.codec}`);
    if (keep) {
      mkdirSync(keep, { recursive: true });
      copyFileSync(out.file, join(keep, `render-${aspect.replace(':', 'x')}.mp4`));
    }
  });
}

test('a video without narration or music still has an audio track; a cancelled render stops', async () => {
  const s = spec('1:1', { music: null, logo: null, subtitles: 'off', scenes: spec('1:1').scenes.map((x) => ({ ...x, audio: null })) });
  const out = await renderSpec(s, join(work, 'silent'), fetchMedia, () => {}, new AbortController().signal, { stepTimeoutMs: 120_000, maxInputBytes: 100 * 1024 * 1024 });
  const p = await probe(out.file);
  assert.equal(p.audio?.codec, 'aac');
  const ctrl = new AbortController();
  const pending = renderSpec(spec('16:9'), join(work, 'cancel'), fetchMedia, (pct) => {
    if (pct > 10) ctrl.abort();
  }, ctrl.signal, { stepTimeoutMs: 120_000, maxInputBytes: 100 * 1024 * 1024 });
  await assert.rejects(pending, (e: Error & { code?: string }) => e.code === 'cancelled');
});

test('a missing input fails without retry; a step over its time limit is retryable', async () => {
  const missing = async () => {
    throw Object.assign(new Error('gone'), { code: 'input_missing', retryable: false });
  };
  await assert.rejects(renderSpec(spec('1:1'), join(work, 'missing'), missing, () => {}, new AbortController().signal, { stepTimeoutMs: 120_000, maxInputBytes: 1e8 }), /gone/);
  await assert.rejects(
    renderSpec(spec('1:1'), join(work, 'timeout'), fetchMedia, () => {}, new AbortController().signal, { stepTimeoutMs: 1, maxInputBytes: 1e8 }),
    (e: Error & { code?: string; retryable?: boolean }) => e.code === 'timeout' && e.retryable === true,
  );
});

test('V1 policy: exactly 30 s renders a real 30 s MP4; over 30 s is refused before rendering and not retried', async () => {
  const card = (n: number, ms: number, start: number) => ({ scene_number: n, title: `Card ${n}`, duration_ms: ms, start_ms: start, on_screen_text: `Card ${n}`, narration: '', dialogue: '', transition: 'cut' as const, visual: null, audio: null, fit: 'cover' as const, show_text: true, participants: [] });
  const at30 = spec('9:16', { music: null, logo: null, subtitles: 'off', scenes: [card(1, 15_000, 0), card(2, 15_000, 15_000)] });
  const r = await renderSpec(at30, join(work, 'policy30'), fetchMedia, () => {}, new AbortController().signal, { stepTimeoutMs: 120_000, maxInputBytes: 1e8 });
  assert.ok(Math.abs(r.probe.duration - 30) <= 0.25, `duration ${r.probe.duration}`);
  results.push(`policy 30 s ${r.probe.video?.width}x${r.probe.video?.height} ${r.probe.duration.toFixed(3)}s`);
  let fetched = 0;
  const over = spec('9:16', { scenes: [card(1, 15_000, 0), card(2, 15_001, 15_000)] });
  await assert.rejects(
    renderSpec(over, join(work, 'policy31'), async (m, d) => { fetched++; return fetchMedia(m, d); }, () => {}, new AbortController().signal, { stepTimeoutMs: 120_000, maxInputBytes: 1e8 }),
    (e: Error & { code?: string; retryable?: boolean }) => e.code === 'over_duration_limit' && e.retryable === false && /limited to 30 seconds/.test(e.message),
  );
  assert.equal(fetched, 0, 'nothing downloaded for a refused video');
});

/** Mean loudness (dB) of a time window, from FFmpeg's volumedetect (-91 dB = digital silence). */
function meanVolume(file: string, start: number, dur: number): number {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-ss', String(start), '-t', String(dur), '-i', file, '-af', 'volumedetect', '-vn', '-f', 'null', '-'], { encoding: 'utf8' });
  const m = /mean_volume:\s*(-?[\d.]+) dB/.exec(r.stderr);
  return m ? Number(m[1]) : -999;
}

test('animation export audio: clip sound kept or muted per shot, voice lines mixed at their offsets', async () => {
  // Two 4 s shots from the same clip (which has its own 330 Hz sound); shot 2 mutes the clip and carries a voice line at 1.5 s.
  const shot = (n: number, start: number, extra: Partial<RenderSpec['scenes'][number]>) => ({ scene_number: n, title: `Shot ${n}`, duration_ms: 4000, start_ms: start, on_screen_text: '', narration: '', dialogue: '', transition: 'cut' as const, visual: media('b', 'b', 'video', 'video/mp4'), audio: null, fit: 'cover' as const, show_text: false, participants: [], ...extra });
  const s = spec('9:16', { music: null, logo: null, subtitles: 'off', fps: 24, scenes: [
    shot(1, 0, { clip_audio: { volume: 1 } }),
    shot(2, 4000, { clip_audio: { volume: 0 }, audio_layers: [{ ...media('v', 'v', 'audio', 'audio/wav'), offset_ms: 1500, volume: 1 }] }),
  ] });
  const out = await renderSpec(s, join(work, 'animation-audio'), fetchMedia, () => {}, new AbortController().signal, { stepTimeoutMs: 120_000, maxInputBytes: 1e8 });
  assert.ok(Math.abs(out.probe.duration - 8) < 0.25, `duration ${out.probe.duration}`);
  const clipSound = meanVolume(out.file, 0.3, 1.2);
  const mutedGap = meanVolume(out.file, 4.3, 1.0);
  const voice = meanVolume(out.file, 5.8, 1.2);
  assert.ok(clipSound > -40, `clip audio kept in shot 1 (${clipSound} dB)`);
  assert.ok(mutedGap < -70, `clip muted in shot 2 before the line (${mutedGap} dB)`);
  assert.ok(voice > -40, `voice line audible at its offset (${voice} dB)`);
  results.push(`animation audio: clip ${clipSound} dB, muted ${mutedGap} dB, voice ${voice} dB`);
});

/** Loudness of one frequency band (isolates the music tone from the voice tone). */
function bandVolume(file: string, start: number, dur: number, freq: number): number {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-ss', String(start), '-t', String(dur), '-i', file, '-af', `bandpass=f=${freq}:width_type=h:w=30,volumedetect`, '-vn', '-f', 'null', '-'], { encoding: 'utf8' });
  const m = /mean_volume:\s*(-?[\d.]+) dB/.exec(r.stderr);
  return m ? Number(m[1]) : -999;
}

test('music ducks automatically under a voice line (about −9 dB); full level before it', async () => {
  const shot = (n: number, start: number, extra: Partial<RenderSpec['scenes'][number]>) => ({ scene_number: n, title: `Shot ${n}`, duration_ms: 4000, start_ms: start, on_screen_text: '', narration: '', dialogue: '', transition: 'cut' as const, visual: media('b', 'b', 'video', 'video/mp4'), audio: null, fit: 'cover' as const, show_text: false, participants: [], clip_audio: { volume: 0 }, ...extra });
  // Music 220 Hz (4 s file, looped); voice 440 Hz, 2.5 s, from 5.0 s to 7.5 s.
  const s = spec('9:16', { logo: null, subtitles: 'off', fps: 24, music: { ...media('m', 'm', 'audio', 'audio/mpeg'), volume: 0.5 }, scenes: [
    shot(1, 0, {}),
    shot(2, 4000, { audio_layers: [{ ...media('v', 'v', 'audio', 'audio/wav'), duration_ms: 2500, offset_ms: 1000, volume: 1 }] }),
  ] });
  const out = await renderSpec(s, join(work, 'ducking'), fetchMedia, () => {}, new AbortController().signal, { stepTimeoutMs: 120_000, maxInputBytes: 1e8 });
  const before = bandVolume(out.file, 1, 2, 220);
  const during = bandVolume(out.file, 5.5, 1.5, 220);
  const voice = bandVolume(out.file, 5.5, 1.5, 440);
  assert.ok(before - during > 6 && before - during < 12, `music ${before} dB before, ${during} dB under the voice`);
  assert.ok(voice > during, `voice (${voice} dB) is above the ducked music`);
  results.push(`ducking: music ${before} dB → ${during} dB under the voice (${voice} dB)`);
});

test.after(() => {
  console.log(results.join('\n'));
  rmSync(work, { recursive: true, force: true });
});
