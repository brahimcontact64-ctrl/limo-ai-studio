import { test } from 'node:test';
import assert from 'node:assert/strict';
import en from '../../lib/i18n/dictionaries/en.ts';
import fr from '../../lib/i18n/dictionaries/fr.ts';
import ar from '../../lib/i18n/dictionaries/ar.ts';
import de from '../../lib/i18n/dictionaries/de.ts';
import { negotiateLocale, fmt, isLocale } from '../../lib/i18n/config.ts';
import { safeNext } from '../../lib/auth/redirect.ts';

type Tree = { [k: string]: unknown };

function leaves(obj: unknown, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  if (typeof obj === 'string') {
    out.set(prefix, obj);
    return out;
  }
  if (Array.isArray(obj)) {
    out.set(`${prefix}[]`, `array:${obj.length > 0 ? 'nonempty' : 'empty'}`);
    obj.forEach((item, i) => leaves(item, `${prefix}[${i}]`).forEach((v, k) => out.set(k, v)));
    return out;
  }
  for (const [k, v] of Object.entries(obj as Tree)) leaves(v, prefix ? `${prefix}.${k}` : k).forEach((val, key) => out.set(key, val));
  return out;
}

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
const base = leaves(en);

for (const [name, dict] of Object.entries({ fr, ar, de })) {
  test(`${name}: has every key from en (except variable-length arrays) and no extras`, () => {
    const other = leaves(dict);
    const fixed = (k: string) => !/\[\d+\]/.test(k);
    const missing = [...base.keys()].filter((k) => fixed(k) && !other.has(k));
    const extra = [...other.keys()].filter((k) => fixed(k) && !base.has(k));
    assert.deepEqual(missing, [], `missing in ${name}`);
    assert.deepEqual(extra, [], `extra in ${name}`);
  });

  test(`${name}: keeps the same {placeholders} as en`, () => {
    const other = leaves(dict);
    const mismatched = [...base.entries()]
      .filter(([k]) => other.has(k))
      .filter(([k, v]) => placeholders(v) !== placeholders(other.get(k) as string))
      .map(([k]) => k);
    assert.deepEqual(mismatched, []);
  });

  test(`${name}: is actually translated (not a copy of en)`, () => {
    const other = leaves(dict);
    // Array-shape markers ("x[]" → "array:nonempty") are structural, not text; their items are compared individually.
    const same = [...base.entries()].filter(([k, v]) => !k.endsWith('[]') && other.get(k) === v && v.length > 12 && !/^[\d{}\s/%·.,()+-]*$/.test(v));
    // Brand names and technical strings may legitimately match; real copies would be hundreds.
    assert.ok(same.length < 15, `${same.length} untranslated strings, e.g. ${same.slice(0, 5).map(([k]) => k).join(', ')}`);
  });
}

test('locale negotiation picks the best supported language', () => {
  assert.equal(negotiateLocale('ar-DZ,ar;q=0.9,fr;q=0.8'), 'ar');
  assert.equal(negotiateLocale('es-ES,es;q=0.9,de;q=0.5'), 'de');
  assert.equal(negotiateLocale('ja'), 'en');
  assert.equal(negotiateLocale(null), 'en');
  assert.equal(negotiateLocale('fr;q=0.2,en;q=0.9'), 'en');
  assert.equal(isLocale('ar'), true);
  assert.equal(isLocale('es'), false);
});

test('fmt replaces placeholders and leaves unknown ones', () => {
  assert.equal(fmt('Scene {n}: {message}', { n: 3, message: 'ok' }), 'Scene 3: ok');
  assert.equal(fmt('{a} {b}', { a: 1 }), '1 {b}');
});

test('safeNext only allows same-origin relative paths', () => {
  assert.equal(safeNext('/app/projects?x=1'), '/app/projects?x=1');
  assert.equal(safeNext('//evil.example/path'), '/app');
  assert.equal(safeNext('https://evil.example'), '/app');
  assert.equal(safeNext('/\\evil.example'), '/app');
  assert.equal(safeNext('javascript:alert(1)'), '/app');
  assert.equal(safeNext(null), '/app');
  assert.equal(safeNext('/app\n'), '/app');
});
