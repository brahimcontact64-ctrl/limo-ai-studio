# Premium animated character video — pipeline, providers, costs (2026-10-18)

Status: **prepared, nothing generated, nothing spent.** The first flagship video features the canonical LIMO / NOVA /
ADAM characters; **the owner writes the scenario** (story, dialogue, characters, setting, actions). This document and
`lib/animation/scenario.ts` only prepare the production. LIMO is not reduced to a slideshow: every shot of the
flagship is a genuinely generated video clip (body and facial motion), never camera movement over a still.
Research from official pages on 2026-10-18; "unverified" = not stated on a page I could read.

## 1. Character artwork production plan (characters first)
All 18 specs (`lib/characters/canon.ts`, v1, *proposed*) are preserved unchanged. No artwork exists yet.
| Step | What | How in LIMO | Gate |
|---|---|---|---|
| 1 Canonical identity | the written spec: head, crown, face, palette (hex), proportions in head units, outfits, 8 expressions, negative rules | Admin → Characters → Open → Approve spec v1 | owner approves each cast character's spec |
| 2 Front master | text-only render, 3:4, ≥ 2048 × 2730 (Gemini 3 Pro Image, 4K tier) | `node scripts/ai-pilot.ts --step character-front` (limo_man; same prompt builder for others) | human review + MFA admin approval |
| 3 Side + three-quarter | generated WITH the approved front as identity reference (≤ 5 character refs) | `sheetPlan` order in `lib/characters/artwork.ts` | approval per view |
| 4 Expressions | 8 head-and-shoulders sheets from the approved front | `sheetPlan` | optional before animation; needed for close-up dialogue |
| 5 Clothing/accessories | everyday + special outfit sheets | `sheetPlan` | optional |
| 6 Identity versioning | references are tied to `spec_version`; a spec change creates v2 and old references no longer satisfy it | existing `character_reference_assets` | automatic |
| 7 Voice identity | one fixed voice per character and language (`character_voice_profiles`: provider + voice id) | owner chooses (casting), see §4 | owner approval |
| 8 Consistency checks | identity checklist (`identityChecks`) + Claude vision review of keyframes vs references | storyboard `continuity_review` op | blocks a clip until passed |
| 9 Human approval | app-enforced checklist, file must be opened, MFA admin | existing review dialog | required |
| 10 Reuse | approved references feed every keyframe of every episode | `readinessBlockers` + planner | — |
A 3D-style render is an image, never a rigged model (`references.ts` keeps the kinds separate).
Cost per character (front + three-quarter + side at 4K, ≈ 2 attempts each): ≈ $1.45; expressions + outfits ≈ $2.40 more.

## 2. Animation provider comparison (character animation quality first)
| Provider / model | Documented capabilities relevant to talking characters | Price (official, 2026-10-18) | Account | Verdict |
|---|---|---|---|---|
| **Google Veo 3.1** `veo-3.1-generate-preview` / **Fast** `veo-3.1-fast-generate-preview` (Gemini API) | image-to-video from a first frame; `lastFrame` (interpolation); up to **3 asset reference images "of a single person, character or product"** (8 s only, not Lite); extension +7 s (720p); 4/6/8 s, 24 fps, 16:9 / 9:16, 720p / 1080p / 4K; **native audio always on** — dialogue written in quotes, sound effects, ambience ("synchronized soundtrack"; lip-sync is not claimed); English fully supported, other languages "may vary"; SynthID; 2-day retention | Standard $0.40 / s, Fast $0.10 (720p) – $0.12 (1080p) / s, Lite $0.05–0.08 / s (no references) | Gemini prepay, min $5, hard stop at $0 | **Primary.** Adapter exists (M10). Best documented motion + speech in one call |
| **Runway API** `act_two` (endpoint `character_performance`) | performance capture: an actor's recorded performance drives a character image/video (face, lip movement, gestures per Runway's description); driving performance up to 30 s, min 3 s; multi-character dialogue = one generation per character (help article; details not readable, 403) | $0.05 / s (5 credits, credit $0.01) | Runway developer portal, prepaid credits; min purchase $10 (third-party source, **unverified**); spend cap **unverified** | **Best control for hero dialogue shots** if the owner records the performance; no adapter yet |
| Runway API `gen4.5`, `gen4_image` (+ `referenceImages` with `@tag`), `kling3.0_*`, `veo3.1(_fast)`, ElevenLabs voices | one account for many models; Kling 3.0 3–15 s with multishot prompts and optional audio | gen4.5 $0.12/s; kling3.0 standard $0.09–0.13/s, pro $0.12–0.17/s; veo3.1 $0.40/s (audio) — dearer than Gemini direct | as above | Alternative / fallback source (owner decision, never an automatic fallback) |
| Kling direct API (kling.ai/dev) | references ("element binding"), multishot, lip sync, motion control (secondary sources) | prepaid packages from ≈ $700 (5,000 units) | large minimum | **Not for the pilot** (minimum far above budget); Kling 3.0 reachable through Runway |
| OpenAI Sora | — | **no video section on the official pricing page** (2026-10-18); third parties report the API was shut down in Sept 2026 | — | **Excluded** (not verifiably available) |
| sync.so `lipsync-2` | re-times mouth movement in an existing video to a new audio track | $0.05 / s (Hobbyist $5/month), free 3 generations/month ≤ 20 s | subscription | **Experimental** for stylized fruit faces (unverified); no adapter |
| Gemini 3 Pro Image `gemini-3-pro-image` | keyframes and references: up to 5 character + 6 object + 3 style references | $0.134 (1K/2K), $0.24 (4K) | Gemini prepay | **Primary for references and keyframes** (adapter exists) |
| Voices: ElevenLabs, Gemini TTS | ElevenLabs fixed voice ids, multilingual (ar/fr/de/en), timestamps; Gemini TTS 30 voices, fr/de/ar, no timestamps | ElevenLabs $0.04–0.08 / 1k chars (paid plan for commercial use); Gemini TTS ≈ $0.01 / line | ElevenLabs: no documented hard cap | adapters exist for both |
Limits nobody documents as guaranteed: identical identity across every shot, more than one referenced character in a
Veo reference set, lip-sync on non-human faces, consistent Veo-native voices across shots. These are tested, not promised.
Region note: Gemini states `personGeneration` is `allow_adult` only for image-to-video in EU/UK/CH/MENA; whether
stylized child characters (boy/girl) trigger person restrictions is **unverified** — test with an adult character first.

## 3. Proposed character-consistent architecture ("keyframe first")
Approved scenario → `validateScenario` (≤ 30 s, 4/6/8 s shots, known characters, speakers in scene) →
`readinessBlockers` (approved spec + front/three-quarter/side + voice identity) → `storyboard` per shot:
1. **Keyframe** — Gemini 3 Pro Image composes the shot's characters in the environment from their APPROVED references
   (multi-character identity is locked best in a still, ≤ 5 character refs). Claude continuity review + **human
   approval of the keyframe** (cheap: $0.13) before any clip is paid.
2. **Clip** — Veo 3.1 image-to-video from the approved keyframe (genuine motion, gestures, expressions, camera).
   Optional `lastFrame` = next shot's keyframe for smooth scene-to-scene continuity; single-character shots may add
   up to 3 asset references (8 s).
3. **Voice** — Track A: Veo native dialogue (fast, English best; voice not fixed across shots). Track B (recommended
   for the series): each line from the character's fixed voice identity (ElevenLabs/Gemini TTS), then lip-sync
   (sync.so, experimental) or, for hero shots, Runway Act-Two driven by a recorded performance.
4. **Review & corrections** — per-shot approve/regenerate (one shot at a time, the spend guard reserves each take);
   continuity checklist across shots (colours, crown, outfit, lighting, environment).
5. **Final MP4** — the existing render worker assembles the approved clips (≤ 30 s, one video credit), music track;
   a per-shot dialogue/SFX track mix with ducking is **not yet in the render plan** (to build).
Multiple characters interacting: compose them in the keyframe, keep one speaker per shot, cut between speakers
(classic shot/reverse-shot) — this matches what the tools document instead of relying on undocumented behaviour.

## 4. Voice and lip-sync approach
- Voice identity = `character_voice_profiles` (character × language → provider + voice id), chosen once by the owner
  and reused in every episode. Emotion comes from the line's `emotion` (ElevenLabs v3/v4 audio tags; Gemini TTS
  style prompts) — never a different voice.
- Lip-sync options, honestly ranked: (1) Veo native dialogue — synchronized by generation, not by a lip-sync
  guarantee, voice not controllable; (2) Runway Act-Two — documented performance transfer, needs an actor recording
  per line; (3) sync.so lipsync-2 on the generated clip — documented for video re-timing, stylized faces unverified.
  The first demo should test (1) and (3) on ONE shot before committing the whole video.
- Sound effects: Veo native audio or ElevenLabs sound effects (via Runway); music: licensed/owned track in the render.

## 5. Cost of a genuine 30-second character video (4 shots: 8 + 8 + 8 + 6 s)
Computed by `storyboard()` with the researched list prices (planning only):
| Pass | Per take | Notes |
|---|---|---|
| Draft (Veo 3.1 Fast 720p, native audio) | **$3.62** | 4 keyframes $0.54 + clips $3.00 + reviews $0.08 |
| Final (Veo 3.1 Standard 1080p, separate voices + lip-sync) | **$14.16** | keyframes $0.54 + clips $12.00 + voices $0.04 + lip-sync $1.50 + reviews $0.08 |
| Character artwork (2 characters, 3 views, ≈ 2 attempts) | ≈ $2.90 | prerequisite, one-time per character |
Realistic production = artwork + 2 draft takes + 2 final takes + text ≈ $2.90 + $7.24 + $28.32 + $0.20 ≈ **$38.7**,
plus subscriptions if used (sync.so $5/month; ElevenLabs paid plan for commercial voices).

## 6. First-demo budget recommendation
- **$10 can produce a genuinely animated demo, but not reliably a premium one**: artwork for 2 characters (≈ $2.90)
  + one Veo 3.1 Fast 720p take with native audio ($3.62) + a partial retake (≈ $2.50) ≈ $9.0. That is real motion
  and speech, but 720p, voices not fixed, French dialogue quality "may vary", almost no room for retakes.
- **Minimum realistic for a premium result: ≈ $40; recommended ceiling $60** (artwork $5, drafts $8, finals $30,
  voice/lip-sync/mix $7, contingency $10), approved in **stages** — each stage needs a go:
  S1 artwork (≤ $5) → S2 keyframes + Fast drafts (≤ $10) → S3 Standard finals (≤ $35) → S4 voice/lip-sync/mix (≤ $10).
- The pilot spend scope (per-operation cap $1, video $3) is too small for 8 s Standard clips ($3.20): a separate
  `flagship` scope must be created by the owner at approval time (e.g. limit 6000 ¢, per-operation 400 ¢).
- Cash: Google prepay ≥ $5 (top up to the stage amount), Anthropic credits (minimum unverified); optional sync.so $5/month.

## 7. Exact missing dependencies
1. Owner: the scenario (§9), approval of the cast characters' specs, approved front/three-quarter/side references.
2. Owner: voice identity per speaking character and language (`character_voice_profiles`).
3. Owner: accounts, deposits, keys (Google; Anthropic; optional sync.so / Runway), verified prices, `flagship` scope.
4. Code (not built): persisted storyboard + per-shot run (keyframe → approval → clip → approval) reusing the
   generator worker and spend guard; Veo `lastFrame` in the adapter (reference images and first frame exist);
   lip-sync adapter (sync.so) and/or Act-Two adapter; per-shot dialogue/SFX mixing with ducking in the render plan;
   storyboard UI (shot list, keyframe/clip approval, regenerate one shot).
5. Legal: Gemini terms (18+, not for apps directed at minors) vs LIMO's family audience; person-generation behaviour
   with child characters in MENA (test).

## 8. Step-by-step implementation plan
1. ✅ Scenario intake, validation, readiness and storyboard costing (`lib/animation/scenario.ts`, tests).
2. ✅ Storyboard persistence (migration 20261019090000, pending) + Animation Studio UI (`/app/animation`).
3. ✅ Generator: keyframe job with approved references → human approval → clip job (Veo, async) → approval;
   voice job with fixed voice identities; all behind `animation_generation` (off) + paid gates.
4. ✅ Veo `lastFrame` (first + last frame) in the adapter; continuity checks in the editor. Claude vision review
   of keyframes vs references: planned (not built).
5. ✅ Render: per-shot clip sound (Veo native audio) kept or muted + voice lines at their offsets (real FFmpeg test);
   music track as before. Music ducking and subtitles from voice timing: not built.
6. Lip-sync adapter (sync.so) / Act-Two adapter: not built (owner decision on the method first).
7. After approvals: S1 artwork → S2 drafts → S3 finals → S4 mix → review against §10 → record results honestly.

## 8a. Implementation status (2026-10-19) — real, mock, prepared, blocked
| Piece | State |
|---|---|
| Persisted scenario + shots (`animation_projects`, `animation_shots`, events) | **implemented locally** (migration #14 pending for production) |
| Storyboard editor (shots, 4/6/8 s, ≤ 30 s, characters, actions, expressions, camera, dialogue, narration, sound, continuity, references, reorder) | **implemented**, browser-tested |
| Canonical (18) + workspace character selection; approved reference attachment (≤ 5, validated server-side) | **implemented**; no canonical artwork exists → canonical characters stay **blocked** |
| Per-shot keyframe / clip approve, reject with a note, revise (edits send a shot back to draft, revision + 1) | **implemented** |
| First / last frame (approved keyframe; previous shot's last frame; next shot's keyframe as last frame) | **implemented** (Veo request shape from the docs; not live-tested) |
| Dialogue / narration timeline (planned → measured), voice jobs with offsets | **implemented** (mock voices); real voices need voice identities per character |
| Audio mix (clip sound + voice layers) in the render worker | **implemented**, real MP4 test |
| AI jobs queue, status, errors, quarantine, async polling | **implemented**; mock mode end to end |
| Export through the existing render worker (one credit, ≤ 30 s) | **implemented**, real MP4 in e2e |
| Real keyframes / clips / voices | **blocked**: flag off, no accounts/keys, prices unverified, no approved artwork |
| Mock clip | honest: "no animation was generated", cannot be approved |

## 9. What the owner provides with the scenario (template)
Use this JSON shape (`Scenario` in `lib/animation/scenario.ts`); every field is the owner's own text:
```json
{
  "title": "…",
  "language": "fr | ar | en | de",
  "aspect": "9:16 | 16:9",
  "music": "mood / genre (own or licensed track)",
  "scenes": [
    {
      "number": 1,
      "durationSeconds": 8,
      "description": "what happens",
      "environment": "where, time of day, mood, lighting",
      "characters": ["limo_man", "nova_girl"],
      "actions": { "limo_man": "…", "nova_girl": "…" },
      "expressions": { "limo_man": "happy", "nova_girl": "surprised" },
      "camera": "framing and movement",
      "dialogue": [{ "speaker": "limo_man", "text": "…", "emotion": "happy" }],
      "narration": "optional narrator line",
      "sound": "sound effects / ambience"
    }
  ]
}
```
Also needed: total ≤ 30 s (shots of 4, 6 or 8 s); which characters speak and their voice choice per language;
whether dialogue may be Veo-native or must use fixed voices; target platform (aspect); brand elements to show
(logo/end card, added in the render); and the approved budget stage.

## 10. Quality acceptance criteria (first real character video)
Recognisable canonical identity (checklist per character) · genuine body and facial motion (not a pan over a still) ·
natural gestures · dialogue quality and correct language · lip-sync where supported (state which method) · stable
clothing and proportions · shot-to-shot continuity · coherent timing (≤ 30 s) · clean audio levels · professional
composition · playable MP4. Every failure is written down; a valid MP4 is not automatically a good film.
