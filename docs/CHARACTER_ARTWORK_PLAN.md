# Character artwork readiness plan

Status (2026-10-18): **no character artwork, reference image or rig exists** — locally or in production.
All 18 design specs are *proposed* (seeded by pending migration #6, not yet in production). Every character
shows "Reference pending" and visual generation for characters is blocked by the database and by
`paidCallBlockers` (`missing_character_reference`). This plan says exactly what must be produced and how it
is accepted. The per-character specification (shape, colours, outfits, identity text) is in
`CHARACTER_REFERENCE_GUIDE.md`, generated from `lib/characters/canon.ts`.

## 1. Roster (3 families × 6 variants)
| Family | Species | Variants (code) | Crown / signature |
|---|---|---|---|
| LIMO | tomato | `limo_boy`, `limo_girl`, `limo_man`, `limo_woman`, `limo_elder_man`, `limo_elder_woman` | five-point star calyx, stem curled to the character's right; glossy skin, one highlight upper left |
| NOVA | strawberry | `nova_boy`, `nova_girl`, `nova_man`, `nova_woman`, `nova_elder_man`, `nova_elder_woman` | ruff of five broad green sepals with a small upright stem; satin skin with golden seeds (never over eyes, mouth, cheeks) |
| ADAM | potato | `adam_boy`, `adam_girl`, `adam_man`, `adam_woman`, `adam_elder_man`, `adam_elder_woman` | two-leaf sprout (left leaf larger); matte skin, three potato-eye spots in fixed positions |
Heights in head units: child 2.6 · elder 3.2 · adult 3.4 (must hold when characters stand together).

## 2. Exact deliverables
Per character:
| Item | Required for "ready" | Count |
|---|---|---|
| Spec v1 approved by the owner (Admin → Characters) | **yes** | 1 approval |
| Reference images `front`, `side`, `three_quarter` (everyday outfit, neutral) | **yes** | 3 |
| `back` view | recommended (video turnarounds) | 1 |
| Expressions (head + shoulders, front): neutral, happy, laughing, surprised, sad, thinking, determined, worried | recommended (story scenes, image consistency) | 8 |
| Outfits full body three-quarter: everyday, special | recommended | 2 |
| Rigged model `.glb` (humanoid skeleton, 8 expression blend shapes, real scale) | only for future 3D animation | 1 |

Totals: **54 required images** (18 × 3) for generation readiness; **252 images** for the full sheet set
(18 × 14); 18 optional rigs. Recommended order: one family's adult man first (pilot), review, then the rest of
that family, then the other two families — so style corrections happen once.

Technical format (enforced or checked at review): PNG/WebP/JPEG, 3:4 portrait, ≥ 2048 × 2730 px, sRGB, no text,
logos, watermarks or signatures, ≤ 100 MB; neutral background `#EFECF7`, shared light rig and 50 mm camera
(guide §1). Rig: glTF 2.0 binary preferred.

## 3. Sourcing options (owner decision)
| Option | Pros | Risks / needs |
|---|---|---|
| Commissioned 3D artist (model + renders) | consistent identity across all views; rigs possible; clear rights | time and fee; written transfer of rights incl. derivative/AI-reference use |
| Commissioned 2D/3D-look illustrator | faster for still references | no rig; consistency of 14 views must be reviewed closely |
| AI image provider (character-consistent) | fast iteration | needs an approved provider (PROVIDER_INTEGRATION_PLAN), owner-approved paid calls, provenance recorded as `AI-generated`; consistency across views is the main risk; check the provider's terms for commercial use |
Whatever the source, the upload records the source (own / commissioned / AI-generated / render of a 3D model)
and a note; provenance is shown to admins.

## 4. Acceptance checklist (per file; the app enforces the first block)
Enforced in Admin → Characters → review dialog (file must be opened by the reviewer within 24 h, every box checked):
- [ ] Matches the design spec (crown, face layout, colours)
- [ ] Proportions match the spec (head units, head width vs shoulders)
- [ ] Colours match the palette (hex values in the guide)
- [ ] Family-friendly and on-brand
- [ ] Shows the selected view / expression / outfit
- [ ] No text, logos or watermarks
- [ ] Rigs only: opened and checked in a 3D tool

Additionally checked by the owner before approving a family (not enforced by the app):
- [ ] Side-by-side lineup of the 6 variants at correct relative heights
- [ ] Same light rig, camera and background on every sheet
- [ ] None of the "Never" list (guide §3): human skin/face, hair, ≠ 4 fingers, extra limbs, changed crown/colours, photoreal food texture, scary or adult content, placeholder art
- [ ] Rights: written licence/assignment on file (or provider terms recorded for AI-generated art)
- [ ] Arabic, French, English, German names/labels checked in the app's character picker

## 5. Steps to "ready for generation"
1. Owner reviews and approves spec v1 of each character (after migration #6 is applied in production).
2. Artwork produced (§3); files named `<code>_<view>.png`.
3. MFA platform admin uploads each file (Admin → Characters → Upload a reference) with source and note.
4. Review with the checklist; approve or reject with a reason.
5. The character turns "Ready" when spec + front + side + three-quarter of that spec version are approved.
6. Verify in the app: the character picker no longer says "artwork pending"; a story illustration of that
   character uses the reference (once a character-consistent image provider is enabled — separate approval).

## 6. What will not be claimed
No document, test or UI may state that artwork or rigs exist until §5 step 5 is done for that character.
Mock layouts and story illustrations today show "artwork pending" and are labelled mock — verified again by
the Milestone 9 story journey (`tests/e2e/journeys.spec.ts`).
