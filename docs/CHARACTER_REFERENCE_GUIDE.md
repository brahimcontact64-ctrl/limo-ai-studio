# LIMO character reference production guide

Status: **for owner review**. Generated from `lib/characters/canon.ts` (design spec v1, status *proposed*). Regenerate with `node scripts/gen-character-guide.ts` after any canon change.

No artwork exists yet. Nothing in this guide is approved, and no image may be marked approved by anyone except a platform admin who has looked at the actual file (the app enforces this).

## 1. One visual direction for all three families
- **Style:** premium stylized 3D, animated-feature quality, clean readable shapes, soft global illumination, no photorealism, no realistic human skin. Family-friendly for all ages.
- **Shared anatomy:** the fruit/vegetable head is the largest part of the silhouette; small humanoid body; four-finger cartoon hands; limbs in the family skin colour; no hair (the crown replaces hair).
- **Heights (in head units):** child 2.6 · elder 3.2 · adult 3.4. Every sheet of a family must keep these ratios when characters stand together.
- **Materials:** LIMO glossy (single specular highlight upper left), NOVA soft satin with seed pattern, ADAM matte with subtle texture. Same light rig for every family.
- **Light rig (all sheets):** key light 45° camera-left and above, soft fill camera-right at 40 %, rim light from behind; neutral grey-lavender background `#EFECF7`; contact shadow only.
- **Camera (all views):** 50 mm equivalent, lens at chest height, character centred and fully visible with 8 % margin, no perspective exaggeration.
- **Pose:** relaxed neutral standing pose, arms slightly away from the body (≈ 15°), feet shoulder width, neutral expression unless it is an expression sheet.

## 2. Deliverables per character
| File | Required | Notes |
|---|---|---|
| `front`, `side`, `three_quarter` | **yes** | rendered reference images, everyday outfit, neutral expression |
| `back` | optional | same pose |
| expressions: `neutral`, `happy`, `laughing`, `surprised`, `sad`, `thinking`, `determined`, `worried` | optional | head and shoulders, front view, everyday outfit |
| outfits: `everyday`, `special` | optional | full body, three-quarter view |
| rigged 3D model | optional, separate kind | glTF 2.0 binary (`.glb`) preferred, `.gltf` or `.fbx` accepted; humanoid skeleton; blend shapes for the eight expressions; real-world scale with the head-unit heights above |

**Image format:** PNG (or WebP/JPEG), 3:4 portrait, at least 2048 × 2730 px, sRGB, no text, logos, watermarks or signatures in the image. Max 100 MB per file.

A rendered image and a rigged model are different things: an image is never registered as a model, and the app shows them separately.

## 3. Process to add genuine references
1. **Owner reads and approves the written specs** in Admin → Characters → Open → "Approve spec v1" (one per character). Corrections first create a new spec version.
2. **Artwork is produced** by an illustrator/3D artist, or by an image provider the owner explicitly approves (Milestone 10). Record who made it.
3. **A platform admin with two-factor uploads** each file in Admin → Characters → Open → "Upload a reference": choose the kind, view/expression/outfit and the source (own artwork, commissioned, AI-generated, render of a 3D model) and add a source note.
4. **Review** (same dialog): open the file (the app records that it was opened), confirm every checklist item, then approve, or reject with a reason. Approving a newer file for the same slot replaces the older one. A mistaken approval can be withdrawn.
5. **Ready for generation** only when the spec is approved *and* front, side and three-quarter images of that spec version are approved. Until then generation stays blocked for that character.

### Review checklist (enforced by the app)
- Matches the design spec (crown, face, colours) · Proportions match the spec · Colours match the palette · Family-friendly and on-brand · Shows the selected view · No text, logos or watermarks.
- Rigged models: the same identity items plus "Rig opened and checked in a 3D tool".

### Never
- realistic human skin or human face
- hair on the head (the crown replaces hair)
- more or fewer than four fingers per hand
- extra limbs or duplicated features
- changing the family colour, crown shape or face layout
- text, logos or watermarks
- scary, violent or adult content
- photorealistic food textures
- placeholder or generated "temporary" art presented as final

## 4. Families

### LIMO — anthropomorphic tomato
- **Head:** Round glossy tomato head, slightly wider than tall, with four soft vertical lobes; the head is the largest part of the silhouette.
- **Crown:** Five-point star-shaped green calyx on top with a short curled stem tilted to the character’s right.
- **Surface:** Smooth glossy skin with one soft specular highlight on the upper left of the head and a subtle warm subsurface glow.
- **Face:** Large oval eyes with dark brown irises and two white catchlights, thick rounded brows one shade darker than the skin, small rounded nose bump, wide expressive mouth, soft cheek blush.

| Colour | Hex | Use |
|---|---|---|
| skin | `#E8412C` | head, hands, legs |
| skin_shadow | `#B82E1F` | shadows, brows |
| skin_highlight | `#FF7A5C` | specular highlight |
| crown | `#3E9B3F` | calyx and stem |
| crown_shadow | `#2C7A31` | calyx shadow |
| iris | `#3B2A20` | eyes |

### NOVA — anthropomorphic strawberry
- **Head:** Rounded heart-shaped strawberry head, widest at the brow and tapering gently toward the chin.
- **Crown:** Ruff of five broad pointed green sepals lying flat around the top, with a small upright stem in the centre.
- **Surface:** Soft satin skin with small golden seeds in an even diamond pattern; seeds never cover the eyes, mouth or cheeks.
- **Face:** Big round eyes with dark plum irises and two white catchlights, soft arched brows, tiny nose, rounded smiling mouth, pink cheek blush.

| Colour | Hex | Use |
|---|---|---|
| skin | `#E23D57` | head, hands, legs |
| skin_shadow | `#A8293F` | shadows, brows |
| skin_highlight | `#FF8197` | highlight |
| seeds | `#F5D06A` | seed pattern |
| crown | `#4FAE4A` | sepals and stem |
| iris | `#2E2230` | eyes |

### ADAM — anthropomorphic potato
- **Head:** Oval, gently lumpy potato head, a little taller than wide, with a soft asymmetric bump on the upper left.
- **Crown:** Two-leaf green sprout growing from the top; the left leaf is larger than the right.
- **Surface:** Matte, softly textured skin with three small darker “potato eye” spots: one on the upper left forehead, two on the right cheek.
- **Face:** Small bright eyes with dark brown irises and one white catchlight each, expressive brows, round button nose, friendly wide mouth.

| Colour | Hex | Use |
|---|---|---|
| skin | `#C99A62` | head, hands, legs |
| skin_shadow | `#9A7146` | shadows, brows |
| skin_highlight | `#E3BE8A` | highlight |
| spots | `#8C6A43` | potato eye spots |
| crown | `#6CBF4B` | sprout leaves |
| iris | `#2B2118` | eyes |

## 5. Character briefs

### `limo_boy` — child male
- **Personality:** playful and curious
- **Body:** Small rounded child body, short arms and legs, four-finger cartoon hands, skin-coloured limbs.
- **Proportions:** about 2.6 heads tall; head width 1.5× shoulders; upright, energetic, slight forward lean.
- **Signature details:** curled stem tilted to the right; four soft vertical lobes on the head; small cap worn backwards on special occasions only.
- **Outfit `everyday` (Everyday):** Striped T-shirt, knee-length shorts and sneakers. Colours `#2F6FDB`, `#F4F1EA`.
- **Outfit `special` (Weekend):** Hoodie with a small leaf badge, joggers and sneakers. Colours `#1F2A44`, `#F4F1EA`.
- **Identity text used for generation:** LIMO young boy: premium stylized 3D anthropomorphic tomato character for a family-friendly animated series. Round glossy tomato head, slightly wider than tall, with four soft vertical lobes; the head is the largest part of the silhouette. Five-point star-shaped green calyx on top with a short curled stem tilted to the character’s right. Smooth glossy skin with one soft specular highlight on the upper left of the head and a subtle warm subsurface glow. Large oval eyes with dark brown irises and two white catchlights, thick rounded brows one shade darker than the skin, small rounded nose bump, wide expressive mouth, soft cheek blush. Small rounded child body, short arms and legs, four-finger cartoon hands, skin-coloured limbs. About 2.6 heads tall; upright, energetic, slight forward lean. Colours: skin #E8412C, crown #3E9B3F, iris #3B2A20. Details: curled stem tilted to the right; four soft vertical lobes on the head; small cap worn backwards on special occasions only.

### `limo_girl` — child female
- **Personality:** playful and curious
- **Body:** Small rounded child body, short arms and legs, four-finger cartoon hands, skin-coloured limbs.
- **Proportions:** about 2.6 heads tall; head width 1.5× shoulders; upright, lively, light on her feet.
- **Signature details:** curled stem tilted to the right; four soft vertical lobes on the head; small hair clip shaped like a flower attached to the crown.
- **Outfit `everyday` (Everyday):** Short-sleeved dress over leggings and sneakers. Colours `#2F6FDB`, `#F4F1EA`.
- **Outfit `special` (Play day):** Dungarees over a T-shirt with rolled cuffs and sneakers. Colours `#1F2A44`, `#F4F1EA`.
- **Identity text used for generation:** LIMO young girl: premium stylized 3D anthropomorphic tomato character for a family-friendly animated series. Round glossy tomato head, slightly wider than tall, with four soft vertical lobes; the head is the largest part of the silhouette. Five-point star-shaped green calyx on top with a short curled stem tilted to the character’s right. Smooth glossy skin with one soft specular highlight on the upper left of the head and a subtle warm subsurface glow. Large oval eyes with dark brown irises and two white catchlights, thick rounded brows one shade darker than the skin, small rounded nose bump, wide expressive mouth, soft cheek blush. Small rounded child body, short arms and legs, four-finger cartoon hands, skin-coloured limbs. About 2.6 heads tall; upright, lively, light on her feet. Colours: skin #E8412C, crown #3E9B3F, iris #3B2A20. Details: curled stem tilted to the right; four soft vertical lobes on the head; small hair clip shaped like a flower attached to the crown.

### `limo_man` — adult male
- **Personality:** expressive and confident
- **Body:** Adult body with broader shoulders, medium-length limbs, four-finger cartoon hands, skin-coloured limbs.
- **Proportions:** about 3.4 heads tall; head width 1.15× shoulders; relaxed and confident.
- **Signature details:** curled stem tilted to the right; four soft vertical lobes on the head; short neat brows.
- **Outfit `everyday` (Everyday):** Button-up shirt with rolled sleeves, chinos and casual shoes. Colours `#2F6FDB`, `#F4F1EA`.
- **Outfit `special` (Smart casual):** Light jacket over a crew-neck T-shirt, dark trousers. Colours `#1F2A44`, `#F4F1EA`.
- **Identity text used for generation:** LIMO adult man: premium stylized 3D anthropomorphic tomato character for a family-friendly animated series. Round glossy tomato head, slightly wider than tall, with four soft vertical lobes; the head is the largest part of the silhouette. Five-point star-shaped green calyx on top with a short curled stem tilted to the character’s right. Smooth glossy skin with one soft specular highlight on the upper left of the head and a subtle warm subsurface glow. Large oval eyes with dark brown irises and two white catchlights, thick rounded brows one shade darker than the skin, small rounded nose bump, wide expressive mouth, soft cheek blush. Adult body with broader shoulders, medium-length limbs, four-finger cartoon hands, skin-coloured limbs. About 3.4 heads tall; relaxed and confident. Colours: skin #E8412C, crown #3E9B3F, iris #3B2A20. Details: curled stem tilted to the right; four soft vertical lobes on the head; short neat brows.

### `limo_woman` — adult female
- **Personality:** expressive and confident
- **Body:** Adult body with slimmer shoulders, medium-length limbs, four-finger cartoon hands, skin-coloured limbs.
- **Proportions:** about 3.4 heads tall; head width 1.2× shoulders; poised and warm.
- **Signature details:** curled stem tilted to the right; four soft vertical lobes on the head; soft eyelashes; small earrings.
- **Outfit `everyday` (Everyday):** Blouse, straight trousers and flats. Colours `#2F6FDB`, `#F4F1EA`.
- **Outfit `special` (Smart casual):** Long cardigan over a knit top, midi skirt and ankle boots. Colours `#1F2A44`, `#F4F1EA`.
- **Identity text used for generation:** LIMO adult woman: premium stylized 3D anthropomorphic tomato character for a family-friendly animated series. Round glossy tomato head, slightly wider than tall, with four soft vertical lobes; the head is the largest part of the silhouette. Five-point star-shaped green calyx on top with a short curled stem tilted to the character’s right. Smooth glossy skin with one soft specular highlight on the upper left of the head and a subtle warm subsurface glow. Large oval eyes with dark brown irises and two white catchlights, thick rounded brows one shade darker than the skin, small rounded nose bump, wide expressive mouth, soft cheek blush. Adult body with slimmer shoulders, medium-length limbs, four-finger cartoon hands, skin-coloured limbs. About 3.4 heads tall; poised and warm. Colours: skin #E8412C, crown #3E9B3F, iris #3B2A20. Details: curled stem tilted to the right; four soft vertical lobes on the head; soft eyelashes; small earrings.

### `limo_elder_man` — elder male
- **Personality:** warm and wise
- **Body:** Slightly smaller adult body, gentle forward posture, four-finger cartoon hands, skin-coloured limbs.
- **Proportions:** about 3.2 heads tall; head width 1.2× shoulders; gentle forward lean, calm and dignified.
- **Signature details:** curled stem tilted to the right; four soft vertical lobes on the head; round glasses; bushy light-grey brows; gentle smile lines around the eyes.
- **Outfit `everyday` (Everyday):** Cardigan over a collared shirt, comfortable trousers and slippers. Colours `#2F6FDB`, `#F4F1EA`.
- **Outfit `special` (Celebration):** Tweed vest, bow tie and polished shoes; optional walking stick. Colours `#1F2A44`, `#F4F1EA`.
- **Identity text used for generation:** LIMO elderly man: premium stylized 3D anthropomorphic tomato character for a family-friendly animated series. Round glossy tomato head, slightly wider than tall, with four soft vertical lobes; the head is the largest part of the silhouette. Five-point star-shaped green calyx on top with a short curled stem tilted to the character’s right. Smooth glossy skin with one soft specular highlight on the upper left of the head and a subtle warm subsurface glow. Large oval eyes with dark brown irises and two white catchlights, thick rounded brows one shade darker than the skin, small rounded nose bump, wide expressive mouth, soft cheek blush. Slightly smaller adult body, gentle forward posture, four-finger cartoon hands, skin-coloured limbs. About 3.2 heads tall; gentle forward lean, calm and dignified. Colours: skin #E8412C, crown #3E9B3F, iris #3B2A20. Details: curled stem tilted to the right; four soft vertical lobes on the head; round glasses; bushy light-grey brows; gentle smile lines around the eyes.

### `limo_elder_woman` — elder female
- **Personality:** warm and wise
- **Body:** Slightly smaller adult body, gentle forward posture, four-finger cartoon hands, skin-coloured limbs.
- **Proportions:** about 3.2 heads tall; head width 1.25× shoulders; gentle forward lean, warm and wise.
- **Signature details:** curled stem tilted to the right; four soft vertical lobes on the head; glasses on a thin chain; soft eyelashes; gentle smile lines around the eyes.
- **Outfit `everyday` (Everyday):** Knitted shawl over a long-sleeved dress and comfortable shoes. Colours `#2F6FDB`, `#F4F1EA`.
- **Outfit `special` (Celebration):** Patterned headscarf, embroidered jacket and long skirt. Colours `#1F2A44`, `#F4F1EA`.
- **Identity text used for generation:** LIMO elderly woman: premium stylized 3D anthropomorphic tomato character for a family-friendly animated series. Round glossy tomato head, slightly wider than tall, with four soft vertical lobes; the head is the largest part of the silhouette. Five-point star-shaped green calyx on top with a short curled stem tilted to the character’s right. Smooth glossy skin with one soft specular highlight on the upper left of the head and a subtle warm subsurface glow. Large oval eyes with dark brown irises and two white catchlights, thick rounded brows one shade darker than the skin, small rounded nose bump, wide expressive mouth, soft cheek blush. Slightly smaller adult body, gentle forward posture, four-finger cartoon hands, skin-coloured limbs. About 3.2 heads tall; gentle forward lean, warm and wise. Colours: skin #E8412C, crown #3E9B3F, iris #3B2A20. Details: curled stem tilted to the right; four soft vertical lobes on the head; glasses on a thin chain; soft eyelashes; gentle smile lines around the eyes.

### `nova_boy` — child male
- **Personality:** playful and curious
- **Body:** Small rounded child body, short arms and legs, four-finger cartoon hands, skin-coloured limbs.
- **Proportions:** about 2.6 heads tall; head width 1.5× shoulders; upright, energetic, slight forward lean.
- **Signature details:** diamond seed pattern; flat five-sepal ruff with a centred stem; small cap worn backwards on special occasions only.
- **Outfit `everyday` (Everyday):** Striped T-shirt, knee-length shorts and sneakers. Colours `#F7F0E3`, `#7CC6A4`.
- **Outfit `special` (Weekend):** Hoodie with a small leaf badge, joggers and sneakers. Colours `#5B4B8A`, `#7CC6A4`.
- **Identity text used for generation:** NOVA young boy: premium stylized 3D anthropomorphic strawberry character for a family-friendly animated series. Rounded heart-shaped strawberry head, widest at the brow and tapering gently toward the chin. Ruff of five broad pointed green sepals lying flat around the top, with a small upright stem in the centre. Soft satin skin with small golden seeds in an even diamond pattern; seeds never cover the eyes, mouth or cheeks. Big round eyes with dark plum irises and two white catchlights, soft arched brows, tiny nose, rounded smiling mouth, pink cheek blush. Small rounded child body, short arms and legs, four-finger cartoon hands, skin-coloured limbs. About 2.6 heads tall; upright, energetic, slight forward lean. Colours: skin #E23D57, crown #4FAE4A, iris #2E2230. Details: diamond seed pattern; flat five-sepal ruff with a centred stem; small cap worn backwards on special occasions only.

### `nova_girl` — child female
- **Personality:** playful and curious
- **Body:** Small rounded child body, short arms and legs, four-finger cartoon hands, skin-coloured limbs.
- **Proportions:** about 2.6 heads tall; head width 1.5× shoulders; upright, lively, light on her feet.
- **Signature details:** diamond seed pattern; flat five-sepal ruff with a centred stem; small hair clip shaped like a flower attached to the crown.
- **Outfit `everyday` (Everyday):** Short-sleeved dress over leggings and sneakers. Colours `#F7F0E3`, `#7CC6A4`.
- **Outfit `special` (Play day):** Dungarees over a T-shirt with rolled cuffs and sneakers. Colours `#5B4B8A`, `#7CC6A4`.
- **Identity text used for generation:** NOVA young girl: premium stylized 3D anthropomorphic strawberry character for a family-friendly animated series. Rounded heart-shaped strawberry head, widest at the brow and tapering gently toward the chin. Ruff of five broad pointed green sepals lying flat around the top, with a small upright stem in the centre. Soft satin skin with small golden seeds in an even diamond pattern; seeds never cover the eyes, mouth or cheeks. Big round eyes with dark plum irises and two white catchlights, soft arched brows, tiny nose, rounded smiling mouth, pink cheek blush. Small rounded child body, short arms and legs, four-finger cartoon hands, skin-coloured limbs. About 2.6 heads tall; upright, lively, light on her feet. Colours: skin #E23D57, crown #4FAE4A, iris #2E2230. Details: diamond seed pattern; flat five-sepal ruff with a centred stem; small hair clip shaped like a flower attached to the crown.

### `nova_man` — adult male
- **Personality:** expressive and confident
- **Body:** Adult body with broader shoulders, medium-length limbs, four-finger cartoon hands, skin-coloured limbs.
- **Proportions:** about 3.4 heads tall; head width 1.15× shoulders; relaxed and confident.
- **Signature details:** diamond seed pattern; flat five-sepal ruff with a centred stem; short neat brows.
- **Outfit `everyday` (Everyday):** Button-up shirt with rolled sleeves, chinos and casual shoes. Colours `#F7F0E3`, `#7CC6A4`.
- **Outfit `special` (Smart casual):** Light jacket over a crew-neck T-shirt, dark trousers. Colours `#5B4B8A`, `#7CC6A4`.
- **Identity text used for generation:** NOVA adult man: premium stylized 3D anthropomorphic strawberry character for a family-friendly animated series. Rounded heart-shaped strawberry head, widest at the brow and tapering gently toward the chin. Ruff of five broad pointed green sepals lying flat around the top, with a small upright stem in the centre. Soft satin skin with small golden seeds in an even diamond pattern; seeds never cover the eyes, mouth or cheeks. Big round eyes with dark plum irises and two white catchlights, soft arched brows, tiny nose, rounded smiling mouth, pink cheek blush. Adult body with broader shoulders, medium-length limbs, four-finger cartoon hands, skin-coloured limbs. About 3.4 heads tall; relaxed and confident. Colours: skin #E23D57, crown #4FAE4A, iris #2E2230. Details: diamond seed pattern; flat five-sepal ruff with a centred stem; short neat brows.

### `nova_woman` — adult female
- **Personality:** expressive and confident
- **Body:** Adult body with slimmer shoulders, medium-length limbs, four-finger cartoon hands, skin-coloured limbs.
- **Proportions:** about 3.4 heads tall; head width 1.2× shoulders; poised and warm.
- **Signature details:** diamond seed pattern; flat five-sepal ruff with a centred stem; soft eyelashes; small earrings.
- **Outfit `everyday` (Everyday):** Blouse, straight trousers and flats. Colours `#F7F0E3`, `#7CC6A4`.
- **Outfit `special` (Smart casual):** Long cardigan over a knit top, midi skirt and ankle boots. Colours `#5B4B8A`, `#7CC6A4`.
- **Identity text used for generation:** NOVA adult woman: premium stylized 3D anthropomorphic strawberry character for a family-friendly animated series. Rounded heart-shaped strawberry head, widest at the brow and tapering gently toward the chin. Ruff of five broad pointed green sepals lying flat around the top, with a small upright stem in the centre. Soft satin skin with small golden seeds in an even diamond pattern; seeds never cover the eyes, mouth or cheeks. Big round eyes with dark plum irises and two white catchlights, soft arched brows, tiny nose, rounded smiling mouth, pink cheek blush. Adult body with slimmer shoulders, medium-length limbs, four-finger cartoon hands, skin-coloured limbs. About 3.4 heads tall; poised and warm. Colours: skin #E23D57, crown #4FAE4A, iris #2E2230. Details: diamond seed pattern; flat five-sepal ruff with a centred stem; soft eyelashes; small earrings.

### `nova_elder_man` — elder male
- **Personality:** warm and wise
- **Body:** Slightly smaller adult body, gentle forward posture, four-finger cartoon hands, skin-coloured limbs.
- **Proportions:** about 3.2 heads tall; head width 1.2× shoulders; gentle forward lean, calm and dignified.
- **Signature details:** diamond seed pattern; flat five-sepal ruff with a centred stem; round glasses; bushy light-grey brows; gentle smile lines around the eyes.
- **Outfit `everyday` (Everyday):** Cardigan over a collared shirt, comfortable trousers and slippers. Colours `#F7F0E3`, `#7CC6A4`.
- **Outfit `special` (Celebration):** Tweed vest, bow tie and polished shoes; optional walking stick. Colours `#5B4B8A`, `#7CC6A4`.
- **Identity text used for generation:** NOVA elderly man: premium stylized 3D anthropomorphic strawberry character for a family-friendly animated series. Rounded heart-shaped strawberry head, widest at the brow and tapering gently toward the chin. Ruff of five broad pointed green sepals lying flat around the top, with a small upright stem in the centre. Soft satin skin with small golden seeds in an even diamond pattern; seeds never cover the eyes, mouth or cheeks. Big round eyes with dark plum irises and two white catchlights, soft arched brows, tiny nose, rounded smiling mouth, pink cheek blush. Slightly smaller adult body, gentle forward posture, four-finger cartoon hands, skin-coloured limbs. About 3.2 heads tall; gentle forward lean, calm and dignified. Colours: skin #E23D57, crown #4FAE4A, iris #2E2230. Details: diamond seed pattern; flat five-sepal ruff with a centred stem; round glasses; bushy light-grey brows; gentle smile lines around the eyes.

### `nova_elder_woman` — elder female
- **Personality:** warm and wise
- **Body:** Slightly smaller adult body, gentle forward posture, four-finger cartoon hands, skin-coloured limbs.
- **Proportions:** about 3.2 heads tall; head width 1.25× shoulders; gentle forward lean, warm and wise.
- **Signature details:** diamond seed pattern; flat five-sepal ruff with a centred stem; glasses on a thin chain; soft eyelashes; gentle smile lines around the eyes.
- **Outfit `everyday` (Everyday):** Knitted shawl over a long-sleeved dress and comfortable shoes. Colours `#F7F0E3`, `#7CC6A4`.
- **Outfit `special` (Celebration):** Patterned headscarf, embroidered jacket and long skirt. Colours `#5B4B8A`, `#7CC6A4`.
- **Identity text used for generation:** NOVA elderly woman: premium stylized 3D anthropomorphic strawberry character for a family-friendly animated series. Rounded heart-shaped strawberry head, widest at the brow and tapering gently toward the chin. Ruff of five broad pointed green sepals lying flat around the top, with a small upright stem in the centre. Soft satin skin with small golden seeds in an even diamond pattern; seeds never cover the eyes, mouth or cheeks. Big round eyes with dark plum irises and two white catchlights, soft arched brows, tiny nose, rounded smiling mouth, pink cheek blush. Slightly smaller adult body, gentle forward posture, four-finger cartoon hands, skin-coloured limbs. About 3.2 heads tall; gentle forward lean, warm and wise. Colours: skin #E23D57, crown #4FAE4A, iris #2E2230. Details: diamond seed pattern; flat five-sepal ruff with a centred stem; glasses on a thin chain; soft eyelashes; gentle smile lines around the eyes.

### `adam_boy` — child male
- **Personality:** playful and curious
- **Body:** Small rounded child body, short arms and legs, four-finger cartoon hands, skin-coloured limbs.
- **Proportions:** about 2.6 heads tall; head width 1.5× shoulders; upright, energetic, slight forward lean.
- **Signature details:** three potato-eye spots in fixed positions; two-leaf sprout, left leaf larger; small cap worn backwards on special occasions only.
- **Outfit `everyday` (Everyday):** Striped T-shirt, knee-length shorts and sneakers. Colours `#3D5A80`, `#E0A526`.
- **Outfit `special` (Weekend):** Hoodie with a small leaf badge, joggers and sneakers. Colours `#F2EBDD`, `#E0A526`.
- **Identity text used for generation:** ADAM young boy: premium stylized 3D anthropomorphic potato character for a family-friendly animated series. Oval, gently lumpy potato head, a little taller than wide, with a soft asymmetric bump on the upper left. Two-leaf green sprout growing from the top; the left leaf is larger than the right. Matte, softly textured skin with three small darker “potato eye” spots: one on the upper left forehead, two on the right cheek. Small bright eyes with dark brown irises and one white catchlight each, expressive brows, round button nose, friendly wide mouth. Small rounded child body, short arms and legs, four-finger cartoon hands, skin-coloured limbs. About 2.6 heads tall; upright, energetic, slight forward lean. Colours: skin #C99A62, crown #6CBF4B, iris #2B2118. Details: three potato-eye spots in fixed positions; two-leaf sprout, left leaf larger; small cap worn backwards on special occasions only.

### `adam_girl` — child female
- **Personality:** playful and curious
- **Body:** Small rounded child body, short arms and legs, four-finger cartoon hands, skin-coloured limbs.
- **Proportions:** about 2.6 heads tall; head width 1.5× shoulders; upright, lively, light on her feet.
- **Signature details:** three potato-eye spots in fixed positions; two-leaf sprout, left leaf larger; small hair clip shaped like a flower attached to the crown.
- **Outfit `everyday` (Everyday):** Short-sleeved dress over leggings and sneakers. Colours `#3D5A80`, `#E0A526`.
- **Outfit `special` (Play day):** Dungarees over a T-shirt with rolled cuffs and sneakers. Colours `#F2EBDD`, `#E0A526`.
- **Identity text used for generation:** ADAM young girl: premium stylized 3D anthropomorphic potato character for a family-friendly animated series. Oval, gently lumpy potato head, a little taller than wide, with a soft asymmetric bump on the upper left. Two-leaf green sprout growing from the top; the left leaf is larger than the right. Matte, softly textured skin with three small darker “potato eye” spots: one on the upper left forehead, two on the right cheek. Small bright eyes with dark brown irises and one white catchlight each, expressive brows, round button nose, friendly wide mouth. Small rounded child body, short arms and legs, four-finger cartoon hands, skin-coloured limbs. About 2.6 heads tall; upright, lively, light on her feet. Colours: skin #C99A62, crown #6CBF4B, iris #2B2118. Details: three potato-eye spots in fixed positions; two-leaf sprout, left leaf larger; small hair clip shaped like a flower attached to the crown.

### `adam_man` — adult male
- **Personality:** expressive and confident
- **Body:** Adult body with broader shoulders, medium-length limbs, four-finger cartoon hands, skin-coloured limbs.
- **Proportions:** about 3.4 heads tall; head width 1.15× shoulders; relaxed and confident.
- **Signature details:** three potato-eye spots in fixed positions; two-leaf sprout, left leaf larger; short neat brows.
- **Outfit `everyday` (Everyday):** Button-up shirt with rolled sleeves, chinos and casual shoes. Colours `#3D5A80`, `#E0A526`.
- **Outfit `special` (Smart casual):** Light jacket over a crew-neck T-shirt, dark trousers. Colours `#F2EBDD`, `#E0A526`.
- **Identity text used for generation:** ADAM adult man: premium stylized 3D anthropomorphic potato character for a family-friendly animated series. Oval, gently lumpy potato head, a little taller than wide, with a soft asymmetric bump on the upper left. Two-leaf green sprout growing from the top; the left leaf is larger than the right. Matte, softly textured skin with three small darker “potato eye” spots: one on the upper left forehead, two on the right cheek. Small bright eyes with dark brown irises and one white catchlight each, expressive brows, round button nose, friendly wide mouth. Adult body with broader shoulders, medium-length limbs, four-finger cartoon hands, skin-coloured limbs. About 3.4 heads tall; relaxed and confident. Colours: skin #C99A62, crown #6CBF4B, iris #2B2118. Details: three potato-eye spots in fixed positions; two-leaf sprout, left leaf larger; short neat brows.

### `adam_woman` — adult female
- **Personality:** expressive and confident
- **Body:** Adult body with slimmer shoulders, medium-length limbs, four-finger cartoon hands, skin-coloured limbs.
- **Proportions:** about 3.4 heads tall; head width 1.2× shoulders; poised and warm.
- **Signature details:** three potato-eye spots in fixed positions; two-leaf sprout, left leaf larger; soft eyelashes; small earrings.
- **Outfit `everyday` (Everyday):** Blouse, straight trousers and flats. Colours `#3D5A80`, `#E0A526`.
- **Outfit `special` (Smart casual):** Long cardigan over a knit top, midi skirt and ankle boots. Colours `#F2EBDD`, `#E0A526`.
- **Identity text used for generation:** ADAM adult woman: premium stylized 3D anthropomorphic potato character for a family-friendly animated series. Oval, gently lumpy potato head, a little taller than wide, with a soft asymmetric bump on the upper left. Two-leaf green sprout growing from the top; the left leaf is larger than the right. Matte, softly textured skin with three small darker “potato eye” spots: one on the upper left forehead, two on the right cheek. Small bright eyes with dark brown irises and one white catchlight each, expressive brows, round button nose, friendly wide mouth. Adult body with slimmer shoulders, medium-length limbs, four-finger cartoon hands, skin-coloured limbs. About 3.4 heads tall; poised and warm. Colours: skin #C99A62, crown #6CBF4B, iris #2B2118. Details: three potato-eye spots in fixed positions; two-leaf sprout, left leaf larger; soft eyelashes; small earrings.

### `adam_elder_man` — elder male
- **Personality:** warm and wise
- **Body:** Slightly smaller adult body, gentle forward posture, four-finger cartoon hands, skin-coloured limbs.
- **Proportions:** about 3.2 heads tall; head width 1.2× shoulders; gentle forward lean, calm and dignified.
- **Signature details:** three potato-eye spots in fixed positions; two-leaf sprout, left leaf larger; round glasses; bushy light-grey brows; gentle smile lines around the eyes.
- **Outfit `everyday` (Everyday):** Cardigan over a collared shirt, comfortable trousers and slippers. Colours `#3D5A80`, `#E0A526`.
- **Outfit `special` (Celebration):** Tweed vest, bow tie and polished shoes; optional walking stick. Colours `#F2EBDD`, `#E0A526`.
- **Identity text used for generation:** ADAM elderly man: premium stylized 3D anthropomorphic potato character for a family-friendly animated series. Oval, gently lumpy potato head, a little taller than wide, with a soft asymmetric bump on the upper left. Two-leaf green sprout growing from the top; the left leaf is larger than the right. Matte, softly textured skin with three small darker “potato eye” spots: one on the upper left forehead, two on the right cheek. Small bright eyes with dark brown irises and one white catchlight each, expressive brows, round button nose, friendly wide mouth. Slightly smaller adult body, gentle forward posture, four-finger cartoon hands, skin-coloured limbs. About 3.2 heads tall; gentle forward lean, calm and dignified. Colours: skin #C99A62, crown #6CBF4B, iris #2B2118. Details: three potato-eye spots in fixed positions; two-leaf sprout, left leaf larger; round glasses; bushy light-grey brows; gentle smile lines around the eyes.

### `adam_elder_woman` — elder female
- **Personality:** warm and wise
- **Body:** Slightly smaller adult body, gentle forward posture, four-finger cartoon hands, skin-coloured limbs.
- **Proportions:** about 3.2 heads tall; head width 1.25× shoulders; gentle forward lean, warm and wise.
- **Signature details:** three potato-eye spots in fixed positions; two-leaf sprout, left leaf larger; glasses on a thin chain; soft eyelashes; gentle smile lines around the eyes.
- **Outfit `everyday` (Everyday):** Knitted shawl over a long-sleeved dress and comfortable shoes. Colours `#3D5A80`, `#E0A526`.
- **Outfit `special` (Celebration):** Patterned headscarf, embroidered jacket and long skirt. Colours `#F2EBDD`, `#E0A526`.
- **Identity text used for generation:** ADAM elderly woman: premium stylized 3D anthropomorphic potato character for a family-friendly animated series. Oval, gently lumpy potato head, a little taller than wide, with a soft asymmetric bump on the upper left. Two-leaf green sprout growing from the top; the left leaf is larger than the right. Matte, softly textured skin with three small darker “potato eye” spots: one on the upper left forehead, two on the right cheek. Small bright eyes with dark brown irises and one white catchlight each, expressive brows, round button nose, friendly wide mouth. Slightly smaller adult body, gentle forward posture, four-finger cartoon hands, skin-coloured limbs. About 3.2 heads tall; gentle forward lean, warm and wise. Colours: skin #C99A62, crown #6CBF4B, iris #2B2118. Details: three potato-eye spots in fixed positions; two-leaf sprout, left leaf larger; glasses on a thin chain; soft eyelashes; gentle smile lines around the eyes.

