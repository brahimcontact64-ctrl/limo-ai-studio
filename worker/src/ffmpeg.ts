import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { progressSeconds } from '../../lib/video/plan.ts';

const require = createRequire(import.meta.url);

/** FFMPEG_PATH / FFPROBE_PATH override the bundled static binaries (e.g. the distro ffmpeg in Docker). */
export const FFMPEG = process.env.FFMPEG_PATH || (require('ffmpeg-static') as string);
export const FFPROBE = process.env.FFPROBE_PATH || (require('ffprobe-static') as { path: string }).path;

export class RenderError extends Error {
  code: string;
  retryable: boolean;
  constructor(code: string, message: string, retryable: boolean) {
    super(message);
    this.code = code;
    this.retryable = retryable;
  }
}

/**
 * Runs ffmpeg with a hard time limit and an abort signal. `-progress pipe:1` lines are turned into
 * seconds of output written, reported through onProgress.
 */
export function runFfmpeg(args: string[], opts: { timeoutMs: number; signal?: AbortSignal; onProgress?: (seconds: number) => void }): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(FFMPEG, ['-hide_banner', '-nostdin', '-y', '-progress', 'pipe:1', '-nostats', '-loglevel', 'error', ...args], { windowsHide: true });
    let stderr = '';
    let settled = false;
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      if (err) reject(err);
      else resolve();
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(new RenderError('timeout', 'Rendering took longer than the allowed time', true));
    }, opts.timeoutMs);
    const onAbort = () => {
      child.kill('SIGKILL');
      finish(new RenderError('cancelled', 'Cancelled', false));
    };
    if (opts.signal?.aborted) return onAbort();
    opts.signal?.addEventListener('abort', onAbort);
    let buf = '';
    child.stdout.on('data', (d: Buffer) => {
      buf += d.toString();
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        const s = progressSeconds(line);
        if (s !== null) opts.onProgress?.(s);
      }
    });
    child.stderr.on('data', (d: Buffer) => {
      stderr = (stderr + d.toString()).slice(-4000);
    });
    child.on('error', (e) => finish(new RenderError('ffmpeg_missing', e.message, false)));
    child.on('close', (code) => {
      if (code === 0) finish();
      else finish(new RenderError('ffmpeg_failed', stderr.trim().split('\n').slice(-3).join(' | ') || `ffmpeg exited with ${code}`, false));
    });
  });
}

export interface ProbeResult {
  format: string;
  duration: number;
  size: number;
  video: { codec: string; width: number; height: number; fps: number; frames: number | null } | null;
  audio: { codec: string; sample_rate: number; channels: number } | null;
}

export function probe(file: string): Promise<ProbeResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], { windowsHide: true });
    let out = '';
    let err = '';
    child.stdout.on('data', (d: Buffer) => (out += d.toString()));
    child.stderr.on('data', (d: Buffer) => (err += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new RenderError('probe_failed', err.trim() || 'ffprobe failed', false));
      const j = JSON.parse(out) as { format: Record<string, string>; streams: Array<Record<string, string | number>> };
      const v = j.streams.find((s) => s.codec_type === 'video');
      const a = j.streams.find((s) => s.codec_type === 'audio');
      const [num, den] = String(v?.avg_frame_rate ?? '0/1').split('/').map(Number);
      resolve({
        format: j.format.format_name ?? '',
        duration: Number(j.format.duration ?? 0),
        size: Number(j.format.size ?? 0),
        video: v ? { codec: String(v.codec_name), width: Number(v.width), height: Number(v.height), fps: den ? num! / den : 0, frames: v.nb_frames ? Number(v.nb_frames) : null } : null,
        audio: a ? { codec: String(a.codec_name), sample_rate: Number(a.sample_rate), channels: Number(a.channels) } : null,
      });
    });
  });
}
