# First flagship character video — owner checklist

For the owner. Nothing below has been generated or spent. Tick each item in order; the app refuses the next step
until the previous one is in place. Details: ANIMATION_PIPELINE.md.

## A. What you provide
- [ ] **Scenario** in the template (ANIMATION_PIPELINE.md §9): title, language, 9:16 or 16:9, 2–4 shots of 4/6/8 s
      (≤ 30 s total), per shot: what happens, setting, characters, actions, expressions, camera, dialogue (who says
      what), narration, sound. Paste it in Animation Studio → "Import scenario (JSON)".
- [ ] **Cast**: which of the 18 canonical characters appear (one speaker per shot works best).
- [ ] **Voices**: one voice per speaking character and language (ElevenLabs voice id or a Gemini voice name), or the
      decision to use Veo's own dialogue (English works best; voices then change between shots).
- [ ] **Music**: an audio file you own or licensed (it ducks automatically under speech), or none.
- [ ] **Budget stage** approved (ANIMATION_PIPELINE.md §6): S1 artwork ≤ $5 → S2 keyframes + drafts ≤ $10 →
      S3 finals ≤ $35 → S4 voices/mix ≤ $10. Each stage is a separate go.

## B. Before any AI animation (characters first)
- [ ] Approve the **design spec v1** of each cast character (Admin → Characters).
- [ ] Get **front, three-quarter and side** references for each (AI pilot runner or commissioned art), review each
      file with the checklist, approve with two-factor. Canonical characters stay blocked until then.
- [ ] Legal check of the Gemini terms (18+, not for apps directed at minors) for LIMO's audience; test person
      restrictions with an adult character first (child characters in MENA: unverified).

## C. Accounts and switches (owner actions; nothing is on today)
- [ ] Google AI (prepay, no auto-reload) and Anthropic (prepaid + spend limit) accounts; keys only in the generator
      environment. Optional later: lip-sync (sync.so) or Runway Act-Two.
- [ ] Re-verify prices; record them (`ai_provider_registry` + `verified_at`); enable the needed rows.
- [ ] Create a `flagship` spend scope sized to the approved stage (per-operation cap ≥ $3.20 for 8 s Veo clips).
- [ ] Turn on `paid_generation` and `animation_generation` on the **local replica** only; generator in live mode
      with `LIMO_AI_SPEND_SCOPE=flagship`, `LIMO_AI_MAX_ATTEMPTS=1`.

## D. Making it (per shot, in the app)
- [ ] Keyframe → read the automated checks (they only catch obvious problems) → compare with the references →
      tick the identity confirmation → approve, or request changes.
- [ ] Voices → listen; the timeline shows measured positions.
- [ ] Clip → watch for real motion, identity, gestures, mouth movement → confirm identity → approve, or request
      changes (max 5 attempts per shot version; editing a shot starts a new version).
- [ ] Export → the render worker assembles the approved clips (≤ 30 s, one video credit; an identical re-export
      costs nothing).

## E. Accept or reject the result (ANIMATION_PIPELINE.md §10)
Recognisable identity · real body and facial motion · natural gestures · dialogue quality · lip-sync (say which
method) · stable clothing and proportions · shot-to-shot continuity · timing · clean audio · composition · playable
MP4. Write down every failure; a valid MP4 is not automatically a good film.

## What already works (mock) and what does not yet
Works today with mock providers: scenario import, storyboard, references, keyframe/clip approval with identity
confirmation, voices with timeline, continuity checks, music ducking, export through the render worker, Arabic RTL.
Not available yet: real keyframes/clips/voices (switches and accounts above), lip-sync and Act-Two (no adapter),
vision-based identity checking (none; a person decides), subtitles from voice timing in animation exports.
