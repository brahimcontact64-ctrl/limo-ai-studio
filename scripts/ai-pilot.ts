/**
 * $10 AI pilot runner (docs/AI_PILOT_PLAN.md) for the steps without a product code path: script draft, rewrite,
 * Arabic translation and the canonical LIMO front view. One step per invocation; results are written to a local
 * folder for HUMAN review (nothing is applied, uploaded or approved automatically).
 *
 * Default is a DRY RUN: builds the request, prints the planning estimate (researched, unverified price) and which
 * gates would block — no network, no database. A live call needs ALL of:
 *   --live --confirm-cents <N> --brief <file.json> --org <pilot workspace id>
 *   LIMO_GENERATION_MODE=live, LIMO_ENABLE_PAID_GENERATION=true, the provider key, LIMO_AI_SPEND_SCOPE,
 *   SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY, feature flag paid_generation on, the registry row enabled with an
 *   owner-verified price, the spend scope enabled with room, and N >= the verified estimate.
 * No paid retries (LIMO_AI_MAX_ATTEMPTS is forced to 1), no fallback provider.
 *
 * Usage: node scripts/ai-pilot.ts --step script|rewrite|translate|character-front [--live …] [--out <dir>]
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { killSwitchOn, paidCallBlockers, type CapabilityAdapter } from '../lib/providers/contracts.ts';
import { executeOperation, OperationBlockedError } from '../lib/providers/execute.ts';
import { generationMode } from '../lib/providers/registry.ts';
import { blockedFetch } from '../lib/providers/http.ts';
import { claudeTextAdapter, claudeTranslationAdapter } from '../lib/providers/adapters/anthropic.ts';
import { geminiImageAdapter, GEMINI_CHARACTER_MODEL } from '../lib/providers/adapters/gemini-image.ts';
import { sheetFromRegistry, type RegistryRow } from '../lib/providers/registry-prices.ts';
import { dbSpendGuard } from '../lib/providers/spend-db.ts';
import { PILOT_STEPS, pilotRequest, researchedEstimate, SAMPLE_BRIEF, type PilotBrief, type PilotStep } from '../lib/generation/pilot.ts';

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const step = arg('step') as PilotStep | undefined;
if (!step || !PILOT_STEPS.includes(step)) {
  console.error(`--step must be one of ${PILOT_STEPS.join(', ')}`);
  process.exit(2);
}
const live = process.argv.includes('--live');
const env: Record<string, string | undefined> = { ...process.env, LIMO_AI_MAX_ATTEMPTS: '1' };
const out = arg('out') ?? join(tmpdir(), 'limo-pilot');

function adapterFor(model: string, fetch: typeof blockedFetch extends (...a: never[]) => infer F ? F : never, keys: { anthropic?: string; google?: string }): CapabilityAdapter {
  if (step === 'translate') return claudeTranslationAdapter({ apiKey: keys.anthropic ?? 'dry-run', fetch, model }) as CapabilityAdapter;
  if (step === 'character-front') return geminiImageAdapter({ apiKey: keys.google ?? 'dry-run', fetch, model: GEMINI_CHARACTER_MODEL, loadAsset: async () => { throw new Error('no input images'); } }) as CapabilityAdapter;
  return claudeTextAdapter({ apiKey: keys.anthropic ?? 'dry-run', fetch, model }) as CapabilityAdapter;
}

async function main() {
  if (live && !arg('brief')) {
    console.error('refused (nothing sent): --brief <file.json> with the owner’s real facts is required for a live call');
    process.exit(2);
  }
  const brief: PilotBrief = arg('brief') ? (JSON.parse(readFileSync(arg('brief')!, 'utf8')) as PilotBrief) : SAMPLE_BRIEF;
  const org = arg('org') ?? '00000000-0000-0000-0000-000000000000';
  const p = pilotRequest(step!, brief, org, env.LIMO_CLAUDE_MODEL || undefined);

  if (!live) {
    const a = adapterFor(p.model, blockedFetch(), {});
    const usage = a.estimateUsage(p.request as never);
    const est = researchedEstimate(p, usage);
    console.log(JSON.stringify({ step, mode: 'dry-run', provider: p.provider, model: p.model, registry: p.registryCode, usage, planningEstimateUsd: est?.usd ?? null, priceSource: est?.sheet.source ?? null, priceVerified: false, killSwitch: killSwitchOn(env), wouldBlock: paidCallBlockers({ env, capability: a.capability as never, capabilityApproved: false, providerEnabledInRegistry: false, priceVerified: false, estimateCents: null, remainingBudgetCents: 0, confirmAboveCents: 0, userConfirmedCents: null, missingReferences: [], sourceApproved: true }) }, null, 2));
    return;
  }

  // ---- live: every gate is checked; anything missing refuses before a request leaves the process ----
  const missing: string[] = [];
  if (generationMode(env) !== 'live') missing.push('LIMO_GENERATION_MODE=live and LIMO_ENABLE_PAID_GENERATION=true');
  if (!env.LIMO_AI_SPEND_SCOPE) missing.push('LIMO_AI_SPEND_SCOPE');
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) missing.push('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  const keyName = p.provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'GEMINI_API_KEY';
  if (!env[keyName]) missing.push(keyName);
  const confirm = Number(arg('confirm-cents'));
  if (!Number.isInteger(confirm) || confirm <= 0) missing.push('--confirm-cents <estimate in cents>');
  if (!arg('org')) missing.push('--org <pilot workspace id>');
  if (missing.length) {
    console.error(`refused (nothing sent): missing ${missing.join(', ')}`);
    process.exit(2);
  }
  const db = createClient(env.SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const table = (t: string) => (db as unknown as { from: (t: string) => any }).from(t);
  const rpc = async (fn: string, a: Record<string, unknown>) => (await (db.rpc as unknown as (f: string, x: object) => Promise<{ data: unknown; error: { message: string } | null }>)(fn, a));
  const { data: row } = await table('ai_provider_registry').select('*').eq('code', p.registryCode).maybeSingle();
  const { data: flag } = await table('feature_flags').select('enabled').eq('key', 'paid_generation').maybeSingle();
  const tier = p.priceKey.includes('@') ? p.priceKey.split('@')[1] : undefined;
  const price = row ? sheetFromRegistry(row as RegistryRow, tier) : null;
  const a = adapterFor(p.model, globalThis.fetch.bind(globalThis), { anthropic: env.ANTHROPIC_API_KEY, google: env.GEMINI_API_KEY });
  const log = (...m: unknown[]) => console.log(new Date().toISOString(), ...m);
  try {
    const ex = await executeOperation(a, p.request, {
      price, spend: dbSpendGuard(env.LIMO_AI_SPEND_SCOPE!, rpc, log),
      gate: { env, capabilityApproved: flag?.enabled === true, providerEnabledInRegistry: !!(row as RegistryRow | null)?.enabled, remainingBudgetCents: 1_000, confirmAboveCents: 0, userConfirmedCents: confirm, missingReferences: [], sourceApproved: true },
    });
    mkdirSync(out, { recursive: true });
    const base = join(out, `${step}-${p.request.requestKey}`);
    writeFileSync(`${base}.json`, JSON.stringify({ step, json: ex.result.json ?? null, text: ex.result.text ?? null, issues: ex.result.issues ?? [], usage: ex.result.usage, actualUsd: ex.actualMicros / 1e6, reservedCents: ex.reservedCents, provenance: ex.result.provenance }, null, 2));
    ex.result.files?.forEach((f, i) => writeFileSync(`${base}-${i}.${f.mime === 'image/png' ? 'png' : f.mime.split('/')[1]}`, f.bytes));
    log('done', step, `actual $${(ex.actualMicros / 1e6).toFixed(4)}`, `→ ${base}.*  (human review required; nothing applied)`);
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
