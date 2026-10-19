# The Supernatural Eye — character artwork production packages

**Nothing generated, nothing approved.** Prompts are built by code from the canonical specs v1 (`sheetPrompt`) and, for the
father, from the owner-APPROVED scene variant `adam_man.formal_angry` v1 (`lib/characters/variants.ts`, `variantPrompt`;
database row in `character_variants`, migration 20261019180000). Approving the variant approved no artwork. The 18
canonical specs are unchanged. Format: 3:4 portrait, ≥ 2048 × 2730 (Gemini 3 Pro Image 4K tier, $0.24 per image, list
price 2026-10-18, unverified), no text in the image. Each file: open it, tick the checklist, approve with two-factor
(Admin → Characters). Order: front first (text only), other views identity-locked to the APPROVED front.

## Package: `adam_boy` **spec v1** — kept for history; NOT the production package any more (the owner approved the v2 design on 2026-10-19 — see the v2 package at the end)
Biological son — shots 1, 2, 3. Needed FIRST: the 4-second animation test is shot 3 (close-up of this character).

- **Machine-readable package:** [`packages/adam_boy.artwork.v1.json`](packages/adam_boy.artwork.v1.json) — exact prompts,
  request keys, size 2048 × 2731 (Gemini 3 Pro Image 4K tier), upload metadata; a unit test keeps it equal to the code.
- **Runner:** `node scripts/flagship/artwork-sheet.ts --character adam_boy --sheet <slot>` — dry run by default (prints the
  prompt, the planning estimate and the gates that block); a live call needs every paid-generation gate (see the dossier §15).
- **Order:** `view:front` (text only) → owner reviews and approves it (Admin → Characters, two-factor, checklist) → the other
  four sheets, each sent with the APPROVED front as the only identity reference (`--front-asset <id>`).
- **Prerequisite in the database:** the canonical design spec `adam_boy` v1 is still *proposed*; approve it (Admin →
  Characters, two-factor) so the approved views make the character ready for animation.
- **Identity review per image:** the checklist below + the six review boxes (identity matches spec, proportions, palette,
  family-friendly, view correct, no text/watermark). Reject anything that drifts; a retry is a new paid call.

**Identity checklist (every sheet):**
- [ ] Head: Oval, gently lumpy potato head, a little taller than wide, with a soft asymmetric bump on the upper left.
- [ ] Crown: Two-leaf green sprout growing from the top; the left leaf is larger than the right.
- [ ] Face: Small bright eyes with dark brown irises and one white catchlight each, expressive brows, round button nose, friendly wide mouth.
- [ ] About 2.6 heads tall; upright, energetic, slight forward lean
- [ ] Colours: skin #C99A62, skin_shadow #9A7146, skin_highlight #E3BE8A, spots #8C6A43, crown #6CBF4B, iris #2B2118
- [ ] Detail: three potato-eye spots in fixed positions
- [ ] Detail: two-leaf sprout, left leaf larger
- [ ] Detail: small cap worn backwards on special occasions only
- [ ] Four fingers per hand, no hair, no text or logo, family-friendly

### View: front (canonical)
```text
ADAM young boy: premium stylized 3D anthropomorphic potato character for a family-friendly animated series. Oval, gently lumpy potato head, a little taller than wide, with a soft asymmetric bump on the upper left. Two-leaf green sprout growing from the top; the left leaf is larger than the right. Matte, softly textured skin with three small darker “potato eye” spots: one on the upper left forehead, two on the right cheek. Small bright eyes with dark brown irises and one white catchlight each, expressive brows, round button nose, friendly wide mouth. Small rounded child body, short arms and legs, four-finger cartoon hands, skin-coloured limbs. About 2.6 heads tall; upright, energetic, slight forward lean. Colours: skin #C99A62, crown #6CBF4B, iris #2B2118. Details: three potato-eye spots in fixed positions; two-leaf sprout, left leaf larger; small cap worn backwards on special occasions only.
Outfit: Striped T-shirt, knee-length shorts and sneakers (colours #3D5A80, #E0A526).
Front view, facing the camera, relaxed neutral standing pose, arms slightly away from the body (about 15°), feet shoulder width.
Neutral expression.
Premium stylized 3D character render for a family-friendly animated series, clean readable shapes, soft global illumination, no photorealism. Key light 45° camera-left and above, soft fill camera-right at 40 %, rim light from behind; plain neutral grey-lavender background #EFECF7; contact shadow only. 50 mm equivalent lens at chest height, character centred and fully visible with 8 % margin, no perspective exaggeration.
Locked colours: skin #C99A62, crown #6CBF4B, iris #2B2118.
Never: realistic human skin or human face; hair on the head (the crown replaces hair); more or fewer than four fingers per hand; extra limbs or duplicated features; changing the family colour, crown shape or face layout; text, logos or watermarks; scary, violent or adult content; photorealistic food textures.
```

### View: three_quarter (canonical)
```text
ADAM young boy: premium stylized 3D anthropomorphic potato character for a family-friendly animated series. Oval, gently lumpy potato head, a little taller than wide, with a soft asymmetric bump on the upper left. Two-leaf green sprout growing from the top; the left leaf is larger than the right. Matte, softly textured skin with three small darker “potato eye” spots: one on the upper left forehead, two on the right cheek. Small bright eyes with dark brown irises and one white catchlight each, expressive brows, round button nose, friendly wide mouth. Small rounded child body, short arms and legs, four-finger cartoon hands, skin-coloured limbs. About 2.6 heads tall; upright, energetic, slight forward lean. Colours: skin #C99A62, crown #6CBF4B, iris #2B2118. Details: three potato-eye spots in fixed positions; two-leaf sprout, left leaf larger; small cap worn backwards on special occasions only.
Outfit: Striped T-shirt, knee-length shorts and sneakers (colours #3D5A80, #E0A526).
Three-quarter view turned 45° to the left, same pose and outfit as the reference.
Neutral expression.
Premium stylized 3D character render for a family-friendly animated series, clean readable shapes, soft global illumination, no photorealism. Key light 45° camera-left and above, soft fill camera-right at 40 %, rim light from behind; plain neutral grey-lavender background #EFECF7; contact shadow only. 50 mm equivalent lens at chest height, character centred and fully visible with 8 % margin, no perspective exaggeration.
Locked colours: skin #C99A62, crown #6CBF4B, iris #2B2118.
Never: realistic human skin or human face; hair on the head (the crown replaces hair); more or fewer than four fingers per hand; extra limbs or duplicated features; changing the family colour, crown shape or face layout; text, logos or watermarks; scary, violent or adult content; photorealistic food textures.
The attached image is the APPROVED canonical front view of this exact character: keep the identity identical (head shape, sprout, potato-eye spots, colours, face layout, proportions, outfit).
```

### View: side (canonical)
```text
ADAM young boy: premium stylized 3D anthropomorphic potato character for a family-friendly animated series. Oval, gently lumpy potato head, a little taller than wide, with a soft asymmetric bump on the upper left. Two-leaf green sprout growing from the top; the left leaf is larger than the right. Matte, softly textured skin with three small darker “potato eye” spots: one on the upper left forehead, two on the right cheek. Small bright eyes with dark brown irises and one white catchlight each, expressive brows, round button nose, friendly wide mouth. Small rounded child body, short arms and legs, four-finger cartoon hands, skin-coloured limbs. About 2.6 heads tall; upright, energetic, slight forward lean. Colours: skin #C99A62, crown #6CBF4B, iris #2B2118. Details: three potato-eye spots in fixed positions; two-leaf sprout, left leaf larger; small cap worn backwards on special occasions only.
Outfit: Striped T-shirt, knee-length shorts and sneakers (colours #3D5A80, #E0A526).
Side view (profile facing left), same pose and outfit as the reference.
Neutral expression.
Premium stylized 3D character render for a family-friendly animated series, clean readable shapes, soft global illumination, no photorealism. Key light 45° camera-left and above, soft fill camera-right at 40 %, rim light from behind; plain neutral grey-lavender background #EFECF7; contact shadow only. 50 mm equivalent lens at chest height, character centred and fully visible with 8 % margin, no perspective exaggeration.
Locked colours: skin #C99A62, crown #6CBF4B, iris #2B2118.
Never: realistic human skin or human face; hair on the head (the crown replaces hair); more or fewer than four fingers per hand; extra limbs or duplicated features; changing the family colour, crown shape or face layout; text, logos or watermarks; scary, violent or adult content; photorealistic food textures.
The attached image is the APPROVED canonical front view of this exact character: keep the identity identical (head shape, sprout, potato-eye spots, colours, face layout, proportions, outfit).
```

### Expression: surprised (canonical)
```text
ADAM young boy: premium stylized 3D anthropomorphic potato character for a family-friendly animated series. Oval, gently lumpy potato head, a little taller than wide, with a soft asymmetric bump on the upper left. Two-leaf green sprout growing from the top; the left leaf is larger than the right. Matte, softly textured skin with three small darker “potato eye” spots: one on the upper left forehead, two on the right cheek. Small bright eyes with dark brown irises and one white catchlight each, expressive brows, round button nose, friendly wide mouth. Small rounded child body, short arms and legs, four-finger cartoon hands, skin-coloured limbs. About 2.6 heads tall; upright, energetic, slight forward lean. Colours: skin #C99A62, crown #6CBF4B, iris #2B2118. Details: three potato-eye spots in fixed positions; two-leaf sprout, left leaf larger; small cap worn backwards on special occasions only.
Outfit: Striped T-shirt, knee-length shorts and sneakers (colours #3D5A80, #E0A526).
Head and shoulders, front view, expression: Eyes wide, brows raised high, small round open mouth.
Premium stylized 3D character render for a family-friendly animated series, clean readable shapes, soft global illumination, no photorealism. Key light 45° camera-left and above, soft fill camera-right at 40 %, rim light from behind; plain neutral grey-lavender background #EFECF7; contact shadow only. 50 mm equivalent lens at chest height, character centred and fully visible with 8 % margin, no perspective exaggeration.
Locked colours: skin #C99A62, crown #6CBF4B, iris #2B2118.
Never: realistic human skin or human face; hair on the head (the crown replaces hair); more or fewer than four fingers per hand; extra limbs or duplicated features; changing the family colour, crown shape or face layout; text, logos or watermarks; scary, violent or adult content; photorealistic food textures.
The attached image is the APPROVED canonical front view of this exact character: keep the identity identical (head shape, sprout, potato-eye spots, colours, face layout, proportions, outfit).
```

### Expression: determined (canonical)
```text
ADAM young boy: premium stylized 3D anthropomorphic potato character for a family-friendly animated series. Oval, gently lumpy potato head, a little taller than wide, with a soft asymmetric bump on the upper left. Two-leaf green sprout growing from the top; the left leaf is larger than the right. Matte, softly textured skin with three small darker “potato eye” spots: one on the upper left forehead, two on the right cheek. Small bright eyes with dark brown irises and one white catchlight each, expressive brows, round button nose, friendly wide mouth. Small rounded child body, short arms and legs, four-finger cartoon hands, skin-coloured limbs. About 2.6 heads tall; upright, energetic, slight forward lean. Colours: skin #C99A62, crown #6CBF4B, iris #2B2118. Details: three potato-eye spots in fixed positions; two-leaf sprout, left leaf larger; small cap worn backwards on special occasions only.
Outfit: Striped T-shirt, knee-length shorts and sneakers (colours #3D5A80, #E0A526).
Head and shoulders, front view, expression: Brows lowered and angled, focused eyes, firm closed mouth.
Premium stylized 3D character render for a family-friendly animated series, clean readable shapes, soft global illumination, no photorealism. Key light 45° camera-left and above, soft fill camera-right at 40 %, rim light from behind; plain neutral grey-lavender background #EFECF7; contact shadow only. 50 mm equivalent lens at chest height, character centred and fully visible with 8 % margin, no perspective exaggeration.
Locked colours: skin #C99A62, crown #6CBF4B, iris #2B2118.
Never: realistic human skin or human face; hair on the head (the crown replaces hair); more or fewer than four fingers per hand; extra limbs or duplicated features; changing the family colour, crown shape or face layout; text, logos or watermarks; scary, violent or adult content; photorealistic food textures.
The attached image is the APPROVED canonical front view of this exact character: keep the identity identical (head shape, sprout, potato-eye spots, colours, face layout, proportions, outfit).
```

## Package: `adam_man` — 5 images, one pass ≈ $1.20
Father — shots 1, 2. The canonical front locks the identity; the film uses the proposed formal + angry variant drawn on it.

**Identity checklist (every sheet):**
- [ ] Head: Oval, gently lumpy potato head, a little taller than wide, with a soft asymmetric bump on the upper left.
- [ ] Crown: Two-leaf green sprout growing from the top; the left leaf is larger than the right.
- [ ] Face: Small bright eyes with dark brown irises and one white catchlight each, expressive brows, round button nose, friendly wide mouth.
- [ ] About 3.4 heads tall; relaxed and confident
- [ ] Colours: skin #C99A62, skin_shadow #9A7146, skin_highlight #E3BE8A, spots #8C6A43, crown #6CBF4B, iris #2B2118
- [ ] Detail: three potato-eye spots in fixed positions
- [ ] Detail: two-leaf sprout, left leaf larger
- [ ] Detail: short neat brows
- [ ] Four fingers per hand, no hair, no text or logo, family-friendly

### View: front (canonical)
```text
ADAM adult man: premium stylized 3D anthropomorphic potato character for a family-friendly animated series. Oval, gently lumpy potato head, a little taller than wide, with a soft asymmetric bump on the upper left. Two-leaf green sprout growing from the top; the left leaf is larger than the right. Matte, softly textured skin with three small darker “potato eye” spots: one on the upper left forehead, two on the right cheek. Small bright eyes with dark brown irises and one white catchlight each, expressive brows, round button nose, friendly wide mouth. Adult body with broader shoulders, medium-length limbs, four-finger cartoon hands, skin-coloured limbs. About 3.4 heads tall; relaxed and confident. Colours: skin #C99A62, crown #6CBF4B, iris #2B2118. Details: three potato-eye spots in fixed positions; two-leaf sprout, left leaf larger; short neat brows.
Outfit: Button-up shirt with rolled sleeves, chinos and casual shoes (colours #3D5A80, #E0A526).
Front view, facing the camera, relaxed neutral standing pose, arms slightly away from the body (about 15°), feet shoulder width.
Neutral expression.
Premium stylized 3D character render for a family-friendly animated series, clean readable shapes, soft global illumination, no photorealism. Key light 45° camera-left and above, soft fill camera-right at 40 %, rim light from behind; plain neutral grey-lavender background #EFECF7; contact shadow only. 50 mm equivalent lens at chest height, character centred and fully visible with 8 % margin, no perspective exaggeration.
Locked colours: skin #C99A62, crown #6CBF4B, iris #2B2118.
Never: realistic human skin or human face; hair on the head (the crown replaces hair); more or fewer than four fingers per hand; extra limbs or duplicated features; changing the family colour, crown shape or face layout; text, logos or watermarks; scary, violent or adult content; photorealistic food textures.
```

### APPROVED variant `adam_man.formal_angry` v1 — approved by the owner in writing on 2026-10-19 (variant only; no artwork approved)
- Outfit "formal": Tailored charcoal three-piece suit with a crisp white dress shirt, burgundy silk tie and pocket square, gold cufflinks, polished black shoes; elegant and expensive-looking, clean stylized folds. Colours #2E3138, #F4F1EA, #7A1F2B, #E0A526. Accessories: gold wristwatch on the LEFT wrist (story prop used in shot 2; its design is generic, no brand or logo).
- Expression "angry": brows pulled down and together, eyes narrowed, mouth open mid-sentence with a hint of teeth, tense cheeks; strong but family-friendly anger, no distortion of the canonical face layout, no scary features.
- Variant checklist: [ ] identity identical to the approved canonical front (head, sprout, spots, colours, face layout, 3.4 heads) · [ ] suit reads wealthy and elegant, not a uniform · [ ] watch on the LEFT wrist, no brand · [ ] anger is strong but family-friendly.
- Upload: Admin → Characters → Adam · man → "Scene variant (approved)" = Formal suit · angry; the upload then accepts the variant's "formal" outfit and "angry" expression (only with that variant). Variant files never count as the canonical front / three-quarter / side.

### Variant front (formal, angry)
```text
ADAM adult man: premium stylized 3D anthropomorphic potato character for a family-friendly animated series. Oval, gently lumpy potato head, a little taller than wide, with a soft asymmetric bump on the upper left. Two-leaf green sprout growing from the top; the left leaf is larger than the right. Matte, softly textured skin with three small darker “potato eye” spots: one on the upper left forehead, two on the right cheek. Small bright eyes with dark brown irises and one white catchlight each, expressive brows, round button nose, friendly wide mouth. Adult body with broader shoulders, medium-length limbs, four-finger cartoon hands, skin-coloured limbs. About 3.4 heads tall; relaxed and confident. Colours: skin #C99A62, crown #6CBF4B, iris #2B2118. Details: three potato-eye spots in fixed positions; two-leaf sprout, left leaf larger; short neat brows.
Outfit (scene variant "formal", not the canonical outfit): Tailored charcoal three-piece suit with a crisp white dress shirt, burgundy silk tie and pocket square, gold cufflinks, polished black shoes; elegant and expensive-looking, clean stylized folds (colours #2E3138, #F4F1EA, #7A1F2B, #E0A526). Accessories: gold wristwatch on the LEFT wrist (story prop used in shot 2; its design is generic, no brand or logo).
Front view, facing the camera, standing pose, arms slightly away from the body (about 15°), feet shoulder width.
Expression (scene variant "angry"): brows pulled down and together, eyes narrowed, mouth open mid-sentence with a hint of teeth, tense cheeks; strong but family-friendly anger, no distortion of the canonical face layout, no scary features.
The character identity must stay exactly canonical: same head shape, crown, potato-eye spots, skin colour, face layout and proportions as the approved canonical references.
Premium stylized 3D character render for a family-friendly animated series, clean readable shapes, soft global illumination, no photorealism. Key light 45° camera-left and above, soft fill camera-right at 40 %, rim light from behind; plain neutral grey-lavender background #EFECF7; contact shadow only. 50 mm equivalent lens at chest height, character centred and fully visible with 8 % margin, no perspective exaggeration.
Locked colours: skin #C99A62, crown #6CBF4B, iris #2B2118.
Never: realistic human skin or human face; hair on the head (the crown replaces hair); more or fewer than four fingers per hand; extra limbs or duplicated features; changing the family colour, crown shape or face layout; text, logos or watermarks; scary, violent or adult content; photorealistic food textures.
```

### Variant three-quarter (formal)
```text
ADAM adult man: premium stylized 3D anthropomorphic potato character for a family-friendly animated series. Oval, gently lumpy potato head, a little taller than wide, with a soft asymmetric bump on the upper left. Two-leaf green sprout growing from the top; the left leaf is larger than the right. Matte, softly textured skin with three small darker “potato eye” spots: one on the upper left forehead, two on the right cheek. Small bright eyes with dark brown irises and one white catchlight each, expressive brows, round button nose, friendly wide mouth. Adult body with broader shoulders, medium-length limbs, four-finger cartoon hands, skin-coloured limbs. About 3.4 heads tall; relaxed and confident. Colours: skin #C99A62, crown #6CBF4B, iris #2B2118. Details: three potato-eye spots in fixed positions; two-leaf sprout, left leaf larger; short neat brows.
Outfit (scene variant "formal", not the canonical outfit): Tailored charcoal three-piece suit with a crisp white dress shirt, burgundy silk tie and pocket square, gold cufflinks, polished black shoes; elegant and expensive-looking, clean stylized folds (colours #2E3138, #F4F1EA, #7A1F2B, #E0A526). Accessories: gold wristwatch on the LEFT wrist (story prop used in shot 2; its design is generic, no brand or logo).
Three-quarter view turned 45° to the left, same pose and outfit as the reference.
Neutral expression.
The character identity must stay exactly canonical: same head shape, crown, potato-eye spots, skin colour, face layout and proportions as the approved canonical references.
Premium stylized 3D character render for a family-friendly animated series, clean readable shapes, soft global illumination, no photorealism. Key light 45° camera-left and above, soft fill camera-right at 40 %, rim light from behind; plain neutral grey-lavender background #EFECF7; contact shadow only. 50 mm equivalent lens at chest height, character centred and fully visible with 8 % margin, no perspective exaggeration.
Locked colours: skin #C99A62, crown #6CBF4B, iris #2B2118.
Never: realistic human skin or human face; hair on the head (the crown replaces hair); more or fewer than four fingers per hand; extra limbs or duplicated features; changing the family colour, crown shape or face layout; text, logos or watermarks; scary, violent or adult content; photorealistic food textures.
```

### Variant side (formal)
```text
ADAM adult man: premium stylized 3D anthropomorphic potato character for a family-friendly animated series. Oval, gently lumpy potato head, a little taller than wide, with a soft asymmetric bump on the upper left. Two-leaf green sprout growing from the top; the left leaf is larger than the right. Matte, softly textured skin with three small darker “potato eye” spots: one on the upper left forehead, two on the right cheek. Small bright eyes with dark brown irises and one white catchlight each, expressive brows, round button nose, friendly wide mouth. Adult body with broader shoulders, medium-length limbs, four-finger cartoon hands, skin-coloured limbs. About 3.4 heads tall; relaxed and confident. Colours: skin #C99A62, crown #6CBF4B, iris #2B2118. Details: three potato-eye spots in fixed positions; two-leaf sprout, left leaf larger; short neat brows.
Outfit (scene variant "formal", not the canonical outfit): Tailored charcoal three-piece suit with a crisp white dress shirt, burgundy silk tie and pocket square, gold cufflinks, polished black shoes; elegant and expensive-looking, clean stylized folds (colours #2E3138, #F4F1EA, #7A1F2B, #E0A526). Accessories: gold wristwatch on the LEFT wrist (story prop used in shot 2; its design is generic, no brand or logo).
Side view (profile facing left), same pose and outfit as the reference.
Neutral expression.
The character identity must stay exactly canonical: same head shape, crown, potato-eye spots, skin colour, face layout and proportions as the approved canonical references.
Premium stylized 3D character render for a family-friendly animated series, clean readable shapes, soft global illumination, no photorealism. Key light 45° camera-left and above, soft fill camera-right at 40 %, rim light from behind; plain neutral grey-lavender background #EFECF7; contact shadow only. 50 mm equivalent lens at chest height, character centred and fully visible with 8 % margin, no perspective exaggeration.
Locked colours: skin #C99A62, crown #6CBF4B, iris #2B2118.
Never: realistic human skin or human face; hair on the head (the crown replaces hair); more or fewer than four fingers per hand; extra limbs or duplicated features; changing the family colour, crown shape or face layout; text, logos or watermarks; scary, violent or adult content; photorealistic food textures.
```

### Variant expression: angry (head and shoulders)
```text
ADAM adult man: premium stylized 3D anthropomorphic potato character for a family-friendly animated series. Oval, gently lumpy potato head, a little taller than wide, with a soft asymmetric bump on the upper left. Two-leaf green sprout growing from the top; the left leaf is larger than the right. Matte, softly textured skin with three small darker “potato eye” spots: one on the upper left forehead, two on the right cheek. Small bright eyes with dark brown irises and one white catchlight each, expressive brows, round button nose, friendly wide mouth. Adult body with broader shoulders, medium-length limbs, four-finger cartoon hands, skin-coloured limbs. About 3.4 heads tall; relaxed and confident. Colours: skin #C99A62, crown #6CBF4B, iris #2B2118. Details: three potato-eye spots in fixed positions; two-leaf sprout, left leaf larger; short neat brows.
Outfit (scene variant "formal", not the canonical outfit): Tailored charcoal three-piece suit with a crisp white dress shirt, burgundy silk tie and pocket square, gold cufflinks, polished black shoes; elegant and expensive-looking, clean stylized folds (colours #2E3138, #F4F1EA, #7A1F2B, #E0A526). Accessories: gold wristwatch on the LEFT wrist (story prop used in shot 2; its design is generic, no brand or logo).
Head and shoulders, front view.
Expression (scene variant "angry"): brows pulled down and together, eyes narrowed, mouth open mid-sentence with a hint of teeth, tense cheeks; strong but family-friendly anger, no distortion of the canonical face layout, no scary features.
The character identity must stay exactly canonical: same head shape, crown, potato-eye spots, skin colour, face layout and proportions as the approved canonical references.
Premium stylized 3D character render for a family-friendly animated series, clean readable shapes, soft global illumination, no photorealism. Key light 45° camera-left and above, soft fill camera-right at 40 %, rim light from behind; plain neutral grey-lavender background #EFECF7; contact shadow only. 50 mm equivalent lens at chest height, character centred and fully visible with 8 % margin, no perspective exaggeration.
Locked colours: skin #C99A62, crown #6CBF4B, iris #2B2118.
Never: realistic human skin or human face; hair on the head (the crown replaces hair); more or fewer than four fingers per hand; extra limbs or duplicated features; changing the family colour, crown shape or face layout; text, logos or watermarks; scary, violent or adult content; photorealistic food textures.
```

## Package: `limo_boy` — 3 images, one pass ≈ $0.72
Adopted son (approved casting) — shot 1 only.

**Identity checklist (every sheet):**
- [ ] Head: Round glossy tomato head, slightly wider than tall, with four soft vertical lobes; the head is the largest part of the silhouette.
- [ ] Crown: Five-point star-shaped green calyx on top with a short curled stem tilted to the character’s right.
- [ ] Face: Large oval eyes with dark brown irises and two white catchlights, thick rounded brows one shade darker than the skin, small rounded nose bump, wide expressive mouth, soft cheek blush.
- [ ] About 2.6 heads tall; upright, energetic, slight forward lean
- [ ] Colours: skin #E8412C, skin_shadow #B82E1F, skin_highlight #FF7A5C, crown #3E9B3F, crown_shadow #2C7A31, iris #3B2A20
- [ ] Detail: curled stem tilted to the right
- [ ] Detail: four soft vertical lobes on the head
- [ ] Detail: small cap worn backwards on special occasions only
- [ ] Four fingers per hand, no hair, no text or logo, family-friendly

### View: front (canonical)
```text
LIMO young boy: premium stylized 3D anthropomorphic tomato character for a family-friendly animated series. Round glossy tomato head, slightly wider than tall, with four soft vertical lobes; the head is the largest part of the silhouette. Five-point star-shaped green calyx on top with a short curled stem tilted to the character’s right. Smooth glossy skin with one soft specular highlight on the upper left of the head and a subtle warm subsurface glow. Large oval eyes with dark brown irises and two white catchlights, thick rounded brows one shade darker than the skin, small rounded nose bump, wide expressive mouth, soft cheek blush. Small rounded child body, short arms and legs, four-finger cartoon hands, skin-coloured limbs. About 2.6 heads tall; upright, energetic, slight forward lean. Colours: skin #E8412C, crown #3E9B3F, iris #3B2A20. Details: curled stem tilted to the right; four soft vertical lobes on the head; small cap worn backwards on special occasions only.
Outfit: Striped T-shirt, knee-length shorts and sneakers (colours #2F6FDB, #F4F1EA).
Front view, facing the camera, relaxed neutral standing pose, arms slightly away from the body (about 15°), feet shoulder width.
Neutral expression.
Premium stylized 3D character render for a family-friendly animated series, clean readable shapes, soft global illumination, no photorealism. Key light 45° camera-left and above, soft fill camera-right at 40 %, rim light from behind; plain neutral grey-lavender background #EFECF7; contact shadow only. 50 mm equivalent lens at chest height, character centred and fully visible with 8 % margin, no perspective exaggeration.
Locked colours: skin #E8412C, crown #3E9B3F, iris #3B2A20.
Never: realistic human skin or human face; hair on the head (the crown replaces hair); more or fewer than four fingers per hand; extra limbs or duplicated features; changing the family colour, crown shape or face layout; text, logos or watermarks; scary, violent or adult content; photorealistic food textures.
```

### View: three_quarter (canonical)
```text
LIMO young boy: premium stylized 3D anthropomorphic tomato character for a family-friendly animated series. Round glossy tomato head, slightly wider than tall, with four soft vertical lobes; the head is the largest part of the silhouette. Five-point star-shaped green calyx on top with a short curled stem tilted to the character’s right. Smooth glossy skin with one soft specular highlight on the upper left of the head and a subtle warm subsurface glow. Large oval eyes with dark brown irises and two white catchlights, thick rounded brows one shade darker than the skin, small rounded nose bump, wide expressive mouth, soft cheek blush. Small rounded child body, short arms and legs, four-finger cartoon hands, skin-coloured limbs. About 2.6 heads tall; upright, energetic, slight forward lean. Colours: skin #E8412C, crown #3E9B3F, iris #3B2A20. Details: curled stem tilted to the right; four soft vertical lobes on the head; small cap worn backwards on special occasions only.
Outfit: Striped T-shirt, knee-length shorts and sneakers (colours #2F6FDB, #F4F1EA).
Three-quarter view turned 45° to the left, same pose and outfit as the reference.
Neutral expression.
Premium stylized 3D character render for a family-friendly animated series, clean readable shapes, soft global illumination, no photorealism. Key light 45° camera-left and above, soft fill camera-right at 40 %, rim light from behind; plain neutral grey-lavender background #EFECF7; contact shadow only. 50 mm equivalent lens at chest height, character centred and fully visible with 8 % margin, no perspective exaggeration.
Locked colours: skin #E8412C, crown #3E9B3F, iris #3B2A20.
Never: realistic human skin or human face; hair on the head (the crown replaces hair); more or fewer than four fingers per hand; extra limbs or duplicated features; changing the family colour, crown shape or face layout; text, logos or watermarks; scary, violent or adult content; photorealistic food textures.
```

### View: side (canonical)
```text
LIMO young boy: premium stylized 3D anthropomorphic tomato character for a family-friendly animated series. Round glossy tomato head, slightly wider than tall, with four soft vertical lobes; the head is the largest part of the silhouette. Five-point star-shaped green calyx on top with a short curled stem tilted to the character’s right. Smooth glossy skin with one soft specular highlight on the upper left of the head and a subtle warm subsurface glow. Large oval eyes with dark brown irises and two white catchlights, thick rounded brows one shade darker than the skin, small rounded nose bump, wide expressive mouth, soft cheek blush. Small rounded child body, short arms and legs, four-finger cartoon hands, skin-coloured limbs. About 2.6 heads tall; upright, energetic, slight forward lean. Colours: skin #E8412C, crown #3E9B3F, iris #3B2A20. Details: curled stem tilted to the right; four soft vertical lobes on the head; small cap worn backwards on special occasions only.
Outfit: Striped T-shirt, knee-length shorts and sneakers (colours #2F6FDB, #F4F1EA).
Side view (profile facing left), same pose and outfit as the reference.
Neutral expression.
Premium stylized 3D character render for a family-friendly animated series, clean readable shapes, soft global illumination, no photorealism. Key light 45° camera-left and above, soft fill camera-right at 40 %, rim light from behind; plain neutral grey-lavender background #EFECF7; contact shadow only. 50 mm equivalent lens at chest height, character centred and fully visible with 8 % margin, no perspective exaggeration.
Locked colours: skin #E8412C, crown #3E9B3F, iris #3B2A20.
Never: realistic human skin or human face; hair on the head (the crown replaces hair); more or fewer than four fingers per hand; extra limbs or duplicated features; changing the family colour, crown shape or face layout; text, logos or watermarks; scary, violent or adult content; photorealistic food textures.
```

## Budget (cap $5, spending authorisation $0)
One pass of all three packages = 13 images ≈ $3.12. Remaining ≈ $1.88 = about 7 retries.
Recommended order: `adam_boy` package (enables the shot-3 test) → `adam_man` canonical front + approved variant sheets → `limo_boy`.
The $0.24 per image is the researched list price (2026-10-18), NOT verified: re-check it on the official pricing page on the
day of generation and record it in the registry row before any paid call.

## Package: `adam_boy` **spec v2** (proposed) — 5 images, one pass ≈ $1.33 — PROMPTS READY FOR OWNER REVIEW (not generated)
Built by code from `lib/characters/spec-versions.ts` (adam_boy v2, status **proposed** in the database) — machine-readable:
[`packages/adam_boy.artwork.v2.json`](packages/adam_boy.artwork.v2.json); read-only request previews:
[`adam_boy.v2.view-front.preview.json`](packages/adam_boy.v2.view-front.preview.json),
[`adam_boy.v2.view-three_quarter.preview.json`](packages/adam_boy.v2.view-three_quarter.preview.json).

**Design source sent with every request:** the owner-approved composite sheet (ChatGPT Image Generation; SHA-256 `6ffe3206a853a35933848c65a549051adbe5ccb3e807c2bbc01576d5301fd20a`),
as a style/identity SOURCE image — never as an approved view. Front: design sheet only. Other sheets: the APPROVED v2 front first, then the
design sheet. The runner refuses unless the uploaded sheet's SHA-256 matches. Model `gemini-3-pro-image`, 3:4, 4K, JPEG.

**Estimates (researched official price, not owner-verified):** front $0.2658, each reference-locked sheet ≈ $0.2672 (incl. a 2,000-token thinking allowance).

**Identity checklist (v2):**
- [ ] Head: Smooth egg-shaped potato head, clearly taller than wide, softly rounded with gentle natural irregularities; the head is the largest part of the silhouette.
- [ ] Crown: No sprout, leaves, stem or hair on top of the head.
- [ ] Face: Large expressive eyes with warm-brown irises, black pupils and white catchlights; thick dark-brown expressive brows; round rosy cheeks; small potato-shaped nose; small gentle mouth.
- [ ] About 2.4 heads tall; upright, slightly shy, often holding the backpack straps
- [ ] Colours: skin #EC9E50, skin_shadow #CB7839, skin_highlight #F9C685, speckles #A65721, cheeks #E36439, iris #66301D, brows #4B2F21
- [ ] Detail: no sprout: smooth egg-shaped head
- [ ] Detail: many small natural speckles
- [ ] Detail: round rosy cheeks
- [ ] Detail: large warm-brown eyes with catchlights
- [ ] Detail: brown leather backpack with a small decorative potato emblem
- [ ] Four fingers per hand, no hair or sprout, no text or brand logo (backpack potato emblem allowed), family-friendly, never a human child

Plus the six review boxes: identity_matches_spec, proportions_match, palette_matches, family_friendly, view_correct, no_text_or_watermark.

### view:front (spec v2)
```text
ADAM young boy (about 10 years old): premium cinematic 3D anthropomorphic potato character for a family-friendly animated series — never a human child. Smooth egg-shaped potato head, clearly taller than wide, softly rounded with gentle natural irregularities; the head is the largest part of the silhouette. No sprout, leaves, stem or hair on top of the head. Golden potato skin, softly matte, covered with many small natural darker speckles and a few tiny potato-eye dimples (head and hands), never covering the eyes or mouth. Large expressive eyes with warm-brown irises, black pupils and white catchlights; thick dark-brown expressive brows; round rosy cheeks; small potato-shaped nose; small gentle mouth. Compact childlike body under the large head, short arms and legs, rounded four-finger cartoon hands with golden potato skin. About 2.4 heads tall; upright, slightly shy, often holding the backpack straps. Colours: skin #EC9E50, cheeks #E36439, iris #66301D. Details: no sprout: smooth egg-shaped head; many small natural speckles; round rosy cheeks; large warm-brown eyes with catchlights; brown leather backpack with a small decorative potato emblem.
Outfit: Navy school blazer with brown buttons over a white shirt, red tie with darker diagonal stripes, brown trousers, polished brown leather shoes; brown leather backpack worn on both shoulders, with a small decorative potato emblem on the flap (a character illustration, not a commercial logo) (colours #29293D, #FEF1E3, #942027, #613221, #743E2F).
Front view, facing the camera, relaxed neutral standing pose, arms slightly away from the body (about 15°), feet shoulder width.
Neutral expression.
Premium stylized 3D character render for a family-friendly animated series, clean readable shapes, soft global illumination, no photorealism. Key light 45° camera-left and above, soft fill camera-right at 40 %, rim light from behind; plain neutral grey-lavender background #EFECF7; contact shadow only. 50 mm equivalent lens at chest height, character centred and fully visible with 8 % margin, no perspective exaggeration.
Locked colours: skin #EC9E50, cheeks #E36439, iris #66301D.
Never: a human child, realistic human skin or a human face; hair, a sprout, leaves or a stem on the head; more or fewer than four fingers per hand; extra limbs or duplicated features; changing the skin colour, head shape or face layout; text, brand logos or watermarks (only the small decorative potato emblem on the backpack is allowed); scary, violent or adult content; photorealistic food textures.
The attached image is the owner-approved DESIGN SHEET of this character (a composite with several small views, detail crops, expression heads and text labels): match its character design, outfit, accessories, colours and 3D style exactly, but output ONE clean single front sheet with no text, labels or panels.
```

### view:three_quarter (spec v2) — needs the approved v2 front
```text
ADAM young boy (about 10 years old): premium cinematic 3D anthropomorphic potato character for a family-friendly animated series — never a human child. Smooth egg-shaped potato head, clearly taller than wide, softly rounded with gentle natural irregularities; the head is the largest part of the silhouette. No sprout, leaves, stem or hair on top of the head. Golden potato skin, softly matte, covered with many small natural darker speckles and a few tiny potato-eye dimples (head and hands), never covering the eyes or mouth. Large expressive eyes with warm-brown irises, black pupils and white catchlights; thick dark-brown expressive brows; round rosy cheeks; small potato-shaped nose; small gentle mouth. Compact childlike body under the large head, short arms and legs, rounded four-finger cartoon hands with golden potato skin. About 2.4 heads tall; upright, slightly shy, often holding the backpack straps. Colours: skin #EC9E50, cheeks #E36439, iris #66301D. Details: no sprout: smooth egg-shaped head; many small natural speckles; round rosy cheeks; large warm-brown eyes with catchlights; brown leather backpack with a small decorative potato emblem.
Outfit: Navy school blazer with brown buttons over a white shirt, red tie with darker diagonal stripes, brown trousers, polished brown leather shoes; brown leather backpack worn on both shoulders, with a small decorative potato emblem on the flap (a character illustration, not a commercial logo) (colours #29293D, #FEF1E3, #942027, #613221, #743E2F).
Three-quarter view turned 45° to the left, same pose and outfit as the reference.
Neutral expression.
Premium stylized 3D character render for a family-friendly animated series, clean readable shapes, soft global illumination, no photorealism. Key light 45° camera-left and above, soft fill camera-right at 40 %, rim light from behind; plain neutral grey-lavender background #EFECF7; contact shadow only. 50 mm equivalent lens at chest height, character centred and fully visible with 8 % margin, no perspective exaggeration.
Locked colours: skin #EC9E50, cheeks #E36439, iris #66301D.
Never: a human child, realistic human skin or a human face; hair, a sprout, leaves or a stem on the head; more or fewer than four fingers per hand; extra limbs or duplicated features; changing the skin colour, head shape or face layout; text, brand logos or watermarks (only the small decorative potato emblem on the backpack is allowed); scary, violent or adult content; photorealistic food textures.
The first attached image is the APPROVED canonical front view of this exact character: keep the identity identical (head shape, face layout, skin colour and speckles, eyes, cheeks, proportions, outfit and backpack).
The second attached image is the owner-approved DESIGN SHEET of this character (a composite with several small views, detail crops, expression heads and text labels): match its character design, outfit, accessories, colours and 3D style exactly, but output ONE clean single three-quarter sheet with no text, labels or panels.
```

### view:side (spec v2) — needs the approved v2 front
```text
ADAM young boy (about 10 years old): premium cinematic 3D anthropomorphic potato character for a family-friendly animated series — never a human child. Smooth egg-shaped potato head, clearly taller than wide, softly rounded with gentle natural irregularities; the head is the largest part of the silhouette. No sprout, leaves, stem or hair on top of the head. Golden potato skin, softly matte, covered with many small natural darker speckles and a few tiny potato-eye dimples (head and hands), never covering the eyes or mouth. Large expressive eyes with warm-brown irises, black pupils and white catchlights; thick dark-brown expressive brows; round rosy cheeks; small potato-shaped nose; small gentle mouth. Compact childlike body under the large head, short arms and legs, rounded four-finger cartoon hands with golden potato skin. About 2.4 heads tall; upright, slightly shy, often holding the backpack straps. Colours: skin #EC9E50, cheeks #E36439, iris #66301D. Details: no sprout: smooth egg-shaped head; many small natural speckles; round rosy cheeks; large warm-brown eyes with catchlights; brown leather backpack with a small decorative potato emblem.
Outfit: Navy school blazer with brown buttons over a white shirt, red tie with darker diagonal stripes, brown trousers, polished brown leather shoes; brown leather backpack worn on both shoulders, with a small decorative potato emblem on the flap (a character illustration, not a commercial logo) (colours #29293D, #FEF1E3, #942027, #613221, #743E2F).
Side view (profile facing left), same pose and outfit as the reference.
Neutral expression.
Premium stylized 3D character render for a family-friendly animated series, clean readable shapes, soft global illumination, no photorealism. Key light 45° camera-left and above, soft fill camera-right at 40 %, rim light from behind; plain neutral grey-lavender background #EFECF7; contact shadow only. 50 mm equivalent lens at chest height, character centred and fully visible with 8 % margin, no perspective exaggeration.
Locked colours: skin #EC9E50, cheeks #E36439, iris #66301D.
Never: a human child, realistic human skin or a human face; hair, a sprout, leaves or a stem on the head; more or fewer than four fingers per hand; extra limbs or duplicated features; changing the skin colour, head shape or face layout; text, brand logos or watermarks (only the small decorative potato emblem on the backpack is allowed); scary, violent or adult content; photorealistic food textures.
The first attached image is the APPROVED canonical front view of this exact character: keep the identity identical (head shape, face layout, skin colour and speckles, eyes, cheeks, proportions, outfit and backpack).
The second attached image is the owner-approved DESIGN SHEET of this character (a composite with several small views, detail crops, expression heads and text labels): match its character design, outfit, accessories, colours and 3D style exactly, but output ONE clean single side sheet with no text, labels or panels.
```

### expression:surprised (spec v2) — needs the approved v2 front
```text
ADAM young boy (about 10 years old): premium cinematic 3D anthropomorphic potato character for a family-friendly animated series — never a human child. Smooth egg-shaped potato head, clearly taller than wide, softly rounded with gentle natural irregularities; the head is the largest part of the silhouette. No sprout, leaves, stem or hair on top of the head. Golden potato skin, softly matte, covered with many small natural darker speckles and a few tiny potato-eye dimples (head and hands), never covering the eyes or mouth. Large expressive eyes with warm-brown irises, black pupils and white catchlights; thick dark-brown expressive brows; round rosy cheeks; small potato-shaped nose; small gentle mouth. Compact childlike body under the large head, short arms and legs, rounded four-finger cartoon hands with golden potato skin. About 2.4 heads tall; upright, slightly shy, often holding the backpack straps. Colours: skin #EC9E50, cheeks #E36439, iris #66301D. Details: no sprout: smooth egg-shaped head; many small natural speckles; round rosy cheeks; large warm-brown eyes with catchlights; brown leather backpack with a small decorative potato emblem.
Outfit: Navy school blazer with brown buttons over a white shirt, red tie with darker diagonal stripes, brown trousers, polished brown leather shoes; brown leather backpack worn on both shoulders, with a small decorative potato emblem on the flap (a character illustration, not a commercial logo) (colours #29293D, #FEF1E3, #942027, #613221, #743E2F).
Head and shoulders, front view, expression: Eyes wide, brows raised high, small round open mouth.
Premium stylized 3D character render for a family-friendly animated series, clean readable shapes, soft global illumination, no photorealism. Key light 45° camera-left and above, soft fill camera-right at 40 %, rim light from behind; plain neutral grey-lavender background #EFECF7; contact shadow only. 50 mm equivalent lens at chest height, character centred and fully visible with 8 % margin, no perspective exaggeration.
Locked colours: skin #EC9E50, cheeks #E36439, iris #66301D.
Never: a human child, realistic human skin or a human face; hair, a sprout, leaves or a stem on the head; more or fewer than four fingers per hand; extra limbs or duplicated features; changing the skin colour, head shape or face layout; text, brand logos or watermarks (only the small decorative potato emblem on the backpack is allowed); scary, violent or adult content; photorealistic food textures.
The first attached image is the APPROVED canonical front view of this exact character: keep the identity identical (head shape, face layout, skin colour and speckles, eyes, cheeks, proportions, outfit and backpack).
The second attached image is the owner-approved DESIGN SHEET of this character (a composite with several small views, detail crops, expression heads and text labels): match its character design, outfit, accessories, colours and 3D style exactly, but output ONE clean single surprised sheet with no text, labels or panels.
```

### expression:determined (spec v2) — needs the approved v2 front
```text
ADAM young boy (about 10 years old): premium cinematic 3D anthropomorphic potato character for a family-friendly animated series — never a human child. Smooth egg-shaped potato head, clearly taller than wide, softly rounded with gentle natural irregularities; the head is the largest part of the silhouette. No sprout, leaves, stem or hair on top of the head. Golden potato skin, softly matte, covered with many small natural darker speckles and a few tiny potato-eye dimples (head and hands), never covering the eyes or mouth. Large expressive eyes with warm-brown irises, black pupils and white catchlights; thick dark-brown expressive brows; round rosy cheeks; small potato-shaped nose; small gentle mouth. Compact childlike body under the large head, short arms and legs, rounded four-finger cartoon hands with golden potato skin. About 2.4 heads tall; upright, slightly shy, often holding the backpack straps. Colours: skin #EC9E50, cheeks #E36439, iris #66301D. Details: no sprout: smooth egg-shaped head; many small natural speckles; round rosy cheeks; large warm-brown eyes with catchlights; brown leather backpack with a small decorative potato emblem.
Outfit: Navy school blazer with brown buttons over a white shirt, red tie with darker diagonal stripes, brown trousers, polished brown leather shoes; brown leather backpack worn on both shoulders, with a small decorative potato emblem on the flap (a character illustration, not a commercial logo) (colours #29293D, #FEF1E3, #942027, #613221, #743E2F).
Head and shoulders, front view, expression: Brows lowered and angled, focused eyes, firm closed mouth.
Premium stylized 3D character render for a family-friendly animated series, clean readable shapes, soft global illumination, no photorealism. Key light 45° camera-left and above, soft fill camera-right at 40 %, rim light from behind; plain neutral grey-lavender background #EFECF7; contact shadow only. 50 mm equivalent lens at chest height, character centred and fully visible with 8 % margin, no perspective exaggeration.
Locked colours: skin #EC9E50, cheeks #E36439, iris #66301D.
Never: a human child, realistic human skin or a human face; hair, a sprout, leaves or a stem on the head; more or fewer than four fingers per hand; extra limbs or duplicated features; changing the skin colour, head shape or face layout; text, brand logos or watermarks (only the small decorative potato emblem on the backpack is allowed); scary, violent or adult content; photorealistic food textures.
The first attached image is the APPROVED canonical front view of this exact character: keep the identity identical (head shape, face layout, skin colour and speckles, eyes, cheeks, proportions, outfit and backpack).
The second attached image is the owner-approved DESIGN SHEET of this character (a composite with several small views, detail crops, expression heads and text labels): match its character design, outfit, accessories, colours and 3D style exactly, but output ONE clean single determined sheet with no text, labels or panels.
```
