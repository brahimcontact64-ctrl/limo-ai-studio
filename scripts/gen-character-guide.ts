/**
 * Generates docs/CHARACTER_REFERENCE_GUIDE.md from lib/characters/canon.ts, so the production guide can
 * never drift from the canonical specs. Usage: node scripts/gen-character-guide.ts > docs/CHARACTER_REFERENCE_GUIDE.md
 */
import { CANON, CANON_SPEC_VERSION, EXPRESSION_KEYS, NEGATIVE_PROMPT, REQUIRED_VIEWS } from '../lib/characters/canon.ts';
import { CHARACTER_FAMILIES } from '../lib/studio/limits.ts';

const out: string[] = [];
const p = (s = '') => out.push(s);

p('# LIMO character reference production guide');
p();
p(`Status: **for owner review**. Generated from \`lib/characters/canon.ts\` (design spec v${CANON_SPEC_VERSION}, status *proposed*). Regenerate with \`node scripts/gen-character-guide.ts\` after any canon change.`);
p();
p('No artwork exists yet. Nothing in this guide is approved, and no image may be marked approved by anyone except a platform admin who has looked at the actual file (the app enforces this).');
p();
p('## 1. One visual direction for all three families');
p('- **Style:** premium stylized 3D, animated-feature quality, clean readable shapes, soft global illumination, no photorealism, no realistic human skin. Family-friendly for all ages.');
p('- **Shared anatomy:** the fruit/vegetable head is the largest part of the silhouette; small humanoid body; four-finger cartoon hands; limbs in the family skin colour; no hair (the crown replaces hair).');
p('- **Heights (in head units):** child 2.6 · elder 3.2 · adult 3.4. Every sheet of a family must keep these ratios when characters stand together.');
p('- **Materials:** LIMO glossy (single specular highlight upper left), NOVA soft satin with seed pattern, ADAM matte with subtle texture. Same light rig for every family.');
p('- **Light rig (all sheets):** key light 45° camera-left and above, soft fill camera-right at 40 %, rim light from behind; neutral grey-lavender background `#EFECF7`; contact shadow only.');
p('- **Camera (all views):** 50 mm equivalent, lens at chest height, character centred and fully visible with 8 % margin, no perspective exaggeration.');
p('- **Pose:** relaxed neutral standing pose, arms slightly away from the body (≈ 15°), feet shoulder width, neutral expression unless it is an expression sheet.');
p();
p('## 2. Deliverables per character');
p(`| File | Required | Notes |`);
p('|---|---|---|');
p(`| ${REQUIRED_VIEWS.map((v) => `\`${v}\``).join(', ')} | **yes** | rendered reference images, everyday outfit, neutral expression |`);
p('| `back` | optional | same pose |');
p(`| expressions: ${EXPRESSION_KEYS.map((e) => `\`${e}\``).join(', ')} | optional | head and shoulders, front view, everyday outfit |`);
p('| outfits: `everyday`, `special` | optional | full body, three-quarter view |');
p('| rigged 3D model | optional, separate kind | glTF 2.0 binary (`.glb`) preferred, `.gltf` or `.fbx` accepted; humanoid skeleton; blend shapes for the eight expressions; real-world scale with the head-unit heights above |');
p();
p('**Image format:** PNG (or WebP/JPEG), 3:4 portrait, at least 2048 × 2730 px, sRGB, no text, logos, watermarks or signatures in the image. Max 100 MB per file.');
p();
p('A rendered image and a rigged model are different things: an image is never registered as a model, and the app shows them separately.');
p();
p('## 3. Process to add genuine references');
p('1. **Owner reads and approves the written specs** in Admin → Characters → Open → "Approve spec v1" (one per character). Corrections first create a new spec version.');
p('2. **Artwork is produced** by an illustrator/3D artist, or by an image provider the owner explicitly approves (Milestone 10). Record who made it.');
p('3. **A platform admin with two-factor uploads** each file in Admin → Characters → Open → "Upload a reference": choose the kind, view/expression/outfit and the source (own artwork, commissioned, AI-generated, render of a 3D model) and add a source note.');
p('4. **Review** (same dialog): open the file (the app records that it was opened), confirm every checklist item, then approve, or reject with a reason. Approving a newer file for the same slot replaces the older one. A mistaken approval can be withdrawn.');
p('5. **Ready for generation** only when the spec is approved *and* front, side and three-quarter images of that spec version are approved. Until then generation stays blocked for that character.');
p();
p('### Review checklist (enforced by the app)');
p('- Matches the design spec (crown, face, colours) · Proportions match the spec · Colours match the palette · Family-friendly and on-brand · Shows the selected view · No text, logos or watermarks.');
p('- Rigged models: the same identity items plus "Rig opened and checked in a 3D tool".');
p();
p('### Never');
for (const n of NEGATIVE_PROMPT) p(`- ${n}`);
p('- placeholder or generated "temporary" art presented as final');
p();
p('## 4. Families');
for (const f of CHARACTER_FAMILIES) {
  const first = CANON.find((c) => c.family === f)!;
  p();
  p(`### ${f.toUpperCase()} — ${first.species}`);
  p(`- **Head:** ${first.head}`);
  p(`- **Crown:** ${first.crown}`);
  p(`- **Surface:** ${first.surface}`);
  p(`- **Face:** ${first.face}`);
  p();
  p('| Colour | Hex | Use |');
  p('|---|---|---|');
  for (const c of first.palette) p(`| ${c.key} | \`${c.hex}\` | ${c.use} |`);
}
p();
p('## 5. Character briefs');
for (const c of CANON) {
  p();
  p(`### \`${c.character_id}\` — ${c.age_group} ${c.gender}`);
  p(`- **Personality:** ${c.personality}`);
  p(`- **Body:** ${c.body}`);
  p(`- **Proportions:** about ${c.proportions.height_in_heads} heads tall; head width ${c.proportions.head_width_to_shoulders}× shoulders; ${c.proportions.posture}.`);
  p(`- **Signature details:** ${c.signature_details.join('; ')}.`);
  for (const o of c.outfits) p(`- **Outfit \`${o.key}\` (${o.name}):** ${o.description} Colours ${o.colors.map((x) => `\`${x}\``).join(', ')}.`);
  p(`- **Identity text used for generation:** ${c.consistency.identity_prompt}`);
}
p();
console.log(out.join('\n'));
