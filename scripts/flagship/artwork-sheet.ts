/**
 * Character artwork sheet runner (lib/generation/artwork-package.ts). One sheet per invocation; the image is written to
 * a local folder for HUMAN review — nothing is uploaded, registered or approved automatically.
 *
 * Default is a DRY RUN: prints the exact prompt, request key, size, planning estimate (researched, UNVERIFIED price)
 * and the gates that would block — no network, no database. `--manifest <file>` writes the whole package as JSON.
 * A live call needs ALL of the gates of scripts/ai-pilot.ts:
 *   --live --confirm-cents <N ≤ 500> --org <workspace id>
 *   LIMO_GENERATION_MODE=live, LIMO_ENABLE_PAID_GENERATION=true, GEMINI_API_KEY, LIMO_AI_SPEND_SCOPE,
 *   SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY, feature flag paid_generation on, registry row google_character_image_v1
 *   enabled with an owner-verified price, the spend scope enabled with room, and N >= the verified estimate.
 * A spec version with an owner-approved design source (adam_boy v2) also needs --design-asset <id>: the private upload
 * of that composite sheet (character-library, this character and spec version); its SHA-256 must equal the one
 * recorded in the spec, otherwise nothing is sent. It is a style/identity source, never an approved view.
 * Sheets other than the front also need --front-asset <id>: the owner-APPROVED canonical front of this character
 * (checked in the database, downloaded from the private library, used as the only identity reference).
 * No paid retries (LIMO_AI_MAX_ATTEMPTS forced to 1), no fallback provider.
 *
 * Usage: node scripts/flagship/artwork-sheet.ts --character adam_boy [--version 2] --sheet view:front|view:three_quarter|view:side|expression:surprised|expression:determined [--manifest <file>] [--live …] [--out <dir>]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { killSwitchOn, paidCallBlockers, type CapabilityAdapter } from '../../lib/providers/contracts.ts';
import { executeOperation, OperationBlockedError } from '../../lib/providers/execute.ts';
import { generationMode } from '../../lib/providers/registry.ts';
import { blockedFetch } from '../../lib/providers/http.ts';
import { geminiCharacterAdapter, geminiImageAdapter, GEMINI_CHARACTER_MODEL } from '../../lib/providers/adapters/gemini-image.ts';
import { sheetFromRegistry, type RegistryRow } from '../../lib/providers/registry-prices.ts';
import { dbSpendGuard } from '../../lib/providers/spend-db.ts';
import { RESEARCHED_PRICES } from '../../lib/providers/prices.ts';
import { operationCost } from '../../lib/providers/contracts.ts';
import { ADAM_BOY_SHEETS, APPROVED_FRONT, DESIGN_SOURCE, artworkPackage } from '../../lib/generation/artwork-package.ts';
import { sha256 } from '../../lib/providers/provenance.ts';

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const PACKAGES: Record<string, typeof ADAM_BOY_SHEETS> = { adam_boy: ADAM_BOY_SHEETS };
const character = arg('character') ?? '';
if (!PACKAGES[character]) {
  console.error(`--character must be one of ${Object.keys(PACKAGES).join(', ')} (packages prepared so far)`);
  process.exit(2);
}
const live = process.argv.includes('--live');
const env: Record<string, string | undefined> = { ...process.env, LIMO_AI_MAX_ATTEMPTS: '1' };
const out = arg('out') ?? join(tmpdir(), 'limo-artwork');
const version = Number(arg('version') ?? 1);
const pkg = (() => {
  try {
    return artworkPackage(character, PACKAGES[character]!, arg('org') ?? '00000000-0000-0000-0000-000000000000', version);
  } catch {
    console.error(`no design spec v${arg('version')} for ${character}`);
    process.exit(2);
  }
})();

function adapterFor(characterSheet: boolean, fetch: Parameters<typeof geminiImageAdapter>[0]['fetch'], apiKey: string, loadAsset: (id: string) => Promise<{ bytes: Uint8Array; mime: string }>): CapabilityAdapter {
  const cfg = { apiKey, fetch, model: GEMINI_CHARACTER_MODEL, loadAsset };
  return (characterSheet ? geminiCharacterAdapter(cfg) : geminiImageAdapter(cfg)) as CapabilityAdapter;
}

async function main() {
  if (arg('manifest')) {
    writeFileSync(arg('manifest')!, `${JSON.stringify({ ...pkg, sheets: pkg.sheets.map((s) => ({ ...s, request: { ...s.request, organizationId: '<workspace id>' } })) }, null, 2)}\n`);
    console.log('manifest written', arg('manifest'), `${pkg.sheets.length} sheets`);
    return;
  }
  const sheet = pkg.sheets.find((s) => s.slot === arg('sheet'));
  if (!sheet) {
    console.error(`--sheet must be one of ${pkg.sheets.map((s) => s.slot).join(', ')}`);
    process.exit(2);
  }
  const noAssets = async () => {
    throw new Error('dry run: no files are read');
  };

  if (!live) {
    const a = adapterFor(sheet.needsApprovedFront, blockedFetch(), 'dry-run', noAssets);
    const usage = a.estimateUsage(sheet.request as never);
    const researched = RESEARCHED_PRICES[pkg.priceKey];
    const cost = researched ? operationCost({ ...researched, verifiedAt: new Date().toISOString(), verifiedBy: 'planning-estimate' }, usage) : null;
    // Exact HTTP request the adapter would send, captured by a fetch that never touches the network (no key read).
    let httpRequest: { method?: string; url: string; headers: Record<string, string>; body: unknown } | null = null;
    const capture = adapterFor(sheet.needsApprovedFront, async (url, init) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { input?: Array<Record<string, unknown>> };
      const labels = (sheet.needsApprovedFront ? ['<base64 of the owner-approved front image>'] : []).concat(pkg.designSource ? [`<base64 of the owner-approved design sheet, sha256 ${pkg.designSource.sha256}>`] : []);
      let k = 0;
      body.input = body.input?.map((p) => (p.type === 'image' ? { ...p, data: labels[k++] ?? '<image>' } : p));
      httpRequest = { method: init?.method, url, headers: { 'content-type': 'application/json', 'x-goog-api-key': '<GEMINI_API_KEY — not read in a dry run>' }, body };
      throw new Error('dry run: request captured, nothing sent');
    }, 'dry-run', async () => ({ bytes: new Uint8Array([0]), mime: 'image/png' }));
    await capture.run(sheet.request as never, new AbortController().signal).catch(() => undefined);
    console.log(JSON.stringify({
      package: pkg.id, sheet: sheet.slot, mode: 'dry-run (nothing sent, no key read)', model: pkg.model, registry: pkg.registryCode, size: sheet.request.size, requestKey: sheet.request.requestKey,
      specVersion: pkg.specVersion, designSource: pkg.designSource, needsApprovedFront: sheet.needsApprovedFront, usage,
      planningEstimateUsd: cost ? cost.micros / 1e6 : null, planningEstimateLines: cost?.lines.map((l) => ({ unit: l.unit, quantity: l.quantity, usd: l.micros / 1e6 })) ?? null,
      estimateNotes: ['thinking output is an allowance (always on for Gemini 3 image models, billed as text output; real count unknown until the first call)', 'billing of interim thinking images is not documented (unverified)'],
      priceSource: researched?.source ?? null, priceVerified: false, killSwitch: killSwitchOn(env),
      wouldBlock: paidCallBlockers({ env, capability: a.capability as never, capabilityApproved: false, providerEnabledInRegistry: false, priceVerified: false, estimateCents: null, remainingBudgetCents: 0, confirmAboveCents: 0, userConfirmedCents: null, missingReferences: [...(sheet.needsApprovedFront ? ['approved front'] : []), ...(pkg.designSource ? ['design sheet upload (--design-asset)'] : [])], sourceApproved: true }),
      upload: sheet.upload, identityChecklist: pkg.identityChecklist, reviewChecklist: pkg.reviewChecklist, prompt: sheet.request.prompt, httpRequest,
    }, null, 2));
    return;
  }

  // ---- live: every gate is checked; anything missing refuses before a request leaves the process ----
  const missing: string[] = [];
  if (generationMode(env) !== 'live') missing.push('LIMO_GENERATION_MODE=live and LIMO_ENABLE_PAID_GENERATION=true');
  if (!env.LIMO_AI_SPEND_SCOPE) missing.push('LIMO_AI_SPEND_SCOPE');
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) missing.push('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  if (!env.GEMINI_API_KEY) missing.push('GEMINI_API_KEY');
  const confirm = Number(arg('confirm-cents'));
  if (!Number.isInteger(confirm) || confirm <= 0 || confirm > 500) missing.push('--confirm-cents <estimate in cents, at most 500 = the $5 cap>');
  if (!arg('org')) missing.push('--org <workspace id>');
  if (sheet.needsApprovedFront && !/^[0-9a-f-]{36}$/.test(arg('front-asset') ?? '')) missing.push('--front-asset <id of the owner-approved front>');
  if (pkg.designSource && !/^[0-9a-f-]{36}$/.test(arg('design-asset') ?? '')) missing.push('--design-asset <id of the private design-sheet upload>');
  if (missing.length) {
    console.error(`refused (nothing sent): missing ${missing.join(', ')}`);
    process.exit(2);
  }
  const db = createClient(env.SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const table = (t: string) => (db as unknown as { from: (t: string) => any }).from(t);
  const rpc = async (fn: string, a: Record<string, unknown>) => (await (db.rpc as unknown as (f: string, x: object) => Promise<{ data: unknown; error: { message: string } | null }>)(fn, a));
  let front: { bytes: Uint8Array; mime: string } | null = null;
  if (sheet.needsApprovedFront) {
    const { data: ref } = await table('character_reference_assets').select('object_path, mime_type, status, view, catalog_character_id, expression_key, outfit_key, variant_id, spec_version')
      .eq('id', arg('front-asset')).maybeSingle();
    if (!ref || ref.status !== 'approved' || ref.view !== 'front' || ref.catalog_character_id !== character || ref.expression_key || ref.outfit_key || ref.variant_id || ref.spec_version !== pkg.specVersion) {
      console.error('refused (nothing sent): --front-asset is not the approved canonical front of this character and spec version');
      process.exit(2);
    }
    const file = await db.storage.from('character-library').download(ref.object_path);
    if (file.error || !file.data) throw new Error('could not read the approved front');
    front = { bytes: new Uint8Array(await file.data.arrayBuffer()), mime: ref.mime_type };
  }
  let design: { bytes: Uint8Array; mime: string } | null = null;
  if (pkg.designSource) {
    const { data: src } = await table('character_reference_assets').select('object_path, mime_type, status, catalog_character_id, spec_version')
      .eq('id', arg('design-asset')).maybeSingle();
    if (!src || src.status === 'rejected' || src.catalog_character_id !== character || src.spec_version !== pkg.specVersion) {
      console.error('refused (nothing sent): --design-asset is not the design-sheet upload of this character and spec version');
      process.exit(2);
    }
    const file = await db.storage.from('character-library').download(src.object_path);
    if (file.error || !file.data) throw new Error('could not read the design sheet');
    const bytes = new Uint8Array(await file.data.arrayBuffer());
    if (sha256(bytes) !== pkg.designSource.sha256) {
      console.error('refused (nothing sent): the uploaded design sheet is not the owner-approved file (SHA-256 differs)');
      process.exit(2);
    }
    design = { bytes, mime: src.mime_type };
  }
  const { data: row } = await table('ai_provider_registry').select('*').eq('code', pkg.registryCode).maybeSingle();
  const { data: flag } = await table('feature_flags').select('enabled').eq('key', 'paid_generation').maybeSingle();
  const price = row ? sheetFromRegistry(row as RegistryRow, pkg.priceKey.split('@')[1]) : null;
  const a = adapterFor(sheet.needsApprovedFront, globalThis.fetch.bind(globalThis), env.GEMINI_API_KEY!, async (id) => {
    if (id === APPROVED_FRONT && front) return front;
    if (id === DESIGN_SOURCE && design) return design;
    throw new Error('only the approved front and the verified design sheet can be attached');
  });
  const log = (...m: unknown[]) => console.log(new Date().toISOString(), ...m);
  try {
    const ex = await executeOperation(a, sheet.request, {
      price, spend: dbSpendGuard(env.LIMO_AI_SPEND_SCOPE!, rpc, log),
      gate: { env, capabilityApproved: flag?.enabled === true, providerEnabledInRegistry: !!(row as RegistryRow | null)?.enabled, remainingBudgetCents: 500, confirmAboveCents: 0, userConfirmedCents: confirm, missingReferences: [], sourceApproved: true },
    });
    mkdirSync(out, { recursive: true });
    const base = join(out, `${character}-${sheet.slot.replace(':', '-')}-${sheet.request.requestKey.slice(-16)}`);
    writeFileSync(`${base}.json`, JSON.stringify({ package: pkg.id, sheet: sheet.slot, upload: sheet.upload, usage: ex.result.usage, providerUsage: ex.result.json?.providerUsage ?? null, actualUsd: ex.actualMicros / 1e6, reservedCents: ex.reservedCents, provenance: ex.result.provenance, identityChecklist: pkg.identityChecklist, reviewChecklist: pkg.reviewChecklist }, null, 2));
    ex.result.files?.forEach((f, i) => writeFileSync(`${base}-${i}.${f.mime === 'image/png' ? 'png' : f.mime.split('/')[1]}`, f.bytes));
    log('done', sheet.slot, `actual $${(ex.actualMicros / 1e6).toFixed(4)}`, `→ ${base}.*  (owner review required; upload it in Admin → Characters only if it passes the checklist)`);
  } catch (e) {
    if (e instanceof OperationBlockedError) {
      console.error(`refused (nothing sent): ${e.reasons.join(', ')}`);
      process.exit(2);
    }
    console.error('provider call failed (no automatic retry, no fallback):', e instanceof Error ? e.message : e);
    process.exit(1);
  }
}

void main();
