# LIMO AI Studio — Master Product Specification

Status: approved by the owner on 2026-10-16. Canonical scope; supersedes earlier fragmented prompts where they conflict.
Implementation status lives in `IMPLEMENTATION_STATUS.md`; this file describes what the product must become, not what exists.

## 1. Product vision
LIMO AI Studio is a universal AI-powered creative production and social media content platform — not only a cartoon generator, storytelling tool, scheduler or video generator.

Audiences: e-commerce sellers, product brands, restaurants/cafés/hotels, local businesses, agencies, social media managers, influencers and creators (YouTube, TikTok, Instagram), storytellers and animated-series creators, educators and trainers, coaches and professionals, individuals.

A user describes an idea in natural language, creates or edits content, approves it, downloads it, or schedules publication where supported. Simple workflows and advanced professional editing are both supported. **AI assists; the user keeps creative control.**

## 2. Approved design — do not redesign
Original LIMO identity: soft lavender/off-white backgrounds, white rounded cards, purple gradients and primary buttons, premium dark typography, subtle shadows, generous spacing, 🍋 LIMO AI branding, dark app sidebar, Metricool-inspired organisation (not copied). Responsive desktop/tablet/mobile. Four languages with Arabic RTL. No dark-green/lime redesign. No identity changes without owner permission.

## 3. Universal "Create Content" workflow
Entry point: **Create Content — What would you like to create?** Modes: Product Advertisement · Business Promotion · Social Media Video · Social Media Image/Post · Story or Animated Series · Educational/Explainer Video · UGC-Style Advertisement · Custom Creative Project. Each mode shows only relevant inputs.
Common options: project name, idea/description, target audience, language, tone and visual style, aspect ratio, desired duration, brand information, uploaded assets, optional AI characters, optional narration and music, draft and approval workflow. **Characters are optional for non-story projects.**

## 4. Script, dialogue and scene editor
Everything is editable before final generation: AI script drafts, full manual script editing, per-scene editing, dialogue, narration/voice-over, reorder/add/duplicate/delete scenes, scene visual description, duration, camera/shot directions, characters per scene, rewrite selected text, AI rewrite/expand/shorten/translate/simplify/change tone, regenerate one scene, version history, undo/restore, draft autosave, preview and explicit approval.
User-approved scripts stay separate from AI suggestions. Editing an approved story scene triggers continuity checks. Never silently overwrite approved content.

## 5. Character system — 18 consistent 3D-style characters
Families LIMO (tomato), NOVA (strawberry), ADAM (potato) × boy, girl, adult man, adult woman, elderly man, elderly woman = 18.
Premium, expressive, family-friendly stylised 3D look with consistent identity across scenes and episodes.
Implement canonical specifications, approved reference images (front/side/three-quarter where available), expression references, stable proportions, colour and clothing definitions, versioned reference assets in Supabase Storage, approval statuses, selection and previews, identity metadata for future adapters.
3D-style renders are not rigged 3D models; report which assets exist; support an extensible model-asset format without pretending models exist. No character is production-approved until references are reviewed. Generation requests must include canonical references and identity constraints. Users may create private reusable characters (permission and plan limits).

## 6. Story engine — series that continue where they stopped
Series, seasons where useful, episodes, Story Bible, world definitions, locations, characters and relationships, goals, emotional and physical state, chronology, arcs, unresolved threads, episode summaries, continuity checkpoints, canonical facts, episode ending state, next-episode starting state.
**Continue Story** retrieves the previous approved episode and canonical memory and prepares the next draft, preserving identity, relationships, events, locations, chronology, important objects, unresolved events and the previous ending. Users can edit the continuation. Earlier approved canon is never rewritten silently; revision history and conflict resolution when earlier episodes change. Test at least three connected episodes including a revision to an earlier one. Deterministic mock AI until a real model is approved.

## 7. Product advertising engine
Works without characters. Product name/description, photos and videos, selling points, price and offer, audience, language, brand name and logo, call to action, duration, visual style, optional presenter/character, optional voice-over, script generation and editing, storyboard, image generation, video preparation, download and publishing. Directions: realistic, cinematic, lifestyle, studio, luxury, stylised. Preserve product identity and brand assets. Never invent prices, discounts, testimonials, specifications or guarantees; factual claims require review.

## 8. AI Image Studio
Social posts, product ads, banners, thumbnails, story illustrations, character references, educational graphics, business visuals.
Editing: text-to-image, reference uploads, variations, background/colour/style changes, element replacement, crop/resize, headlines, logos, prices and CTAs, editable text layers, version compare/restore, PNG/JPG/WebP download. Formats 1:1, 4:5, 9:16, 16:9. Precise text and logos use editable overlays, not AI lettering. Provider interfaces and mock workflows first; never present placeholders as real generated images.

## 9. Video production, assembly and download
Real downloadable video: timeline or structured scene editor, order and duration, transitions, narration, dialogue, background audio, captions, preview, rendering jobs with progress/failure, safe retries and cancellation, MP4, secure downloads (desktop and mobile), versioned exports. Aspect ratios 9:16, 16:9, 1:1, 4:5. Background worker with FFmpeg or equivalent; no long serverless requests for heavy rendering. Real sample media for initial tests; verify duration, dimensions, audio and playback. Prompts, JSON, mock URLs or static previews do not count as export-ready. Real AI video scenes connect later.

## 10. Voice, audio and multilingual content
Architecture for TTS, multiple voices, per-character voice identity, narration, dialogue assignment, languages, subtitles, sync, background music, user audio, previews. Spoken text editable before audio generation. Voice identity consistent across episodes. No paid voice APIs before approval; no cloning a real person's voice without authorisation.

## 11. Social Post Studio
From a request such as "Create a Facebook post advertising my new perfume collection": caption, headline, CTA, hashtags, suggested/generated image, alternatives, preview. Edit all text, change tone, translate, regenerate, replace image, change image text/layout, save draft, approve, schedule, publish when authorised, history. Shared image library and brand assets.

## 12. Facebook publishing and automation
Mode A — approval before publishing: idea → AI draft → edits → approval → scheduled or immediate publishing.
Mode B — explicitly authorised auto-publishing: authorised Page, topics, brand voice, frequency, publishing windows, restrictions, approval preferences, emergency stop. **Off by default.**
Engineering: verify existing Facebook tables/functions/policies first and reuse only if valid; authorisation, OAuth and permissions, secure token storage, scheduled jobs with retries and idempotency, audit logs, status and failure reporting, disconnect, pause, account quotas, safety checks. Mock Facebook adapter and full lifecycle tests first. No real publishing; real Graph API only after owner approval and Meta review.

## 13. Content planner and calendar
Draft, approved, scheduled, published and failed content; calendar views; filters; workspace planning; reusable brand assets; history. Provider-neutral design for future platforms; never claim unsupported platforms.

## 14. Secure platform administration
Server-side authorisation on every admin operation; platform admin vs workspace admin separation; strong authentication; re-authentication for sensitive operations; optional MFA with enforcement for privileged roles where feasible; secure sessions; least privilege; RLS; cross-tenant isolation; rate limiting; audit logging; sensitive-action confirmation; subscription, customer and workspace management; usage and job visibility; provider configuration; safe feature flags; abuse and failure monitoring; no service-role secrets in client code. Test privilege escalation, unauthorised direct API calls and cross-tenant access. Report evidence and remaining risks; never claim absolute security.

## 15. Accounts, subscriptions and billing
Sign-up, email confirmation, sign-in, password recovery, sessions, workspace creation, plan selection, subscription requests, secure activation with admin approval where required, usage metering, quotas, expiry, grace period, entitlement enforcement, clear upgrade/downgrade. Accurate pricing; advertise only available features; no real payment collection without owner approval; no unlimited paid generation without budget and usage controls.

## 16. Supabase and multi-tenant architecture
Inspect before adding. Safe additive migrations; no destructive resets; RLS on tenant data; membership checks; secure RPCs; storage policies; asset ownership; auditability; job idempotency; retention and cleanup. Update save logic so character-free product/business projects are valid while keeping character and scene validation where appropriate. Preserve the 18-character catalog. Avoid duplicate tables and redundant migrations. Provider secrets server-side only.

## 17. Provider architecture — real APIs last
Adapters for text/reasoning, image generation/editing, video generation, voice, rendering, Facebook, future social platforms. Interfaces, capability declarations, job orchestration, rate limits, usage accounting, failure handling. Mock and real adapters separated; mock output visibly labelled. No paid calls in this phase. Afterwards: provider selection report (capabilities, quality, consistency, languages, voice quality, price, API availability, commercial terms, latency, reliability, rate limits, content policies, fallbacks) and owner approval before connecting paid APIs.

## 18. UX and languages
English, French, Arabic (RTL) and German; mobile and desktop for all major workflows; no mixed-language screens, reversed Arabic numbers, overflowing cards or inaccessible controls; clear status labels (draft, approved, rendering, completed, failed, published); no fake completion states.

## 19. Implementation order
0 Baseline audit · 1 Security and onboarding · 2 Universal creation architecture · 3 Creative editing · 4 Characters · 5 Serialized storytelling · 6 Image Studio · 7 Video export · 8 Social publishing · 9 Full verification · 10 Real provider integrations (only after owner approval of providers, credentials, budgets and live actions). Order changes must be explained and documented.

## 20. Non-negotiable rules
Don't rebuild working features unnecessarily; don't change the approved design; don't overwrite production; don't merge into `main` without explicit approval; no paid APIs; no real social publishing; never invent test results, generated media or credentials; never expose secrets; don't modify unrelated projects; don't restart MagicFlux or the trading platform; never reset the production database; no destructive E2E tests on real customer data; plans are not completed functionality. Small reviewable commits; tests after each milestone; when blocked, stop only the dependent operation.

## 21. Acceptance scenarios
- **A Product seller:** sign up → Product Ad → upload product photo → idea → AI script draft → edit → create/edit post image → prepare scenes → export real MP4 from available media → download. No character.
- **B Serialized storyteller:** series → canonical characters → episode 1 → edit dialogue → approve ending → Story Bible → Continue Story → episode 2 with continuity → episode 3.
- **C Restaurant owner:** promotional video and social post with branding, images, offer and editable text.
- **D Facebook manager:** AI post draft → edit caption → choose image → approve → schedule → simulated publish succeeds → history.
- **E Authorised automation:** enable auto-publishing with restrictions → simulated posts follow rules → emergency stop prevents further publishing.
- **F Platform administrator:** secure review of subscriptions and usage → authorised actions → all audited; other users and workspaces denied.
- **G Export reliability:** sample-media video downloaded on desktop and mobile; MP4 dimensions, duration, audio and playback verified.

## 22. Persistent project memory
`docs/PRODUCT_SPEC.md`, `docs/IMPLEMENTATION_STATUS.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, `docs/TEST_REPORT.md`, `docs/NEXT_STEPS.md`, and a root `CLAUDE.md`. No credentials in docs. Update after each milestone.

## 23. Reporting per milestone
Verified starting state · implemented features · changed files · migrations · test commands and actual results · commit and branch · preview URL · blockers · exact next step.
