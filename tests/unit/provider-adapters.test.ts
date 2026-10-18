/**
 * Milestone 10 — provider adapter contract tests against MOCKED HTTP (no network, no API key, no cost).
 * Each test checks the request LIMO sends (URL, method, auth header, body) against the provider's documented
 * API and parses a response built from the documented response shape. These tests do NOT prove that a live
 * provider accepts the request; live verification is a separate, owner-authorised step.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProviderError } from '../../lib/providers/contracts.ts';
import { blockedFetch, isProviderHost, NetworkBlockedError, type FetchLike } from '../../lib/providers/http.ts';
import { claudeStoryAdapter, claudeTextAdapter, claudeTranslationAdapter, inventedNumbers } from '../../lib/providers/adapters/anthropic.ts';
import { geminiAspect, geminiCharacterAdapter, geminiImageAdapter, imagesOf } from '../../lib/providers/adapters/gemini-image.ts';
import { veoAdapter, veoDuration, veoPlan } from '../../lib/providers/adapters/veo.ts';
import { cuesFromAlignment, elevenLabsAdapter } from '../../lib/providers/adapters/elevenlabs.ts';
import { moderationDecision, openAIModerationAdapter, openAITranscriptionAdapter } from '../../lib/providers/adapters/openai.ts';

interface Call { url: string; method: string; headers: Headers; body: unknown }
type Handler = (c: Call) => Response | Promise<Response>;

/** A fake fetch that records every request and answers from `handler`. */
function fakeFetch(handler: Handler) {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init = {}) => {
    const headers = new Headers(init.headers as HeadersInit);
    let body: unknown = init.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        /* keep text */
      }
    }
    const call = { url: String(url), method: (init.method ?? 'GET').toUpperCase(), headers, body };
    calls.push(call);
    return handler(call);
  };
  return { fetch, calls };
}
const json = (data: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } });
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
const loadAsset = async (id: string) => ({ bytes: new TextEncoder().encode(`asset:${id}`), mime: 'image/png' });
const signal = new AbortController().signal;
const base = { requestKey: 'k-1', organizationId: 'org-1', locale: 'en' as const };

// ---- network guard ------------------------------------------------------------------------------------------
test('network guard: provider hosts are recognised and refused before any request leaves the process', async () => {
  assert.equal(isProviderHost('https://api.anthropic.com/v1/messages'), 'api.anthropic.com');
  assert.equal(isProviderHost('https://generativelanguage.googleapis.com/v1beta/interactions'), 'generativelanguage.googleapis.com');
  assert.equal(isProviderHost('https://example.com/'), null);
  const blocked: string[] = [];
  const f = blockedFetch((h) => blocked.push(h));
  await assert.rejects(f('https://api.openai.com/v1/moderations'), NetworkBlockedError);
  assert.deepEqual(blocked, ['api.openai.com']);
});

test('a real adapter on the blocked network fails as "disabled" (never retried) and makes no request', async () => {
  const blocked: string[] = [];
  const img = geminiImageAdapter({ apiKey: 'test-key', fetch: blockedFetch((h) => blocked.push(h)), loadAsset });
  await assert.rejects(img.run({ ...base, kind: 'image', task: 'generate', prompt: 'p', inputAssetIds: [], size: { width: 1080, height: 1920 }, count: 1 }, signal), (e: unknown) => e instanceof ProviderError && e.code === 'disabled');
  assert.deepEqual(blocked, ['generativelanguage.googleapis.com']);
});

// ---- Claude ---------------------------------------------------------------------------------------------------
const claudeMessage = (text: string, extra: Record<string, unknown> = {}) => ({
  id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text }], stop_reason: 'end_turn', stop_sequence: null, stop_details: null,
  usage: { input_tokens: 1200, output_tokens: 300, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, ...extra,
});

test('Claude: Messages API request (model, key header, JSON schema output, effort) and parsed result', async () => {
  const { fetch, calls } = fakeFetch(() => json(claudeMessage(JSON.stringify({ text: 'Fresh bread every morning at Atlas Bakery.' })), 200, { 'request-id': 'req_123' }));
  const a = claudeTextAdapter({ apiKey: 'test-key', fetch });
  const r = await a.run({ ...base, kind: 'text', task: 'rewrite', instructions: 'Rewrite warmly.', facts: { business: 'Atlas Bakery' }, maxOutputTokens: 800 }, signal);
  const c = calls[0]!;
  assert.equal(c.method, 'POST');
  assert.equal(c.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(c.headers.get('x-api-key'), 'test-key');
  assert.ok(c.headers.get('anthropic-version'));
  const body = c.body as Record<string, any>;
  assert.equal(body.model, 'claude-opus-5-5');
  assert.equal(body.max_tokens, 800);
  assert.equal(body.output_config.format.type, 'json_schema');
  assert.equal(body.output_config.format.schema.additionalProperties, false);
  assert.match(body.system, /ONLY the facts/);
  assert.equal(r.json?.text, 'Fresh bread every morning at Atlas Bakery.');
  assert.deepEqual(r.usage, { inputTokens: 1200, outputTokens: 300 }, 'only billed units are metered');
  assert.equal(r.provenance.provider, 'anthropic');
  assert.equal(r.provenance.providerRequestId, 'req_123');
  assert.equal(r.provenance.mock, false);
});

test('Claude: a refusal is content_refused (no retry, no fallback); 429 keeps retry-after; 529 is unavailable', async () => {
  const refused = fakeFetch(() => json(claudeMessage('', { stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'cyber', explanation: null } })));
  await assert.rejects(claudeTextAdapter({ apiKey: 'k', fetch: refused.fetch }).run({ ...base, kind: 'text', task: 'rewrite', instructions: 'x', facts: {}, maxOutputTokens: 100 }, signal), (e: unknown) => e instanceof ProviderError && e.code === 'content_refused');
  assert.equal(refused.calls.length, 1, 'the SDK must not retry on its own (maxRetries: 0)');
  const limited = fakeFetch(() => json({ type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } }, 429, { 'retry-after': '7' }));
  await assert.rejects(claudeTextAdapter({ apiKey: 'k', fetch: limited.fetch }).run({ ...base, kind: 'text', task: 'rewrite', instructions: 'x', facts: {}, maxOutputTokens: 100 }, signal), (e: unknown) => e instanceof ProviderError && e.code === 'rate_limited' && e.retryAfterMs === 7000);
  assert.equal(limited.calls.length, 1);
  const busy = fakeFetch(() => json({ type: 'error', error: { type: 'overloaded_error', message: 'busy' } }, 529));
  await assert.rejects(claudeTextAdapter({ apiKey: 'k', fetch: busy.fetch }).run({ ...base, kind: 'text', task: 'rewrite', instructions: 'x', facts: {}, maxOutputTokens: 100 }, signal), (e: unknown) => e instanceof ProviderError && e.code === 'unavailable');
});

test('Claude: invented numbers are flagged; translation keeps locked terms or reports them', async () => {
  assert.deepEqual(inventedNumbers('Only 2900 DA, -30% today!', 'price: 3 900 DA'), ['2900', '30']);
  assert.deepEqual(inventedNumbers('Rose Perfume 3 900 DA', 'Rose Perfume 3 900 DA'), []);
  const { fetch } = fakeFetch(() => json(claudeMessage(JSON.stringify({ text: 'Only 2900 DA today!' }))));
  const r = await claudeTextAdapter({ apiKey: 'k', fetch }).run({ ...base, kind: 'text', task: 'post_caption', instructions: 'Write a caption.', facts: { price: '3 900 DA' }, maxOutputTokens: 400 }, signal);
  assert.equal(r.issues?.[0]?.code, 'invented_facts');
  const t = fakeFetch(() => json(claudeMessage(JSON.stringify({ text: 'عطر الورد بـ 3 900 دج' }))));
  const tr = await claudeTranslationAdapter({ apiKey: 'k', fetch: t.fetch }).run({ ...base, locale: 'ar', kind: 'translation', source: 'en', text: 'Rose Perfume for 3 900 DA', lockedTerms: ['Rose Perfume', '3 900 DA'] }, signal);
  assert.equal(tr.issues?.[0]?.code, 'locked_term_changed');
  assert.match(String((t.calls[0]!.body as Record<string, string>).system), /Arabic/);
});

test('Claude: story continuation sends the locked Story Bible version and the previous approved ending', async () => {
  const { fetch, calls } = fakeFetch(() => json(claudeMessage(JSON.stringify({ title: 'Episode 2', scenes: [], uses_canon: ['limo_boy'] }))));
  const r = await claudeStoryAdapter({ apiKey: 'k', fetch }).run({ ...base, kind: 'story', task: 'continue_episode', bibleVersion: 3, bible: 'Limo is a tomato boy.', previousCheckpoint: { episode: 1, summary: 'They plant tomatoes.', endingHook: 'A sprout appears.' }, characterSpecVersions: { limo_boy: 1 }, maxOutputTokens: 2000 }, signal);
  const content = String(((calls[0]!.body as Record<string, any>).messages[0]).content);
  assert.match(content, /Story Bible version 3/);
  assert.match(content, /A sprout appears\./);
  assert.match(content, /at most 30 seconds/);
  assert.deepEqual(r.provenance.characterSpecVersions, { limo_boy: 1 });
});

// ---- Gemini images --------------------------------------------------------------------------------------------
const interaction = (data?: string) => ({ id: 'int_1', status: 'completed', steps: [{ type: 'model_output', content: data ? [{ type: 'image', data, mime_type: 'image/png' }] : [{ type: 'text', text: 'no' }] }], usage: { total_input_tokens: 900, total_output_tokens: 1290 } });

test('Gemini image: Interactions request (model, key header, input parts, response_format) and image output', async () => {
  const { fetch, calls } = fakeFetch(() => json(interaction(Buffer.from(PNG).toString('base64'))));
  const a = geminiImageAdapter({ apiKey: 'g-key', fetch, loadAsset });
  const r = await a.run({ ...base, kind: 'image', task: 'edit', prompt: 'Perfume bottle on marble, soft light', inputAssetIds: ['photo-1'], size: { width: 1080, height: 1350 }, count: 1 }, signal);
  const c = calls[0]!;
  assert.equal(c.url, 'https://generativelanguage.googleapis.com/v1beta/interactions');
  assert.equal(c.headers.get('x-goog-api-key'), 'g-key');
  const body = c.body as Record<string, any>;
  assert.equal(body.model, 'gemini-nano-banana-2.1');
  assert.equal(body.input[0].type, 'text');
  assert.match(body.input[0].text, /Keep the product in the input photo exactly/);
  assert.match(body.input[0].text, /Do not render any words/);
  assert.equal(body.input[1].type, 'image');
  assert.equal(body.input[1].mime_type, 'image/png');
  assert.deepEqual(body.response_format, { type: 'image', mime_type: 'image/png', aspect_ratio: '4:5', image_size: '2K' });
  assert.equal(r.files?.length, 1);
  assert.deepEqual([...r.files![0]!.bytes], [...PNG]);
  assert.equal(r.provenance.contentCredentials, 'SynthID');
  assert.deepEqual(r.provenance.inputAssetIds, ['photo-1']);
});

test('Gemini image: no image or a safety 400 is content_refused; reference limits are checked before any request', async () => {
  const empty = fakeFetch(() => json(interaction()));
  await assert.rejects(geminiImageAdapter({ apiKey: 'k', fetch: empty.fetch, loadAsset }).run({ ...base, kind: 'image', task: 'generate', prompt: 'p', inputAssetIds: [], size: { width: 1080, height: 1080 }, count: 1 }, signal), (e: unknown) => e instanceof ProviderError && e.code === 'content_refused');
  const blocked = fakeFetch(() => json({ error: { message: 'Request blocked by safety filters' } }, 400));
  await assert.rejects(geminiImageAdapter({ apiKey: 'k', fetch: blocked.fetch, loadAsset }).run({ ...base, kind: 'image', task: 'generate', prompt: 'p', inputAssetIds: [], size: { width: 1080, height: 1080 }, count: 1 }, signal), (e: unknown) => e instanceof ProviderError && e.code === 'content_refused');
  const none = fakeFetch(() => json(interaction('AA==')));
  const refs = Array.from({ length: 6 }, (_, i) => `ref-${i}`);
  await assert.rejects(geminiCharacterAdapter({ apiKey: 'k', fetch: none.fetch, loadAsset }).run({ ...base, kind: 'character_image', prompt: 'p', references: [{ character: 'limo_boy', specVersion: 1, assetIds: refs }], size: { width: 2048, height: 2731 }, count: 1 }, signal), (e: unknown) => e instanceof ProviderError && e.code === 'invalid_request');
  assert.equal(none.calls.length, 0);
  assert.equal(geminiAspect(1920, 1080), '16:9');
  assert.equal(imagesOf({ steps: [{ type: 'thought', content: [{ type: 'image', data: 'AA==' }] }] }).length, 0, 'only model_output steps count');
});

test('Gemini character image: approved references are sent and the identity lock is in the prompt', async () => {
  const { fetch, calls } = fakeFetch(() => json(interaction(Buffer.from(PNG).toString('base64'))));
  const r = await geminiCharacterAdapter({ apiKey: 'k', fetch, loadAsset }).run({ ...base, kind: 'character_image', prompt: 'Limo waves in the garden', references: [{ character: 'limo_boy', specVersion: 1, assetIds: ['front', 'three_quarter'] }], size: { width: 1080, height: 1920 }, count: 1 }, signal);
  const body = calls[0]!.body as Record<string, any>;
  assert.equal(body.model, 'gemini-3-pro-image');
  assert.equal(body.input.filter((p: { type: string }) => p.type === 'image').length, 2);
  assert.match(body.input[0].text, /limo_boy \(design spec v1\)/);
  assert.match(body.input[0].text, /Keep their identity exactly/);
  assert.deepEqual(r.provenance.referenceAssetIds, ['front', 'three_quarter']);
  assert.deepEqual(r.provenance.characterSpecVersions, { limo_boy: 1 });
});

// ---- Veo -----------------------------------------------------------------------------------------------------
const videoReq = (over: Record<string, unknown> = {}) => ({ ...base, kind: 'video' as const, prompt: 'Slow push-in on the perfume', firstFrameAssetId: 'still-1', references: [], durationSeconds: 5, videoTotalSeconds: 20, aspect: '1:1' as const, scriptRevisionId: 'rev-1', ...over });

test('Veo: clip length and aspect rules (4/6/8 s; 9:16 for square and 4:5; 8 s with references or 1080p)', () => {
  assert.deepEqual([1, 4, 5, 6, 7, 8, 12, 15].map((s) => veoDuration(s, false)), [4, 4, 6, 6, 8, 8, 8, 8]);
  assert.equal(veoDuration(3, true), 8);
  assert.equal(veoPlan(videoReq(), { tier: 'fast' }).aspect, '9:16');
  assert.equal(veoPlan(videoReq({ aspect: '16:9' }), { tier: 'fast' }).aspect, '16:9');
  assert.equal(veoPlan(videoReq(), { tier: 'fast', resolution: '1080p' }).seconds, 8);
  assert.throws(() => veoPlan(videoReq({ references: [{ character: 'limo_boy', specVersion: 1, assetIds: ['a'] }] }), { tier: 'lite' }), /Lite does not accept reference/);
  assert.throws(() => veoPlan(videoReq({ references: [{ character: 'x', specVersion: 1, assetIds: ['a', 'b', 'c', 'd'] }] }), { tier: 'fast' }), /at most 3/);
});

test('Veo: submit (predictLongRunning body), poll (running → done), download with the key header', async () => {
  let polls = 0;
  const { fetch, calls } = fakeFetch((c) => {
    if (c.url.endsWith(':predictLongRunning')) return json({ name: 'models/veo-3.1-fast-generate-preview/operations/op123' });
    if (c.url.endsWith('/operations/op123')) return json(++polls < 2 ? { name: 'op', done: false } : { name: 'op', done: true, response: { generateVideoResponse: { generatedSamples: [{ video: { uri: 'https://generativelanguage.googleapis.com/v1beta/files/vid1:download?alt=media' } }] } } });
    return new Response(new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]), { status: 200, headers: { 'content-type': 'video/mp4' } });
  });
  const a = veoAdapter({ apiKey: 'g-key', fetch, tier: 'fast', loadAsset });
  const sub = await a.submit(videoReq({ references: [{ character: 'limo_boy', specVersion: 1, assetIds: ['front'] }] }), signal);
  const body = calls[0]!.body as Record<string, any>;
  assert.equal(calls[0]!.url, 'https://generativelanguage.googleapis.com/v1beta/models/veo-3.1-fast-generate-preview:predictLongRunning');
  assert.equal(calls[0]!.headers.get('x-goog-api-key'), 'g-key');
  assert.equal(body.instances[0].prompt, 'Slow push-in on the perfume');
  assert.equal(body.instances[0].image.inlineData.mimeType, 'image/png');
  assert.equal(body.instances[0].referenceImages[0].referenceType, 'asset');
  assert.deepEqual(body.parameters, { aspectRatio: '9:16', resolution: '720p', durationSeconds: '8', numberOfVideos: 1, personGeneration: 'allow_adult' });
  assert.equal(sub.taskId, 'models/veo-3.1-fast-generate-preview/operations/op123');
  assert.deepEqual(await a.poll(sub.taskId, signal), { status: 'running' });
  const done = await a.poll(sub.taskId, signal);
  assert.equal(done.status, 'succeeded');
  const r = await a.fetchResult(videoReq(), (done as { outputRef: string }).outputRef, sub.plan, signal);
  const dl = calls[calls.length - 1]!;
  assert.equal(dl.headers.get('x-goog-api-key'), 'g-key');
  assert.equal(r.files?.[0]?.mime, 'video/mp4');
  assert.equal(r.usage.videoSeconds, 8);
  assert.equal(r.provenance.contentCredentials, 'SynthID');
});

test('Veo: provider error and missing video are failures; foreign download hosts and bad operation names are refused', async () => {
  const { fetch, calls } = fakeFetch((c) => (c.url.includes('opErr') ? json({ done: true, error: { code: 3, message: 'Prompt blocked by safety policy' } }) : json({ done: true, response: { generateVideoResponse: { generatedSamples: [] } } })));
  const a = veoAdapter({ apiKey: 'k', fetch, loadAsset });
  const e1 = await a.poll('models/x/operations/opErr', signal);
  assert.ok(e1.status === 'failed' && e1.error.code === 'content_refused');
  const e2 = await a.poll('models/x/operations/opEmpty', signal);
  assert.ok(e2.status === 'failed' && e2.error.code === 'content_refused');
  await assert.rejects(a.poll('../../evil', signal), /invalid operation name/);
  const n = calls.length;
  await assert.rejects(a.fetchResult(videoReq(), 'https://evil.example.com/v.mp4', { model: 'm', seconds: 4 }, signal), /unexpected video URL host/);
  assert.equal(calls.length, n);
});

// ---- ElevenLabs ------------------------------------------------------------------------------------------------
test('ElevenLabs: with-timestamps request and subtitle cues from the character alignment', async () => {
  const text = 'Fresh bread every morning';
  const chars = [...text];
  const { fetch, calls } = fakeFetch(() => json({ audio_base64: Buffer.from('ID3fake').toString('base64'), alignment: { characters: chars, character_start_times_seconds: chars.map((_, i) => i * 0.06), character_end_times_seconds: chars.map((_, i) => i * 0.06 + 0.05) } }));
  const r = await elevenLabsAdapter({ apiKey: 'xi-key', fetch }).run({ ...base, locale: 'fr', kind: 'voice', text, voiceId: 'Voice1234abcd', voiceProfileVersion: 1, scriptRevisionId: 'rev-1' }, signal);
  const c = calls[0]!;
  assert.equal(c.url, 'https://api.elevenlabs.io/v1/text-to-speech/Voice1234abcd/with-timestamps?output_format=mp3_44100_128');
  assert.equal(c.headers.get('xi-api-key'), 'xi-key');
  assert.deepEqual(c.body, { text, model_id: 'eleven_flash_v2_5', language_code: 'fr' });
  assert.equal(r.files?.[0]?.mime, 'audio/mpeg');
  assert.deepEqual(r.subtitles, [{ startMs: 0, endMs: Math.round((chars.length - 1) * 60 + 50), text }]);
  assert.equal(r.provenance.voiceId, 'Voice1234abcd');
  const m = fakeFetch(() => json({ audio_base64: 'AA==', alignment: null }));
  await elevenLabsAdapter({ apiKey: 'k', fetch: m.fetch, model: 'eleven_multilingual_v2' }).run({ ...base, kind: 'voice', text: 'Hi', voiceId: 'Voice1234abcd', voiceProfileVersion: null, scriptRevisionId: 'r' }, signal);
  assert.equal((m.calls[0]!.body as Record<string, unknown>).language_code, undefined, 'multilingual_v2 does not take language_code');
  await assert.rejects(elevenLabsAdapter({ apiKey: 'k', fetch: m.fetch }).run({ ...base, kind: 'voice', text: 'Hi', voiceId: '../x', voiceProfileVersion: null, scriptRevisionId: 'r' }, signal), /invalid voice id/);
  assert.equal(m.calls.length, 1);
  assert.deepEqual(cuesFromAlignment(null), []);
});

// ---- OpenAI moderation and transcription ---------------------------------------------------------------------
test('OpenAI moderation: request shape and decision (block / review / allow)', async () => {
  const { fetch, calls } = fakeFetch(() => json({ id: 'modr-1', results: [{ flagged: true, categories: { violence: true, 'sexual/minors': false } }] }));
  const r = await openAIModerationAdapter({ apiKey: 'o-key', fetch, loadAsset }).run({ ...base, kind: 'safety', text: 'A fight scene', imageAssetIds: ['img-1'] }, signal);
  const c = calls[0]!;
  assert.equal(c.url, 'https://api.openai.com/v1/moderations');
  assert.equal(c.headers.get('authorization'), 'Bearer o-key');
  const body = c.body as Record<string, any>;
  assert.equal(body.model, 'omni-moderation-latest');
  assert.equal(body.input[1].type, 'image_url');
  assert.match(body.input[1].image_url.url, /^data:image\/png;base64,/);
  assert.deepEqual(r.json, { decision: 'review', categories: ['violence'] });
  assert.deepEqual(moderationDecision({ 'sexual/minors': true }), { decision: 'block', categories: ['sexual/minors'] });
  assert.deepEqual(moderationDecision({}), { decision: 'allow', categories: [] });
});

test('OpenAI transcription: whisper-1 multipart with word timestamps → subtitle cues; files over 25 MB refused', async () => {
  const { fetch, calls } = fakeFetch(() => json({ text: 'Bonjour à tous', duration: 1.4, words: [{ word: 'Bonjour', start: 0, end: 0.5 }, { word: 'à', start: 0.5, end: 0.7 }, { word: 'tous', start: 0.7, end: 1.2 }] }));
  const audio = async () => ({ bytes: new Uint8Array(1000), mime: 'audio/mpeg' });
  const r = await openAITranscriptionAdapter({ apiKey: 'o', fetch, loadAsset: audio }).run({ ...base, locale: 'fr', kind: 'transcription', audioAssetId: 'a1', durationSeconds: 2, wantWordTimings: true }, signal);
  const form = calls[0]!.body as FormData;
  assert.equal(calls[0]!.url, 'https://api.openai.com/v1/audio/transcriptions');
  assert.equal(form.get('model'), 'whisper-1');
  assert.equal(form.get('response_format'), 'verbose_json');
  assert.equal(form.get('timestamp_granularities[]'), 'word');
  assert.equal(form.get('language'), 'fr');
  assert.deepEqual(r.subtitles, [{ startMs: 0, endMs: 1200, text: 'Bonjour à tous' }]);
  const big = async () => ({ bytes: new Uint8Array(26 * 1024 * 1024), mime: 'audio/mpeg' });
  await assert.rejects(openAITranscriptionAdapter({ apiKey: 'o', fetch, loadAsset: big }).run({ ...base, kind: 'transcription', audioAssetId: 'a1', durationSeconds: 2, wantWordTimings: true }, signal), /25 MB/);
  assert.equal(calls.length, 1);
});
