/**
 * The $10 internal AI pilot (docs/AI_PILOT_PLAN.md): requests for the steps that have no product code path yet
 * (script draft, rewrite, Arabic translation, one canonical character front view). Steps 3–5 of the pilot (scene
 * images, one clip, narration) run through the normal Video-step generation and the generator worker; step 6 is
 * the customer's own MP4 export (render worker, one video credit).
 *
 * Pure: builds requests and estimates; scripts/ai-pilot.ts does the I/O and the live call behind every gate.
 */
import { operationCost, type CapabilityRequest, type ImageRequest, type PriceSheet, type TextRequest, type TranslationRequest, type Usage } from '../providers/contracts.ts';
import { CLAUDE_DEFAULT_MODEL } from '../providers/adapters/anthropic.ts';
import { GEMINI_CHARACTER_MODEL } from '../providers/adapters/gemini-image.ts';
import { RESEARCHED_PRICES, priceKey } from '../providers/prices.ts';
import { sha256 } from '../providers/provenance.ts';
import { canonFor } from '../characters/canon.ts';
import { SHEET_SIZE, sheetPrompt } from '../characters/artwork.ts';
import { imageSizeFor } from '../providers/adapters/gemini-image.ts';

export const PILOT_STEPS = ['script', 'rewrite', 'translate', 'character-front'] as const;
export type PilotStep = (typeof PILOT_STEPS)[number];
export const PILOT_CHARACTER = 'limo_man';

/** The owner's real facts for the pilot ad (never invented: missing facts stay [placeholders]). */
export interface PilotBrief {
  business: string;
  city?: string;
  offer?: string;
  hours?: string;
  tone?: string;
  /** French script text to rewrite/translate (output of the previous step, after human review). */
  approvedText?: string;
}

/** Placeholder brief for dry runs only (a live run needs the owner's brief file). */
export const SAMPLE_BRIEF: PilotBrief = { business: '[nom du restaurant]', city: '[ville]', offer: '[offre]', hours: '[horaires]', tone: 'chaleureux, familial', approvedText: '[texte du script validé]' };

const facts = (b: PilotBrief): Record<string, string> => Object.fromEntries(Object.entries({ business: b.business, city: b.city, offer: b.offer, hours: b.hours, tone: b.tone }).filter(([, v]) => v)) as Record<string, string>;

export interface PilotRequest {
  step: PilotStep;
  provider: 'anthropic' | 'google';
  model: string;
  /** Registry row whose (owner-verified) price and enabled flag gate the call. */
  registryCode: string;
  priceKey: string;
  request: CapabilityRequest;
}

export function pilotRequest(step: PilotStep, brief: PilotBrief, organizationId: string, textModel = CLAUDE_DEFAULT_MODEL): PilotRequest {
  const base = { organizationId, locale: 'fr' as const };
  const key = (parts: unknown[]) => `pilot-${step}-${sha256(JSON.stringify(parts)).slice(0, 24)}`;
  if (step === 'script') {
    const r: TextRequest = {
      ...base, kind: 'text', task: 'script_draft', requestKey: key([textModel, brief]), facts: facts(brief), maxOutputTokens: 2000,
      instructions: 'Écris le script d’une publicité vidéo de 30 secondes maximum pour ce restaurant : 4 ou 5 scènes, narration courte et naturelle en français, visuels appétissants sans texte dans l’image. Utilise uniquement les faits fournis ; les faits manquants restent entre crochets.',
    };
    return { step, provider: 'anthropic', model: textModel, registryCode: 'anthropic_script_v1', priceKey: priceKey('anthropic', textModel), request: r };
  }
  if (step === 'rewrite') {
    const r: TextRequest = { ...base, kind: 'text', task: 'rewrite', requestKey: key([textModel, brief.approvedText]), facts: facts(brief), maxOutputTokens: 800, instructions: `Réécris ce texte de narration pour qu’il soit plus chaleureux et plus court (30 secondes maximum à voix haute), sans ajouter de faits :\n${brief.approvedText ?? ''}` };
    return { step, provider: 'anthropic', model: textModel, registryCode: 'anthropic_script_v1', priceKey: priceKey('anthropic', textModel), request: r };
  }
  if (step === 'translate') {
    const r: TranslationRequest = { ...base, locale: 'ar', kind: 'translation', source: 'fr', requestKey: key([textModel, brief.approvedText]), text: brief.approvedText ?? '', lockedTerms: brief.business && !brief.business.startsWith('[') ? [brief.business] : [] };
    return { step, provider: 'anthropic', model: textModel, registryCode: 'anthropic_script_v1', priceKey: priceKey('anthropic', textModel), request: r };
  }
  // The canonical front view is text-only (no reference exists yet), so it is a plain image request on the Pro model.
  const spec = canonFor(PILOT_CHARACTER)!;
  const prompt = sheetPrompt(spec, { type: 'view', view: 'front' });
  const r: ImageRequest = { ...base, locale: 'en', kind: 'image', task: 'generate', requestKey: key([GEMINI_CHARACTER_MODEL, prompt, SHEET_SIZE]), prompt, inputAssetIds: [], size: { ...SHEET_SIZE }, count: 1 };
  return { step, provider: 'google', model: GEMINI_CHARACTER_MODEL, registryCode: 'google_character_image_v1', priceKey: priceKey('google', GEMINI_CHARACTER_MODEL, imageSizeFor(SHEET_SIZE.width, SHEET_SIZE.height)), request: r };
}

/** Planning estimate from the RESEARCHED (unverified) price: informational only, never used to authorise a call. */
export function researchedEstimate(p: PilotRequest, usage: Usage): { usd: number; sheet: PriceSheet } | null {
  const sheet = RESEARCHED_PRICES[p.priceKey];
  if (!sheet) return null;
  const verifiedForPlanning = { ...sheet, verifiedAt: new Date().toISOString(), verifiedBy: 'planning-estimate' };
  return { usd: operationCost(verifiedForPlanning, usage).micros / 1_000_000, sheet };
}
