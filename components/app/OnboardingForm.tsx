'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { useI18n } from '@/lib/i18n/client';
import { completeProfileAction } from '@/lib/data/actions';

const ISO_REGIONS =
  'AD AE AF AG AI AL AM AO AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GT GU GW GY HK HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'.split(' ');

function maxBirthDate(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 18);
  return d.toISOString().slice(0, 10);
}

export function OnboardingForm() {
  const { t, intl } = useI18n();
  const router = useRouter();
  // Built in the browser only: Node and the browser ship different ICU data, so localized region names rendered on
  // the server did not always match the client (React hydration error #418).
  const [regions, setRegions] = useState<Array<{ code: string; name: string }>>([]);
  useEffect(() => {
    const local = new Intl.DisplayNames([intl], { type: 'region' });
    setRegions(ISO_REGIONS.map((code) => ({ code, name: local.of(code) ?? code })).sort((a, b) => a.name.localeCompare(b.name, intl)));
  }, [intl]);
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    countryCode: '',
    region: '',
    dateOfBirth: '',
    accountType: 'creator',
    acceptTerms: false,
    acceptSafety: false,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (form.dateOfBirth && form.dateOfBirth > maxBirthDate()) return setError(t.onboarding.errors.age);
    setBusy(true);
    const english = new Intl.DisplayNames(['en'], { type: 'region' });
    const result = await completeProfileAction({ ...form, countryName: english.of(form.countryCode) ?? form.countryCode });
    if (result.ok) {
      router.replace('/app');
      router.refresh();
      return;
    }
    setBusy(false);
    setError(result.error === 'generic' ? t.common.errorGeneric : t.onboarding.errors[result.error]);
  }

  return (
    <form className="stack-lg" onSubmit={submit}>
      {error && (
        <p className="form-message error" role="alert">
          {error}
        </p>
      )}
      <div className="form-grid cols-2">
        <label className="field">
          <span className="field-label">{t.onboarding.firstName}</span>
          <input className="input" required maxLength={80} autoComplete="given-name" value={form.firstName} onChange={(e) => set('firstName', e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">{t.onboarding.lastName}</span>
          <input className="input" required maxLength={80} autoComplete="family-name" value={form.lastName} onChange={(e) => set('lastName', e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">{t.onboarding.country}</span>
          <select className="select" required value={form.countryCode} onChange={(e) => set('countryCode', e.target.value)} autoComplete="country">
            <option value="" disabled>
              —
            </option>
            {regions.map((r) => (
              <option key={r.code} value={r.code}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">{t.onboarding.region}</span>
          <input className="input" required maxLength={120} autoComplete="address-level1" value={form.region} onChange={(e) => set('region', e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">{t.onboarding.dateOfBirth}</span>
          <input className="input ltr" type="date" required max={maxBirthDate()} value={form.dateOfBirth} onChange={(e) => set('dateOfBirth', e.target.value)} autoComplete="bday" />
        </label>
        <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="field-label">{t.onboarding.accountType}</legend>
          <div className="row" role="radiogroup">
            {(['creator', 'business', 'agency'] as const).map((type) => (
              <button key={type} type="button" role="radio" aria-checked={form.accountType === type} className="chip" onClick={() => set('accountType', type)}>
                {t.onboarding.accountTypes[type]}
              </button>
            ))}
          </div>
        </fieldset>
      </div>
      <div className="stack" style={{ gap: 12 }}>
        <label className="checkbox">
          <input type="checkbox" checked={form.acceptTerms} onChange={(e) => set('acceptTerms', e.target.checked)} required />
          <span>
            {t.onboarding.acceptTerms}{' '}
            <a className="link" href="/legal/terms" target="_blank" rel="noreferrer">
              {t.nav.terms}
            </a>{' '}
            ·{' '}
            <a className="link" href="/legal/privacy" target="_blank" rel="noreferrer">
              {t.nav.privacy}
            </a>
          </span>
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={form.acceptSafety} onChange={(e) => set('acceptSafety', e.target.checked)} required />
          <span>{t.onboarding.acceptSafety}</span>
        </label>
      </div>
      <button className="btn btn-primary btn-lg" type="submit" disabled={busy}>
        {busy ? t.common.loading : t.onboarding.submit}
      </button>
    </form>
  );
}
