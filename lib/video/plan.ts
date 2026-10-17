import type { RenderSpec, Transition } from './types.ts';

/**
 * Timeline maths and FFmpeg filter graphs for the render worker (pure, unit tested).
 *
 * Each scene is first encoded as its own segment; segment i lasts its scene duration plus the length of
 * the transition into the next scene, so that chaining `xfade` (video) and `acrossfade` (audio) keeps
 * every scene starting exactly at its approved start time and the total equal to the sum of the
 * approved durations.
 */
export interface PlannedSegment {
  index: number;
  scene_number: number;
  /** Seconds of this segment (scene duration + transition into the next one). */
  length: number;
  /** Transition into the next scene (seconds, 0 for the last scene). */
  transition: number;
  xfade: string | null;
  /** Where the next scene starts in the output (seconds). */
  offset: number | null;
}

export interface RenderPlan {
  total: number;
  segments: PlannedSegment[];
}

/** FFmpeg xfade names. "cut" is a one-frame dissolve so every join uses the same filter. */
export const XFADE: Record<Transition, string> = { cut: 'fade', fade: 'fadeblack', crossfade: 'fade', slide: 'slideleft', wipe: 'wipeleft' };

const round3 = (n: number) => Math.round(n * 1000) / 1000;

export function planRender(spec: Pick<RenderSpec, 'scenes' | 'fps' | 'transition_seconds'>): RenderPlan {
  const frame = 1 / spec.fps;
  const durations = spec.scenes.map((s) => s.duration_ms / 1000);
  let elapsed = 0;
  const segments = spec.scenes.map((s, i) => {
    const last = i === spec.scenes.length - 1;
    const dur = durations[i]!;
    let d = 0;
    if (!last) {
      // A transition can never be longer than half of either scene it joins.
      const max = Math.min(dur, durations[i + 1]!) / 2;
      d = s.transition === 'cut' ? frame : Math.min(spec.transition_seconds, max);
      d = round3(Math.max(frame, d));
    }
    elapsed += dur;
    return {
      index: i,
      scene_number: s.scene_number,
      length: round3(dur + d),
      transition: d,
      xfade: last ? null : XFADE[s.transition],
      offset: last ? null : round3(elapsed),
    };
  });
  return { total: round3(durations.reduce((a, b) => a + b, 0)), segments };
}

export const QUALITY_PRESET: Record<RenderSpec['quality'], { crf: number; preset: string; audio: string }> = {
  draft: { crf: 30, preset: 'ultrafast', audio: '128k' },
  standard: { crf: 23, preset: 'veryfast', audio: '160k' },
  high: { crf: 19, preset: 'medium', audio: '192k' },
};

/** Video filter that fits one visual into the frame (cover crops, contain pads with the brand colour). */
export function fitFilter(width: number, height: number, fit: 'cover' | 'contain', pad: string, fps: number): string {
  const base =
    fit === 'cover'
      ? `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`
      : `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=${pad.replace('#', '0x')}`;
  return `${base},setsar=1,fps=${fps},format=yuv420p`;
}

/**
 * filter_complex for the final assembly: inputs 0..n-1 are the encoded segments, input n (optional) is
 * the background music. Produces [vout] and [aout].
 */
export function assemblyGraph(plan: RenderPlan, music: { volume: number } | null): string {
  const n = plan.segments.length;
  const parts: string[] = [];
  for (let i = 0; i < n; i++) {
    parts.push(`[${i}:v]settb=AVTB,setpts=PTS-STARTPTS[v${i}]`);
    parts.push(`[${i}:a]asetpts=PTS-STARTPTS[a${i}]`);
  }
  let v = 'v0';
  let a = 'a0';
  for (let i = 0; i < n - 1; i++) {
    const s = plan.segments[i]!;
    const nv = `vx${i + 1}`;
    const na = `ax${i + 1}`;
    parts.push(`[${v}][v${i + 1}]xfade=transition=${s.xfade}:duration=${s.transition}:offset=${s.offset}[${nv}]`);
    parts.push(`[${a}][a${i + 1}]acrossfade=d=${s.transition}:c1=tri:c2=tri[${na}]`);
    v = nv;
    a = na;
  }
  parts.push(`[${v}]format=yuv420p[vout]`);
  if (music) {
    const fadeStart = Math.max(0, plan.total - 1.5);
    parts.push(
      `[${n}:a]aresample=48000,aformat=channel_layouts=stereo,apad,atrim=0:${plan.total},asetpts=PTS-STARTPTS,volume=${music.volume},afade=t=out:st=${fadeStart}:d=1.5[music]`,
    );
    parts.push(`[${a}][music]amix=inputs=2:duration=first:normalize=0[aout]`);
  } else parts.push(`[${a}]anull[aout]`);
  return parts.join(';');
}

/**
 * How many extra times the music file must repeat to cover the video. A finite count is required:
 * an endless loop (-stream_loop -1) can keep the audio mixer from ever finishing.
 */
export function musicLoops(totalSeconds: number, musicSeconds: number): number {
  if (!(musicSeconds > 0.05)) return 0;
  return Math.max(0, Math.ceil(totalSeconds / musicSeconds) - 1);
}

/** Parses `-progress` output lines ("out_time_us=1234567") into seconds. */
export function progressSeconds(line: string): number | null {
  const m = /^out_time_(?:us|ms)=(\d+)/.exec(line.trim());
  return m ? Number(m[1]) / 1_000_000 : null;
}
