/**
 * Social publishing (Milestone 8). Facebook Pages first; the model is provider-neutral where it costs
 * nothing (adapter interface, statuses), but no other platform is claimed.
 */
export const POST_STATUSES = ['draft', 'awaiting_review', 'approved', 'scheduled', 'publishing', 'published', 'failed', 'cancelled'] as const;
export type PostStatus = (typeof POST_STATUSES)[number];

/** Statuses in which the text and media can still be edited. */
export const EDITABLE_POST_STATUSES: PostStatus[] = ['draft', 'awaiting_review', 'failed', 'cancelled'];

export const POST_LANGUAGES = ['en', 'fr', 'ar', 'de'] as const;
export type PostLanguage = (typeof POST_LANGUAGES)[number];

export const POST_TONES = ['friendly', 'professional', 'playful', 'premium', 'energetic', 'calm'] as const;
export type PostTone = (typeof POST_TONES)[number];

export const BUSINESS_TYPES = ['restaurant', 'retail', 'services', 'agency', 'education', 'creator', 'storytelling', 'other'] as const;
export type BusinessType = (typeof BUSINESS_TYPES)[number];

/** Facts the customer typed. Only these may appear as facts in generated text. */
export interface PostFacts {
  business_name: string;
  product_name: string;
  price: string;
  offer: string;
  availability: string;
  location: string;
  hours: string;
  link: string;
}
export const EMPTY_FACTS: PostFacts = { business_name: '', product_name: '', price: '', offer: '', availability: '', location: '', hours: '', link: '' };

export interface MediaCandidate {
  kind: 'image' | 'video';
  /** image: Image Studio project id or library asset id; video: render job id. */
  id: string;
  title: string;
  approved: boolean;
  created_at: string;
}

export interface ComposeInput {
  prompt: string;
  business_type: BusinessType;
  tone: PostTone;
  language: PostLanguage;
  brand: { name: string; cta: string };
  facts: PostFacts;
  media: MediaCandidate[];
  timezone: string;
  now: Date;
}

export interface PostDraftProposal {
  variant: 'standard' | 'short' | 'question';
  headline: string;
  caption: string;
  hashtags: string[];
  cta: string;
}

export interface ComposeResult {
  provider: 'mock';
  label: string;
  proposals: PostDraftProposal[];
  /** Facts the request needs but the customer did not give; they appear as [placeholders]. */
  missing_facts: Array<keyof PostFacts | 'testimonial'>;
  suggested_media: MediaCandidate | null;
  suggested_time: { local: string; timezone: string; iso: string; reason: string };
}

/** Controlled automation rules (versioned in automation_policies / automation_policy_versions). */
export interface AutomationRules {
  page_id: string;
  content_types: Array<'approved_designs' | 'approved_videos'>;
  topics: string;
  tone: PostTone;
  language_code: PostLanguage;
  facts: PostFacts;
  days: number[];
  times: string[];
  timezone: string;
  max_posts_per_week: number;
  boundary: 'review_each' | 'publish_within_policy';
}
