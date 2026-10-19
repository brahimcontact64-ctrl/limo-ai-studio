import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createCanvas, GlobalFonts, loadImage } from '@napi-rs/canvas';
import { renderDoc, type Ctx2D, type LoadedImage } from '../../lib/images/render.ts';
import { assemblyGraph, duckFilter, fitFilter, musicLoops, planRender, QUALITY_PRESET, segmentAudioGraph, speechWindows } from '../../lib/video/plan.ts';
import { sceneOverlay, type OverlayFonts } from '../../lib/video/overlay.ts';
import type { RenderSpec, SpecMedia } from '../../lib/video/types.ts';
import { checkSpecDuration } from '../../lib/video/policy.ts';
import { probe, RenderError, runFfmpeg, type ProbeResult } from './ffmpeg.ts';

export interface RenderLimits {
  /** Hard limit for one ffmpeg run. */
  stepTimeoutMs: number;
  /** Largest input file accepted (bytes). */
  maxInputBytes: number;
}

export interface RenderResult {
  file: string;
  probe: ProbeResult;
}

/** First installed family of each list (Windows: Arial/Tahoma; Linux image: Noto/DejaVu). */
function pickFonts(): OverlayFonts {
  const pick = (names: string[]) => names.find((n) => GlobalFonts.has(n)) ?? names[names.length - 1]!;
  return { latin: pick(['Arial', 'Noto Sans', 'DejaVu Sans']), rtl: pick(['Tahoma', 'Noto Sans Arabic', 'Noto Naskh Arabic', 'DejaVu Sans']) };
}

type Fetch = (media: SpecMedia, dest: string) => Promise<string>;
type Progress = (percent: number, stage: string) => Promise<void> | void;

const extOf = (m: SpecMedia) => (m.mime?.split('/')[1]?.replace('quicktime', 'mov').replace('mpeg', 'mp3').replace('x-wav', 'wav') ?? 'bin').replace(/[^a-z0-9]/g, '');

/**
 * Renders a spec into one MP4 inside `dir` (a fresh per-job folder the caller deletes afterwards).
 * 1. download inputs (originals are never modified), 2. draw overlays, 3. encode one segment per scene,
 * 4. join segments with the planned transitions and mix background music, 5. probe the result.
 */
export async function renderSpec(spec: RenderSpec, dir: string, fetchMedia: Fetch, onProgress: Progress, signal: AbortSignal, limits: RenderLimits): Promise<RenderResult> {
  // V1 policy: never render more than 30 s (refused before any download or FFmpeg run; not retryable).
  const overLimit = checkSpecDuration(spec);
  if (overLimit) throw new RenderError('over_duration_limit', overLimit, false);
  await mkdir(dir, { recursive: true });
  const plan = planRender(spec);
  const q = QUALITY_PRESET[spec.quality];
  const { width: W, height: H, fps } = spec;

  // 1. Inputs.
  await onProgress(2, 'downloading');
  const local = new Map<string, string>();
  const want = [...spec.scenes.flatMap((s) => [s.visual, s.audio, ...(s.audio_layers ?? [])]), spec.music, spec.logo].filter((m): m is SpecMedia => !!m);
  for (const m of want) {
    if (local.has(m.asset_id)) continue;
    if (signal.aborted) throw new RenderError('cancelled', 'Cancelled', false);
    local.set(m.asset_id, await fetchMedia(m, join(dir, `in-${m.asset_id}.${extOf(m)}`)));
  }

  // 2. Overlays (text, subtitles, logo; text cards for scenes without media).
  await onProgress(8, 'overlays');
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const images = new Map<string, LoadedImage>();
  if (spec.logo) {
    const img = await loadImage(local.get(spec.logo.asset_id)!);
    images.set(spec.logo.asset_id, { source: img, width: img.width, height: img.height });
  }
  const overlays: string[] = [];
  const fonts = pickFonts();
  for (const scene of spec.scenes) {
    ctx.clearRect(0, 0, W, H);
    const doc = sceneOverlay(spec, scene, ctx as unknown as Ctx2D, fonts);
    renderDoc(ctx as unknown as Ctx2D, doc, images, 1);
    const file = join(dir, `overlay-${scene.scene_number}.png`);
    await writeFile(file, canvas.toBuffer('image/png'));
    overlays.push(file);
  }

  // 3. One segment per scene (scene length + transition into the next).
  const segFiles: string[] = [];
  const segWeight = 70 / plan.segments.length;
  for (const seg of plan.segments) {
    const scene = spec.scenes[seg.index]!;
    const L = seg.length;
    const args: string[] = [];
    if (scene.visual?.media_type === 'image') args.push('-loop', '1', '-framerate', String(fps), '-t', String(L), '-i', local.get(scene.visual.asset_id)!);
    else if (scene.visual?.media_type === 'video') args.push('-stream_loop', '-1', '-t', String(L), '-i', local.get(scene.visual.asset_id)!);
    else args.push('-f', 'lavfi', '-t', String(L), '-i', `color=c=${spec.brand.primary.replace('#', '0x')}:s=${W}x${H}:r=${fps}`);
    args.push('-loop', '1', '-framerate', String(fps), '-t', String(L), '-i', overlays[seg.index]!);
    if (scene.audio) args.push('-i', local.get(scene.audio.asset_id)!);
    else args.push('-f', 'lavfi', '-t', String(L), '-i', 'anullsrc=r=48000:cl=stereo');
    // Animation exports: the clip's own sound (only if the file has an audio stream) and voice layers.
    const clipVol = scene.visual?.media_type === 'video' && scene.clip_audio && scene.clip_audio.volume > 0 && (await probe(local.get(scene.visual.asset_id)!)).audio ? scene.clip_audio.volume : null;
    const layers = (scene.audio_layers ?? []).map((l, i) => {
      args.push('-i', local.get(l.asset_id)!);
      return { input: 3 + i, offset_ms: l.offset_ms, volume: l.volume };
    });
    const graph = [
      `[0:v]${fitFilter(W, H, scene.fit, spec.brand.primary, fps)}[base]`,
      `[1:v]format=rgba[ov]`,
      `[base][ov]overlay=0:0:format=auto,format=yuv420p[vout]`,
      segmentAudioGraph(L, { clipAudioVolume: clipVol, layers }),
    ].join(';');
    const out = join(dir, `seg-${String(seg.index).padStart(3, '0')}.mp4`);
    args.push('-filter_complex', graph, '-map', '[vout]', '-map', '[aout]', '-t', String(L), '-r', String(fps));
    args.push('-c:v', 'libx264', '-preset', q.preset, '-crf', String(q.crf), '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', q.audio, '-ar', '48000', '-ac', '2', out);
    const base = 10 + seg.index * segWeight;
    await runFfmpeg(args, { timeoutMs: limits.stepTimeoutMs, signal, onProgress: (s) => void onProgress(base + Math.min(1, s / L) * segWeight, 'scenes') });
    segFiles.push(out);
  }

  // 4. Join with transitions, mix music, write a streamable MP4.
  await onProgress(80, 'assembling');
  const final = join(dir, 'output.mp4');
  const args: string[] = [];
  for (const f of segFiles) args.push('-i', f);
  if (spec.music) {
    const file = local.get(spec.music.asset_id)!;
    const loops = musicLoops(plan.total, (await probe(file)).duration);
    args.push('-stream_loop', String(loops), '-i', file);
  }
  // Music ducks automatically under narration and dialogue.
  args.push('-filter_complex', assemblyGraph(plan, spec.music ? { volume: spec.music.volume, duck: duckFilter(speechWindows(spec)) } : null), '-map', '[vout]', '-map', '[aout]', '-t', String(plan.total));
  args.push('-r', String(fps), '-c:v', 'libx264', '-preset', q.preset, '-crf', String(q.crf), '-pix_fmt', 'yuv420p', '-profile:v', 'high');
  args.push('-c:a', 'aac', '-b:a', q.audio, '-ar', '48000', '-ac', '2', '-movflags', '+faststart', final);
  await runFfmpeg(args, { timeoutMs: limits.stepTimeoutMs, signal, onProgress: (s) => void onProgress(80 + Math.min(1, s / plan.total) * 15, 'assembling') });

  // 5. Verify what was written before anyone can download it.
  const p = await probe(final);
  if (!p.video || p.video.codec !== 'h264' || p.video.width !== W || p.video.height !== H) throw new RenderError('bad_output', `Unexpected output stream: ${JSON.stringify(p.video)}`, false);
  if (Math.abs(p.duration - plan.total) > 1) throw new RenderError('bad_output', `Output lasts ${p.duration}s, expected ${plan.total}s`, false);
  if (p.size > limits.maxInputBytes) throw new RenderError('too_large', 'The video is larger than the storage limit', false);
  return { file: final, probe: p };
}
