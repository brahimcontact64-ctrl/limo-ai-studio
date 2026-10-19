# Flagship video #1 — "The Supernatural Eye" (pre-production, 2026-10-19)

Status: **pre-production only.** The owner's scenario is saved as a draft storyboard in Animation Studio (local
replica). Nothing generated, nothing approved, nothing spent. Original story; no existing show, character or footage
is used. Scenario file: `docs/flagship/supernatural-eye.scenario.json`. Artwork prompts:
`docs/flagship/SUPERNATURAL_EYE_ARTWORK_PROMPTS.md`.

## 1. Six-shot storyboard (9:16, 30 s = 4 + 4 + 4 + 6 + 8 + 4 — all allowed Veo lengths)
| # | Time | Cast | What we see | Speech | Sound | How it is made |
|---|---|---|---|---|---|---|
| 1 | 0–4 s | `adam_man` (father), `adam_boy` (biological son), adopted son (**casting decision §3**) | Mansion hall, dramatic low-key light. Father points angrily at his son; the adopted son stands proudly at his side; the son flinches. Low angle on the father, slow push-in on the son. | Father: «هذاك ربّيناه، بصح نتا ما تسوا والو!» | hall room tone, string hit on the point | AI keyframe (approved references) → Veo image-to-video |
| 2 | 4–8 s | `adam_boy` (father's wrist only) | The son's eye glows gold (effect only); over-the-shoulder to the father's watch; price overlay. | Son (whisper): «واش؟! هذي اللي يقول عليها بمليون؟!» (**timing §2**) | magic shimmer, scan tick | AI keyframe → Veo; overlay «السعر الحقيقي: 1,200 دج» as a render text layer |
| 3 | 8–12 s | `adam_boy` | Close-up; he turns to the camera, knowing look; impact; freeze frame; transition. | Son: «استنّى… نقدر نشوف حتى واش راه مخبّي!» (**timing §2**) | impact boom, whoosh | AI keyframe → Veo; freeze frame in the render |
| 4 | 12–18 s | — | The freeze frame becomes the Animation Studio storyboard on a phone; genuine LIMO logo + wordmark. | Narration: «عجبتك القصة؟ تقدر تصنع كيفها بـLIMO AI!» | modern music starts, UI click | **real screen capture + approved logo** (no AI UI) |
| 5 | 18–26 s | — | Four real screens (~2 s each): Animation Studio workflow · Facebook composer with AI proposals + Image Studio · calendar & scheduling · language switch AR/FR/EN/DE. | Narration: «فيديوهات، بوستات، وجدولة لصفحتك… بأربع لغات!» | whoosh per cut | **real screen captures**; accuracy rules §6 |
| 6 | 26–30 s | — | Premium LIMO logo reveal; text «اصنع. برمج. انشر.» | Narration: «LIMO AI… خيالك، يخدم وحدو!» | final hit, music ends at 30 s | approved logo + render text layer |
Continuity: shots 1–3 share `mansion_hall`, the same evening light and one continuous moment; the father wears the gold
watch on the left wrist from shot 1; the gold eye glow never replaces the canonical iris colour (#2B2118) outside the
effect. Shots 4–6 share `limo_brand` (approved lavender/white design).

## 2. Dialogue timing review (Algerian Darija; estimate, to confirm with a voice actor)
Method: syllables at a natural dramatic pace (≈ 4.5 syllables/s spoken, 4 syllables/s whispered), plus the non-speech
action each shot needs. The app's own check (≤ 2.5 words/s) passes every line — too coarse for these shots, so this
manual review is stricter.
| Shot | Line (as approved) | Syllables | Speech time | Other action in the shot | Fits 4/6/8 s? |
|---|---|---|---|---|---|
| 1 | هذاك ربّيناه، بصح نتا ما تسوا والو! | ≈ 12 | ≈ 2.7 s + 0.3 s pause | 0.3 s lead, son's reaction | **Yes**, tight (≈ 3.3 s of speech, reaction overlaps the end) |
| 2 | واش؟! هذي اللي يقول عليها بمليون؟! | ≈ 13 | ≈ 3.2 s (whisper) | ≈ 1.8 s glow → look → price overlay | **No** (≈ 5 s) |
| 3 | استنّى… نقدر نشوف حتى واش راه مخبّي! | ≈ 13 + pause | ≈ 2.9 s + 0.4 s | 0.3 s lead + 0.5 s freeze | **Borderline** (≈ 4.1 s); fits only if delivered briskly |
| 4 | عجبتك القصة؟ تقدر تصنع كيفها بـLIMO AI! | ≈ 17 | ≈ 3.8 s | logo reveal | Yes (6 s) |
| 5 | فيديوهات، بوستات، وجدولة لصفحتك… بأربع لغات! | ≈ 17 | ≈ 4.2 s | four screen cuts | Yes (8 s) |
| 6 | LIMO AI… خيالك، يخدم وحدو! | ≈ 11 + pause | ≈ 2.6 s | logo | Yes (4 s) |
**Proposals for owner approval (nothing changed in the saved storyboard):**
- Shot 2 — option A (keep timing): «واش؟! هذي بمليون؟!» (≈ 6 syllables, ≈ 1.5 s). Option B (keep the line): shot 2 → 6 s and
  shot 5 → 6 s (4 + 6 + 4 + 6 + 6 + 4 = 30 s; four product screens at 1.5 s each).
- Shot 3 — option A: «استنّى… نقدر نشوف واش مخبّي!» (≈ 10 syllables, fits with the freeze). Option B: keep the line and
  accept a brisk delivery (the voice actor decides by ear).
- TTS note: write «بـ ليمو إي آي» in the voice script so "LIMO AI" is pronounced as the brand.

## 3. Casting and missing-character decisions (owner approval needed)
| Role | Proposal | Why |
|---|---|---|
| Father | canonical **`adam_man`** | ADAM adult male; matches the brief |
| Biological son | canonical **`adam_boy`** | the only ADAM boy (child, 2.6 heads tall) |
| Adopted son | **Option A (recommended): canonical `limo_boy`** (tomato boy raised in the potato family). **Option B: a workspace guest character** "ADAM adopted son" (potato boy with a distinct outfit/sprout so viewers can tell the sons apart) | The canon has one ADAM boy; no 19th canonical character is created. A makes "adopted" readable at a glance and reuses the canon; B keeps an all-potato family but needs its own spec, artwork and approval. Saved storyboard uses A **marked as proposed**. |
Spec gaps (specs are NOT changed; each change would be a new spec version for approval):
- **"Angry" is not one of the 8 canonical expressions** (neutral, happy, laughing, surprised, sad, thinking,
  determined, worried). The storyboard uses `determined` for the father; an `angry` sheet needs spec v2.
- **The father's canonical outfits are casual** (everyday shirt/chinos; special light jacket). Luxury is carried by the
  mansion set and the gold watch prop; a suit would need spec v2.
- Family-friendliness: the father's line insults a child; mild family-drama tone — the owner confirms it is acceptable
  for LIMO's audience.

## 4. Official artwork plan (prompts ready; not generated)
Per character, in order (prompts in SUPERNATURAL_EYE_ARTWORK_PROMPTS.md, built from the canon): front → three-quarter →
side (identity-locked to the approved front) → expressions needed by the shots (`adam_man`: determined, neutral;
`adam_boy`: surprised, determined, neutral; adopted son: neutral, happy) → clothing (`adam_man` special outfit, `adam_boy`
everyday). Accessories used in the film are props, not identity: the gold watch, the gold eye glow (effect). Review:
the app checklist + identity list per character, two-factor admin approval.

## 5. Voice and sound design
Voices (one fixed voice per character, Algerian Darija): father — deep, authoritative adult male; biological son —
young boy, bright, expressive (whisper in shot 2); narrator — warm, modern, energetic. **Darija authenticity is the main
risk:** Veo's own dialogue is documented for English ("other languages may vary"); ElevenLabs and Gemini TTS support
Arabic, Algerian Darija quality is **unverified**. Recommended test: the same shot-3 line by (a) a native Darija voice
actor, (b) ElevenLabs, (c) Gemini TTS — owner chooses by ear. Mouth movement: lip-sync (sync.so, experimental) on the
generated clip, or Runway Act-Two driven by the actor's own recorded performance (most controllable; one character per
generation). Sound: per-shot cues in §1; music ducks automatically under speech (−9 dB); own/licensed music only.

## 6. Product accuracy (shots 4–6)
| Shown | State today | How to show it |
|---|---|---|
| Animation Studio (storyboard, approvals, export) | built and tested; AI generation awaiting provider activation | real capture; no claim that AI clips are generated live today |
| Facebook composer, AI captions, Image Studio | built; real AI behind flags (off); mock proposals labelled | real capture of the workflow |
| Calendar and scheduling | built and tested | real capture |
| Publishing to Facebook | **simulated only**; real Meta publishing disabled (app review + owner approval) | do not show a live post; optional on-screen note «النشر التلقائي على فيسبوك: قريبًا» |
| Four languages | built (AR RTL, FR, EN, DE) | real capture of the language switch |
Owner decision: the tagline «اصنع. برمج. انشر.» and «جدولة لصفحتك» promise publishing — keep with the "قريبًا" note,
or adjust the wording. Not changed without approval.

## 7. First-shot visual direction (shot 1)
Mansion hall at night: polished dark marble, a large gold chandelier as the warm key light from above-left, cool
blue-grey rim light from tall windows behind; deep shadows, heavy burgundy curtains. Blocking (canonical heights: adult
3.4 heads, children 2.6): father centre-left, slightly above camera, arm extended toward the biological son in the left
foreground (back three-quarter, face turning to camera as he flinches); adopted son at the father's right, arms crossed.
Low angle, 35 mm feel, slow push-in toward the son's face over 4 s. Stylized premium 3D (no photorealism), canonical
colours unchanged under dramatic light. Three characters in one shot is the hardest case (identity/interaction not
guaranteed) — keyframe first, human approval, and consider a two-shot fallback (father + son, adopted son in a cut).
**Recommendation: run the first 4-second animation test on shot 3** (one character, close-up, dialogue): it tests
identity, facial motion, Darija voice and lip-sync at the lowest cost and risk; shot 1 comes after.

## 8. Estimated cost (researched list prices of 2026-10-18, NOT verified; nothing approved)
| Item | Count | Unit | Estimate |
|---|---|---|---|
| Required views (3 characters × front / three-quarter / side) | 9 | Gemini 3 Pro Image 4K $0.24 | $2.16 per pass |
| Expressions needed (father determined; son surprised + determined) | 3 | $0.24 | $0.72 per pass |
| Artwork with ≈ 2 attempts each | 24 | | **≈ $5.76** (one pass $2.88) |
| Optional outfit sheets (father special, son everyday) | 2 | $0.24 | + $0.48 |
| 4 s test, shot 3: keyframe (Pro 2K, ≤ 2 attempts) | 2 | $0.134 | $0.27 |
| 4 s clip, Veo 3.1 Fast 720p (image-to-video), 2 takes | 2 × 4 s | $0.10/s | $0.80 |
| or Veo 3.1 Standard 720p, 2 takes | 2 × 4 s | $0.40/s | $3.20 |
| Voices for the test (TTS, 3 candidates) | 3 lines | ≈ $0.01 | ≈ $0.03 |
| Lip-sync test (sync.so, experimental) | 4 s | $0.05/s | $0.20 (+ $5/month plan if used) |
**Totals:** artwork ≈ $2.9–5.8; 4 s test ≈ $1.1 (Fast) to ≈ $3.5 (Standard); together ≈ **$4–9.3** before
subscriptions. Cash: Google prepay minimum $5 (non-refundable credit); a $10 top-up covers artwork + a Fast test. A
voice actor's fee is outside LIMO. Spend guard: the existing `pilot` scope ($1 per operation) fits Fast 4 s clips
($0.40); a Standard 4 s clip ($1.60) needs a separately approved `flagship` scope.

## 9. Reviewing the scenario in Animation Studio (local replica)
1. Docker Desktop running (owner starts it); local stack up (`limo-local-e2e`).
2. Build and start the app locally (`npm run build`, then `npx next start -p 3200` with the local Supabase env), or ask
   Claude to start it.
3. Sign in at http://localhost:3200 as the local test account `alpha@limo.test` (workspace "E2E test workspace A").
4. Sidebar → **Animation Studio** → "The Supernatural Eye — LIMO AI Studio" (project
   `b8b9ddd3-aab7-42bd-9695-9d0160f45c1a`).
5. Read: Production settings (Arabic, 9:16, separate voices, lip-sync flagged experimental) · Plan & readiness (costs,
   warnings — multi-character shot 1, Darija native-audio caveat — and the blockers per character) · each shot (text,
   cast, actions, expressions, dialogue, narration, sound, Continuity).
6. Do not press Generate: AI animation is switched off and the characters have no approved artwork (the buttons stay
   disabled). To re-import after edits: `node scripts/import-animation-scenario.ts docs/flagship/supernatural-eye.scenario.json --lip-sync`.

## 10. Technical blockers
1. **Characters:** specs of `adam_man`, `adam_boy` (and the adopted son) not approved; no approved references → keyframes
   and clips are refused (by design).
2. **Spec gaps:** no "angry" expression; casual canonical outfits (spec v2 only with approval).
3. **Darija voices:** no verified provider for authentic Darija; no voice identities set (`character_voice_profiles`).
4. **Lip-sync / Act-Two:** no adapter yet (experimental path documented).
5. **Shots 4–6 in Animation Studio:** a shot can only get its clip from an AI job today; using the owner's own screen
   captures and the logo as a shot's media is **not implemented** (small feature, needs approval). Alternative today:
   assemble shots 4–6 as a normal Studio video project and join the two exports outside LIMO (not recommended).
6. **Overlays and effects:** text overlays (price, tagline) and a freeze frame are not available in animation exports
   (studio exports support on-screen text); small render-spec feature, needs approval.
7. **Veo person restrictions:** image-to-video allows `allow_adult` only in MENA; whether stylized child characters
   (both sons) are affected is unverified — the shot-3 test answers it early.
8. **Accounts and switches:** no provider account, key, verified price or enabled flag (owner actions,
   FLAGSHIP_VIDEO_CHECKLIST.md §C). Migration #14 is local only (production unaffected).

## 11. Approvals requested now (nothing proceeds without them)
1. Storyboard as saved, and the timing options for shots 2 and 3.
2. Casting: adopted son = `limo_boy` (A) or a workspace guest character (B).
3. Father's expression `determined` (no spec change) or a spec v2 with "angry"; outfit as canon or spec v2.
4. Product-accuracy wording (tagline / Facebook "قريبًا" note).
5. Whether to build the two small features (own media as a shot; overlays + freeze frame) before production.
6. Artwork stage (≈ $3–6) and then the shot-3 4-second test (≈ $1.1 Fast), with accounts and deposits.
