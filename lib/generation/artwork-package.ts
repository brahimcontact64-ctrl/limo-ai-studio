/**
 * Character artwork production packages (docs/flagship/SUPERNATURAL_EYE_ARTWORK_PROMPTS.md): the exact sheets, prompts,
 * request keys, sizes, upload metadata and identity checklist for one canonical character, built ONLY from the
 * canonical spec (canon.ts, `sheetPrompt`). Pure; scripts/flagship/artwork-sheet.ts does the I/O and the live call
 * behind every gate. A package never generates, uploads or approves anything by itself.
 *
 * Order: the front view first; every other sheet is identity-locked to the APPROVED front (character_image request),
 * so it can only run after the owner approves the front. Version 1: the front is text-only and the approved front is
 * the only reference. A version with an owner-approved design source (adam_boy v2): that composite sheet is sent as
 * a style/identity SOURCE image with every request (after the approved front for the other sheets) — never as an
 * approved view; the runner checks its SHA-256 before sending it.
 */
import type { CharacterImageRequest, ImageRequest } from '../providers/contracts.ts';
import { GEMINI_CHARACTER_MODEL, imageSizeFor } from '../providers/adapters/gemini-image.ts';
import { RESEARCHED_PRICES, priceKey } from '../providers/prices.ts';
import { sha256 } from '../providers/provenance.ts';
import { CANON_SPEC_VERSION } from '../characters/canon.ts';
import { specFor, specRevision } from '../characters/spec-versions.ts';
import { SHEET_SIZE, identityChecks, sheetPrompt, slotOf, type SheetKind } from '../characters/artwork.ts';

/** Asset id standing for the approved front file in identity-locked sheets (resolved by the runner). */
export const APPROVED_FRONT = 'approved-front';
/** Asset id standing for the owner-approved design source of the spec version (resolved and hash-checked by the runner). */
export const DESIGN_SOURCE = 'design-source';
export const ARTWORK_REGISTRY_CODE = 'google_character_image_v1';
/** Review checklist of every rendered reference (review_character_reference requires all six). */
export const REVIEW_CHECKLIST = ['identity_matches_spec', 'proportions_match', 'palette_matches', 'family_friendly', 'view_correct', 'no_text_or_watermark'] as const;

export interface PackageSheet {
  slot: string;
  sheet: SheetKind;
  /** Needs the owner-approved front as its identity reference. */
  needsApprovedFront: boolean;
  /** Metadata for the reference upload after the owner keeps the image (register_character_reference). */
  upload: { asset_kind: 'rendered_reference'; view: string | null; expression_key: string | null; outfit_key: null; provenance: 'ai_generated' };
  request: ImageRequest | CharacterImageRequest;
}

export interface ArtworkPackage {
  id: string;
  character: string;
  specVersion: number;
  /** Owner-approved design source sent with every request (metadata; the file stays private). */
  designSource: { sha256: string; provenance: string; limits: string } | null;
  model: string;
  registryCode: string;
  priceKey: string;
  /** Researched list price per image (unverified): planning only, never authorises a call. */
  researchedUsdPerImage: number | null;
  identityChecklist: string[];
  reviewChecklist: readonly string[];
  sheets: PackageSheet[];
}

/** adam_boy for Flagship #1 (shots 1–3): the three required views + the two expressions the storyboard uses. */
export const ADAM_BOY_SHEETS: SheetKind[] = [
  { type: 'view', view: 'front' },
  { type: 'view', view: 'three_quarter' },
  { type: 'view', view: 'side' },
  { type: 'expression', expression: 'surprised' },
  { type: 'expression', expression: 'determined' },
];

export function artworkPackage(character: string, sheets: SheetKind[], organizationId: string, version: number = CANON_SPEC_VERSION): ArtworkPackage {
  const spec = specFor(character, version);
  if (!spec) throw new Error(`unknown spec ${character} v${version}`);
  const source = specRevision(character, version)?.designSource ?? null;
  const size = { ...SHEET_SIZE };
  const key = priceKey('google', GEMINI_CHARACTER_MODEL, imageSizeFor(size.width, size.height));
  const out: PackageSheet[] = sheets.map((sheet) => {
    const slot = slotOf(sheet);
    const isFront = sheet.type === 'view' && sheet.view === 'front';
    const sourceNote = source
      ? `${isFront ? 'The attached image' : 'The second attached image'} is the owner-approved DESIGN SHEET of this character (a composite with several small views, detail crops, expression heads and text labels): match its character design, outfit, accessories, colours and 3D style exactly, but output ONE clean single ${slot.replace(/^(view|expression):/, '').replace('_', '-')} sheet with no text, labels or panels.`
      : '';
    const frontNote = version === CANON_SPEC_VERSION
      ? 'The attached image is the APPROVED canonical front view of this exact character: keep the identity identical (head shape, sprout, potato-eye spots, colours, face layout, proportions, outfit).'
      : 'The first attached image is the APPROVED canonical front view of this exact character: keep the identity identical (head shape, face layout, skin colour and speckles, eyes, cheeks, proportions, outfit and backpack).';
    const prompt = [sheetPrompt(spec, sheet), isFront ? '' : frontNote, sourceNote].filter(Boolean).join('\n');
    const requestKey = `artwork-${character}-v${version}-${slot.replace(':', '-')}-${sha256(JSON.stringify(source ? [GEMINI_CHARACTER_MODEL, prompt, size, source.sha256] : [GEMINI_CHARACTER_MODEL, prompt, size])).slice(0, 16)}`;
    const base = { organizationId, requestKey, locale: 'en' as const, prompt, size, count: 1 };
    const request: ImageRequest | CharacterImageRequest = isFront
      ? { ...base, kind: 'image', task: 'generate', inputAssetIds: source ? [DESIGN_SOURCE] : [] }
      : { ...base, kind: 'character_image', references: [{ character, specVersion: version, assetIds: source ? [APPROVED_FRONT, DESIGN_SOURCE] : [APPROVED_FRONT] }] };
    return {
      slot, sheet, needsApprovedFront: !isFront, request,
      upload: { asset_kind: 'rendered_reference', view: sheet.type === 'view' ? sheet.view : null, expression_key: sheet.type === 'expression' ? sheet.expression : null, outfit_key: null, provenance: 'ai_generated' },
    };
  });
  const sheetPrice = RESEARCHED_PRICES[key];
  return {
    id: `${character}.artwork.v${version}`, character, specVersion: version, designSource: source ? { sha256: source.sha256, provenance: source.provenance, limits: source.limits } : null, model: GEMINI_CHARACTER_MODEL, registryCode: ARTWORK_REGISTRY_CODE, priceKey: key,
    researchedUsdPerImage: sheetPrice?.prices.image != null ? sheetPrice.prices.image / 1_000_000 : null,
    identityChecklist: identityChecks(spec), reviewChecklist: REVIEW_CHECKLIST, sheets: out,
  };
}
