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
 * Sheets other than the front also need --front-asset <id>: the owner-APPROVED canonical front of this character
 * (checked in the database, downloaded from the private library, used as the only identity reference).
 * No paid retries (LIMO_AI_MAX_ATTEMPTS forced to 1), no fallback provider.
 *
 * Usage: node scripts/flagship/artwork-sheet.ts --character adam_boy --sheet view:front|view:three_quarter|view:side|expression:surprised|expression:determined [--manifest <file>] [--live …] [--out <dir>]
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
import { ADAM_BOY_SHEETS, APPROVED_FRONT, artworkPackage } from '../../lib/generation/artwork-package.ts';

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
const pkg = artworkPackage(character, PACKAGES[character]!, arg('org') ?? '00000000-0000-0000-0000-000000000000');

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
    const est = researched ? operationCost({ ...researched, verifiedAt: new Date().toISOString(), verifiedBy: 'planning-estimate' }, usage).micros / 1e6 : null;
    console.log(JSON.stringify({
      package: pkg.id, sheet: sheet.slot, mode: 'dry-run', model: pkg.model, registry: pkg.registryCode, size: sheet.request.size, requestKey: sheet.request.requestKey,
      needsApprovedFront: sheet.needsApprovedFront, usage, planningEstimateUsd: est, priceSource: researched?.source ?? null, priceVerified: false, killSwitch: killSwitchOn(env),
      wouldBlock: paidCallBlockers({ env, capability: a.capability as never, capabilityApproved: false, providerEnabledInRegistry: false, priceVerified: false, estimateCents: null, remainingBudgetCents: 0, confirmAboveCents: 0, userConfirmedCents: null, missingReferences: sheet.needsApprovedFront ? ['approved front'] : [], sourceApproved: true }),
      upload: sheet.upload, prompt: sheet.request.prompt,
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
  const { data: row } = await table('ai_provider_registry').select('*').eq('code', pkg.registryCode).maybeSingle();
  const { data: flag } = await table('feature_flags').select('enabled').eq('key', 'paid_generation').maybeSingle();
  const price = row ? sheetFromRegistry(row as RegistryRow, pkg.priceKey.split('@')[1]) : null;
  const a = adapterFor(sheet.needsApprovedFront, globalThis.fetch.bind(globalThis), env.GEMINI_API_KEY!, async (id) => {
    if (id !== APPROVED_FRONT || !front) throw new Error('only the approved front can be attached');
    return front;
  });
  const log = (...m: unknown[]) => console.log(new Date().toISOString(), ...m);
  try {
    const ex = await executeOperation(a, sheet.request, {
      price, spend: dbSpendGuard(env.LIMO_AI_SPEND_SCOPE!, rpc, log),
      gate: { env, capabilityApproved: flag?.enabled === true, providerEnabledInRegistry: !!(row as RegistryRow | null)?.enabled, remainingBudgetCents: 500, confirmAboveCents: 0, userConfirmedCents: confirm, missingReferences: [], sourceApproved: true },
    });
    mkdirSync(out, { recursive: true });
    const base = join(out, `${character}-${sheet.slot.replace(':', '-')}-${sheet.request.requestKey.slice(-16)}`);
    writeFileSync(`${base}.json`, JSON.stringify({ package: pkg.id, sheet: sheet.slot, upload: sheet.upload, usage: ex.result.usage, actualUsd: ex.actualMicros / 1e6, reservedCents: ex.reservedCents, provenance: ex.result.provenance, identityChecklist: pkg.identityChecklist, reviewChecklist: pkg.reviewChecklist }, null, 2));
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
