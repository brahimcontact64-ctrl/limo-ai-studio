import { composePost } from './compose.ts';
import { isValidTimeZone, nextSlot } from './schedule.ts';
import { EMPTY_FACTS, POST_LANGUAGES, POST_TONES, type AutomationRules, type MediaCandidate, type PostFacts } from './types.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const O = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Untrusted rules → valid rules (the database re-checks page, frequency, boundary and time zone). */
export function normalizeRules(raw: unknown): AutomationRules {
  const r = O(raw);
  const facts = O(r.facts);
  const f = Object.fromEntries(Object.keys(EMPTY_FACTS).map((k) => [k, str(facts[k], 200)])) as unknown as PostFacts;
  const tz = typeof r.timezone === 'string' && isValidTimeZone(r.timezone) ? r.timezone : 'UTC';
  return {
    page_id: typeof r.page_id === 'string' && UUID.test(r.page_id) ? r.page_id : '',
    content_types: (Array.isArray(r.content_types) ? r.content_types : ['approved_designs']).filter((c): c is AutomationRules['content_types'][number] => c === 'approved_designs' || c === 'approved_videos'),
    topics: str(r.topics, 500),
    tone: (POST_TONES as readonly string[]).includes(r.tone as string) ? (r.tone as AutomationRules['tone']) : 'friendly',
    language_code: (POST_LANGUAGES as readonly string[]).includes(r.language_code as string) ? (r.language_code as AutomationRules['language_code']) : 'en',
    facts: f,
    days: [...new Set((Array.isArray(r.days) ? r.days : []).filter((d): d is number => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 6))].sort(),
    times: [...new Set((Array.isArray(r.times) ? r.times : []).filter((t): t is string => typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t)))].sort().slice(0, 6),
    timezone: tz,
    max_posts_per_week: Math.min(21, Math.max(1, Math.round(Number(r.max_posts_per_week) || 3))),
    boundary: r.boundary === 'publish_within_policy' ? 'publish_within_policy' : 'review_each',
  };
}

export interface AutomationPlan {
  title: string;
  caption: string;
  headline: string;
  hashtags: string[];
  cta: string;
  media: MediaCandidate;
  run_at: Date;
}

/**
 * What the automation runner would publish next under a policy: the oldest APPROVED design/video not
 * used by this policy yet, a caption written only from the policy's topics and facts (missing facts stay
 * [placeholders], which sends the post to review instead of publishing), at the next allowed slot.
 */
export function planAutomationPost(rules: AutomationRules, candidates: MediaCandidate[], usedIds: Set<string>, brand: { name: string; cta: string }, now: Date): AutomationPlan | null {
  const allowed = candidates
    .filter((m) => m.approved && !usedIds.has(m.id))
    .filter((m) => (m.kind === 'image' ? rules.content_types.includes('approved_designs') : rules.content_types.includes('approved_videos')))
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  const media = allowed[0];
  if (!media) return null;
  const runAt = nextSlot(rules.days, rules.times, rules.timezone, new Date(now.getTime() + 5 * 60_000));
  if (!runAt) return null;
  const draft = composePost({
    prompt: rules.topics || media.title,
    business_type: 'other',
    tone: rules.tone,
    language: rules.language_code,
    brand,
    facts: { ...rules.facts, product_name: rules.facts.product_name || media.title },
    media: [media],
    timezone: rules.timezone,
    now,
  }).proposals[0]!;
  return { title: `${media.title}`.slice(0, 200), caption: draft.caption, headline: draft.headline, hashtags: draft.hashtags, cta: draft.cta, media, run_at: runAt };
}
