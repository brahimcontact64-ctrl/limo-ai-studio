/**
 * Deterministic checks of a generated keyframe or clip against the shot and the approved references.
 *
 * These checks can only find obvious problems (blank image, wrong format, references not used, a locked character
 * colour completely absent, a mock clip). They can NOT prove that a character's identity, face, proportions or
 * lip-sync are right: the verdict is always `needs_human_review`, and approving a shot with characters requires the
 * owner's explicit confirmation (decide_animation_shot). No vision model is used here.
 */
export type CheckStatus = 'pass' | 'warn' | 'fail' | 'not_applicable';
export interface Check { code: string; status: CheckStatus; detail: string }
export interface AutomatedReview {
  kind: 'keyframe' | 'clip';
  checks: Check[];
  verdict: 'needs_human_review';
  disclaimer: string;
  animated?: boolean;
}

export const DISCLAIMER = 'Automated checks only find obvious problems; they do not prove character identity, motion quality or lip-sync. A person must compare the result with the approved references.';

const hex = (h: string): [number, number, number] => {
  const x = h.replace('#', '');
  return [parseInt(x.slice(0, 2), 16), parseInt(x.slice(2, 4), 16), parseInt(x.slice(4, 6), 16)];
};

/** Share of pixels within `tolerance` (RGB distance) of each colour. `rgba` = 4 bytes per pixel. */
export function paletteCoverage(rgba: Uint8Array | Uint8ClampedArray, colours: string[], tolerance = 60): Record<string, number> {
  const targets = colours.map((c) => [c, hex(c)] as const);
  const hits = Object.fromEntries(colours.map((c) => [c, 0])) as Record<string, number>;
  const t2 = tolerance * tolerance;
  const n = Math.floor(rgba.length / 4);
  for (let i = 0; i < n; i++) {
    const r = rgba[i * 4]!, g = rgba[i * 4 + 1]!, b = rgba[i * 4 + 2]!;
    for (const [c, [tr, tg, tb]] of targets) {
      const d = (r - tr) ** 2 + (g - tg) ** 2 + (b - tb) ** 2;
      if (d <= t2) hits[c]!++;
    }
  }
  return Object.fromEntries(Object.entries(hits).map(([c, h]) => [c, n ? h / n : 0]));
}

/** Luma spread: a near-zero spread means a blank or single-colour image. */
export function lumaSpread(rgba: Uint8Array | Uint8ClampedArray): number {
  const n = Math.floor(rgba.length / 4);
  if (!n) return 0;
  let sum = 0;
  let sq = 0;
  for (let i = 0; i < n; i++) {
    const y = 0.2126 * rgba[i * 4]! + 0.7152 * rgba[i * 4 + 1]! + 0.0722 * rgba[i * 4 + 2]!;
    sum += y;
    sq += y * y;
  }
  const mean = sum / n;
  return Math.sqrt(Math.max(0, sq / n - mean * mean));
}

export interface KeyframeInput {
  image: { width: number; height: number; rgba: Uint8Array | Uint8ClampedArray } | null;
  expectedAspect: number;
  /** Characters of the shot with their locked colours (empty for workspace characters without a palette). */
  characters: Array<{ id: string; lockedColours: string[] }>;
  attachedReferences: string[];
  usedReferences: string[];
  mock: boolean;
}

export function keyframeReview(i: KeyframeInput): AutomatedReview {
  const checks: Check[] = [];
  if (i.mock) checks.push({ code: 'mock_output', status: 'warn', detail: 'Mock image — not AI; identity cannot be judged from it.' });
  if (!i.image) {
    checks.push({ code: 'image_readable', status: 'fail', detail: 'The image could not be decoded.' });
  } else {
    const spread = lumaSpread(i.image.rgba);
    checks.push({ code: 'not_blank', status: spread > 6 ? 'pass' : 'fail', detail: `luma spread ${spread.toFixed(1)}` });
    const aspect = i.image.width / i.image.height;
    checks.push({ code: 'aspect_matches_shot', status: Math.abs(aspect - i.expectedAspect) / i.expectedAspect < 0.03 ? 'pass' : 'fail', detail: `${i.image.width}×${i.image.height}` });
    for (const c of i.characters) {
      if (!c.lockedColours.length) {
        checks.push({ code: `palette:${c.id}`, status: 'not_applicable', detail: 'no locked colours in the spec' });
        continue;
      }
      const cov = paletteCoverage(i.image.rgba, c.lockedColours);
      const missing = Object.entries(cov).filter(([, v]) => v < 0.002).map(([k]) => k);
      checks.push({ code: `palette:${c.id}`, status: missing.length ? 'warn' : 'pass', detail: missing.length ? `locked colours not found: ${missing.join(', ')}` : 'locked colours present (colour only — not identity)' });
    }
  }
  if (i.characters.length) {
    const unused = i.attachedReferences.filter((r) => !i.usedReferences.includes(r));
    checks.push({ code: 'references_used', status: i.attachedReferences.length === 0 ? 'fail' : unused.length ? 'warn' : 'pass', detail: i.attachedReferences.length === 0 ? 'no approved reference attached' : unused.length ? `${unused.length} attached reference(s) not sent` : `${i.usedReferences.length} approved reference(s) sent` });
  }
  return { kind: 'keyframe', checks, verdict: 'needs_human_review', disclaimer: DISCLAIMER };
}

export interface ClipInput {
  mock: boolean;
  hasFile: boolean;
  mime: string | null;
  expectedSeconds: number;
  reportedSeconds: number | null;
  firstFrameUsed: boolean;
}

/** Clip checks: real file vs mock, format, length; motion and lip-sync quality need a person. */
export function clipReview(i: ClipInput): AutomatedReview {
  const checks: Check[] = [];
  const animated = i.hasFile && !i.mock;
  checks.push({ code: 'animated_file', status: animated ? 'pass' : 'fail', detail: animated ? 'a generated video file exists' : i.mock ? 'mock provider: no animation was generated' : 'no video file' });
  if (i.hasFile) {
    checks.push({ code: 'format', status: i.mime === 'video/mp4' ? 'pass' : 'warn', detail: i.mime ?? 'unknown' });
    checks.push({ code: 'length', status: i.reportedSeconds !== null && Math.abs(i.reportedSeconds - i.expectedSeconds) <= 0.5 ? 'pass' : 'warn', detail: `${i.reportedSeconds ?? '?'} s for a ${i.expectedSeconds} s shot` });
  }
  checks.push({ code: 'starts_from_approved_frame', status: i.firstFrameUsed ? 'pass' : 'fail', detail: i.firstFrameUsed ? 'image-to-video from the approved first frame' : 'no first frame' });
  checks.push({ code: 'motion_and_lip_sync', status: 'not_applicable', detail: 'not measurable automatically — review the clip' });
  return { kind: 'clip', checks, verdict: 'needs_human_review', disclaimer: DISCLAIMER, animated };
}
