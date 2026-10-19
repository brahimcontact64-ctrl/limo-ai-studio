# `adam_boy` — owner-approved design vs canonical spec v1 (2026-10-19)

**Owner decision (2026-10-19):** the 3D potato-boy character sheet supplied by the owner is approved as the **primary
visual reference** for `adam_boy`. Preserve: golden anthropomorphic potato body with natural speckles; large expressive
brown eyes; rosy cheeks and a small potato-shaped nose; navy school blazer, white shirt, red striped tie; brown
trousers, brown shoes, brown backpack; premium cinematic 3D style; one identity across angles and expressions. Never a
human child.

**What exists and what does not:** one composite design sheet (JPEG 1145 × 1374 px, SHA-256
`6ffe3206a853a35933848c65a549051adbe5ccb3e807c2bbc01576d5301fd20a`) with a hero image, four small turnaround panels
(front, three-quarter, side, back ≈ 180 × 320 px each), four detail crops and six expression heads, plus Arabic text.
The separate front / three-quarter / side / expression reference files of the LIMO workflow have **not** been
generated, uploaded or reviewed. Nothing in the database changed; the other 17 characters are untouched.

## 1. Comparison with spec v1 (canon.ts, family ADAM + variant boy)
| Feature | Spec v1 | Approved image | Versioned update? |
|---|---|---|---|
| Species / style | anthropomorphic potato, premium stylized 3D, no photorealism | same; cinematic 3D | no |
| Head shape | oval, lumpy, taller than wide, **soft bump upper left** | smooth egg/oval, taller than wide; no distinct bump | **yes** (drop or soften the bump) |
| Crown | **two-leaf green sprout**, left leaf larger | **no sprout** | **yes** (major identity change) |
| Surface | matte, **exactly three** potato-eye spots (1 forehead upper-left, 2 right cheek) | many natural speckles all over | **yes** |
| Skin colour | `#C99A62` tan (shadow `#9A7146`, highlight `#E3BE8A`) | warmer golden yellow (≈ `#E2B259` by eye — measure from the final front file) | **yes** (new hex values) |
| Eyes | **small** bright eyes, dark brown iris `#2B2118`, one catchlight | **large** expressive eyes, warm brown iris, catchlight | **yes** (size; iris hex) |
| Cheeks | not specified | rosy cheeks | **yes** (add) |
| Nose / mouth | round button nose, friendly wide mouth | small potato-shaped nose, small mouth | yes (wording) |
| Brows | expressive | expressive dark brows | no |
| Proportions | 2.6 heads tall, posture upright/energetic | ≈ 2.2–2.4 heads (by eye, bigger head) | **yes** (re-measure on the final front) |
| Hands | four-finger cartoon hands | gloved-looking mitten hands holding straps; finger count not readable | check on the front (keep "four fingers") |
| Everyday outfit | striped T-shirt, knee shorts, sneakers (`#3D5A80`, `#E0A526`) | **navy school blazer, white shirt, red striped tie, brown trousers, brown shoes** | **yes** (new outfit "school") |
| Accessory | small cap backwards on special occasions | **brown leather backpack** (small potato emblem on the flap) | **yes** (add backpack; emblem = a logo-like mark → owner decides keep/remove; the negative prompt forbids logos) |
| Personality / age | "playful and curious", child | kind, smart, sensitive, brave; ≈ 10 years | yes (text only) |
| Expressions | 8: neutral, happy, laughing, surprised, sad, thinking, determined, worried | 6 shown: neutral, surprised, sad, determined, happy, thinking | no (missing laughing, worried — generate later) |
| Views | front, three-quarter, side (+ back optional) | front, three-quarter, side, back (small panels) | no |

**Family consistency (owner decision needed):** the ADAM family traits (sprout, three fixed spots, tan `#C99A62`,
small eyes) are shared by all six ADAM variants. Changing them only for `adam_boy` makes him look unlike `adam_man`
(his father in shots 1–2, approved variant built on the v1 family look). Options: (a) `adam_boy` v2 only (the father
keeps the sprout — visibly different look in the same family); (b) later, a family-wide ADAM v2 (affects `adam_man`,
`adam_woman`, `adam_girl`, elders — each needs its own approval and artwork). Recommendation: (a) now for the shot-3
test, decide (b) before shot 1 is produced.

## 2. Importing the approved image into the `adam_boy` review workflow
The composite sheet cannot be one of the canonical view slots: it contains text (the review box "no text or
watermark" would be false), several views in one file, and its panels are far below sheet resolution (2048 × 2731).
It also contradicts spec v1, so "identity matches spec" would be false. Therefore:
1. **Spec `adam_boy` v2 (versioned, admin two-factor, audited):** Admin → Characters → Adam · boy → propose v2 with
   the changes marked "yes" above (`admin_propose_character_spec`; v1 stays in history). The proposal note records
   the owner's approval and the sheet's SHA-256. Other characters are untouched. Code follow-up (small, tested,
   local): per-character spec versions in `canon.ts` (today one global `CANON_SPEC_VERSION = 1`) so prompts and
   packages read `adam_boy` v2 and requests carry `specVersion: 2`.
2. **Store the approved sheet as the design source** of v2 in the private `character-library` bucket under
   `canonical/adam_boy/v2/` as a non-view reference (provenance = the real origin of the image, e.g. "ai_generated"
   + the tool used, entered by the owner). Today the upload refuses a rendered reference without view, expression or
   outfit; with the v2 outfit key `school` it can be registered as the "school" outfit reference (not a view slot,
   never counts for readiness). Leave it **pending review** if its text makes the checklist untrue — it is a source,
   not a production reference.
3. **Approve spec v2** (two-factor) only after reading the text; spec approval never approves artwork.

## 3. Exact next steps — official reference package, then the 4-second shot-3 test
1. Owner: confirm the family option (a or b), the backpack emblem, and the provenance of the sheet.
2. Claude (local, unpaid, tests, local commit; push only with approval): spec v2 text for `adam_boy`, per-character
   spec versions, package v2 (prompts rebuilt from v2; the approved sheet attached as the **style/identity source
   image** for the front so Gemini 3 Pro Image keeps this design — Pro accepts up to 5 character + 6 object + 3 style
   images), regenerated read-only preview and estimate.
3. Owner (local replica, two-factor): propose → read → approve `adam_boy` v2; upload the design sheet (pending/source).
4. Owner: account, $5 prepay (auto-reload off), key in the local generator env only, price re-read on the official
   page and recorded in `google_character_image_v1`, `paid_generation` on, written amount (front ≈ $0.27; package
   ≈ $1.33; with one retry each ≈ $2.66; cap $5).
5. Generate `view:front` (one call) → owner reviews against spec v2 + the approved sheet → approve or reject.
6. With the approved front as identity reference: `three_quarter`, `side`, `surprised`, `determined` (4 calls) →
   review each → approve. The character becomes **ready** only when spec v2 + front + three-quarter + side are approved.
7. Shot-3 test (separate written authorisation; flags `animation_generation` + paid on the local replica only):
   keyframe with the approved references (≤ 2 attempts, ≈ $0.27) → your identity confirmation → Veo 3.1 Fast 720p
   image-to-video 4 s (≈ $0.40 per take, ≤ 2 takes; Veo price and model id to be re-checked the same day) → Darija
   voice comparison → optional lip-sync → review (ANIMATION_PIPELINE §10). Estimated ≈ $1.1 (Fast).

Nothing above has been executed; no image generated, no paid API, no spend, no production or `main` change.
