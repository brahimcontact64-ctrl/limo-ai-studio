import 'server-only';
import { cache } from 'react';
import { untyped } from '../supabase/rpc';
import { getSupabaseServer } from '../supabase/server';
import { isCastVariantId } from '../studio/limits';
import type { CatalogOption, CharacterRecord, ExportPresetOption } from '../studio/types';

export interface Catalogs {
  contentTypes: CatalogOption[];
  languages: Array<CatalogOption & { native_name: string }>;
  exportPresets: ExportPresetOption[];
  characters: CharacterRecord[];
  ok: boolean;
}

/** Reads the live catalogs (all readable by anon/authenticated through RLS). */
export const getCatalogs = cache(async (): Promise<Catalogs> => {
  const supabase = await getSupabaseServer();
  const [types, langs, presets, chars, specs] = await Promise.all([
    supabase.from('content_type_catalog').select('code, label').eq('active', true).order('sort_order'),
    supabase.from('language_catalog').select('code, label, native_name').eq('active', true).order('sort_order'),
    supabase
      .from('export_presets')
      .select('code, label, aspect_ratio, width, height, recommended_for')
      .eq('active', true)
      .order('sort_order'),
    supabase
      .from('character_catalog')
      .select('id, name, family_code, age_group, gender_code, reference_status, visual_description, tone, visual_ref, sort_order')
      .eq('active', true)
      .not('family_code', 'is', null)
      .order('sort_order'),
    // Latest design spec per character (migration 20261017140000; absent before it is applied).
    untyped(supabase).from('character_design_specs').select('character_id, version, status, spec').neq('status', 'superseded').order('version', { ascending: false }),
  ]);
  type SpecRow = { character_id: string; version: number; status: string; spec: { consistency?: { identity_prompt?: string } } };
  const latest = new Map<string, { version: number; status: string; identity: string | null }>();
  for (const row of (specs.error ? [] : (specs.data ?? [])) as SpecRow[]) {
    if (!latest.has(row.character_id)) latest.set(row.character_id, { version: row.version, status: row.status, identity: row.spec?.consistency?.identity_prompt ?? null });
  }

  return {
    contentTypes: types.data ?? [],
    languages: langs.data ?? [],
    exportPresets: presets.data ?? [],
    // Only the 18 cast variants; family base records are excluded.
    characters: (chars.data ?? [])
      .filter((c) => isCastVariantId(c.id))
      .map((c) => {
        const spec = latest.get(c.id);
        return { ...c, identity_prompt: spec?.identity ?? null, spec_version: spec?.version ?? null, spec_status: spec?.status ?? null };
      }),
    ok: !types.error && !langs.error && !presets.error && !chars.error,
  };
});

export interface PlanRecord {
  code: string;
  name: string;
  monthly_dzd: number;
  redotpay_usdt: number;
  video_slots: number;
  ai_images: number;
  posts: number;
}

export const getPlans = cache(async (): Promise<PlanRecord[] | null> => {
  const supabase = await getSupabaseServer();
  const { data, error } = await supabase
    .from('plan_definitions')
    .select('code, name, monthly_dzd, redotpay_usdt, video_slots, ai_images, posts')
    .eq('active', true)
    .order('sort_order');
  if (error) return null;
  return (data ?? []).map((p) => ({ ...p, redotpay_usdt: Number(p.redotpay_usdt) }));
});
