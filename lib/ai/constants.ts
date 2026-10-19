/** Client-safe constants of the creative AI jobs (no Node imports: used by browser components). */
export const REWRITE_MODES = ['shorter', 'longer', 'warmer', 'professional', 'translate'] as const;
export type RewriteMode = (typeof REWRITE_MODES)[number];
export const SOCIAL_IMAGE_ASPECTS = { '1:1': { width: 1080, height: 1080 }, '4:5': { width: 1080, height: 1350 }, '9:16': { width: 1080, height: 1920 }, '16:9': { width: 1920, height: 1080 } } as const;
