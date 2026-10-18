# AI provider research and selection (Milestone 10)

Research date: **2026-10-18**, from official API documentation, pricing pages and terms only (links below).
Prices are copied as published on that date and **must be re-confirmed by the owner before activation** — in
code every price sheet starts *unverified* (`verifiedBy: null`), so no paid call can run until the owner
confirms it (`lib/providers/prices.ts`). Anything a page did not state is marked **unverified**.
No API key was requested or used and **no live provider call was made**; adapters were tested only against
mocked HTTP responses built from the documented request/response shapes.

## Summary of choices

| Capability | Primary | Alternative | Why |
|---|---|---|---|
| Script, rewrite, dialogue, translation, story continuation, continuity | Anthropic Claude (`claude-opus-5-5`, Messages API, structured JSON output) | OpenAI `gpt-6.1-sol` (already in the registry) / Claude Sonnet 5.5 for cost | Long context for the Story Bible, JSON schema output, refusals surfaced as `stop_reason: "refusal"`, no training on customer content under commercial terms |
| Safety pre-check (prompts and images) | OpenAI Moderation `omni-moderation-latest` (free) | Claude classification prompt | Free, text + image categories, already in the registry |
| Image generation and editing (product preserved) | Google Gemini image `gemini-nano-banana-2.1` (Interactions API) | OpenAI `gpt-image-2` (Image API) / Runway `gen4_image` | Published per-image price; up to 10 object + 4 character reference images; editing with input images; SynthID watermark |
| Character-consistent artwork (canonical sheets) | Google `gemini-3-pro-image` (up to 5 character + 6 object + 3 style references) | `gemini-nano-banana-2.1` for drafts | Most reference capacity; premium quality for the 54 canonical images |
| Video (text- and image-to-video) | Google Veo 3.1 (`veo-3.1-fast-generate-preview`; `veo-3.1-lite-generate-preview` for economy) | Runway `gen4_turbo` (already in the registry; adapter after its API details are verified) | Fully documented async API (predictLongRunning + operation polling + download), image-to-video, up to 3 asset references (character consistency), 720p/1080p, SynthID |
| Voice (narration, per-character voices, multilingual) | ElevenLabs (`eleven_flash_v2_5`, `eleven_multilingual_v2`) | Gemini TTS (`gemini-3.8-flash-tts`) / OpenAI `gpt-4o-mini-tts` | Arabic, French, German, English; stable voice ids per character; character-level timestamps for subtitles |
| Transcription and subtitles | OpenAI `whisper-1` (`verbose_json` + word timestamps) | ElevenLabs Scribe v2 / OpenAI `gpt-transcribe` | Word timestamps documented for whisper-1; 98 languages |
| Final MP4 assembly | LIMO FFmpeg render worker (existing, Milestone 7) | — | Already built; consumes the one video credit per completed export |

## Per provider (verified facts, 2026-10-18)

### Anthropic — Claude Messages API
- Models and prices (per million tokens, input / output): Claude Opus 5.5 `claude-opus-5-5` $4 / $20 (cache read $0.20);
  Claude Sonnet 5.5 `claude-sonnet-5-5` $2 / $10; Claude Haiku 5.5 `claude-haiku-5-5` $0.10 / $0.50 (≤100k-token prompts).
  Source: https://platform.claude.com/docs/en/about-claude/pricing
- API: `POST https://api.anthropic.com/v1/messages` through the official `@anthropic-ai/sdk`; auth `x-api-key`; structured
  output with `output_config.format = { type: "json_schema", schema }` (objects need `additionalProperties: false`;
  no numeric/length constraints). Refusals: HTTP 200 with `stop_reason: "refusal"`. Errors: 429 rate limit (`retry-after`),
  529 overloaded, 5xx.
- Context 1M tokens, output up to 128K. Thinking is adaptive on Opus 5.5 (effort default `medium`).
- Languages: multilingual incl. Arabic, French, German (quality to be checked on the LIMO test set).
- Terms: customer owns outputs; Anthropic "may not train models on Customer Content from Services".
  Source: https://www.anthropic.com/legal/commercial-terms
- Server-side refusal fallbacks exist but are **left off**: the owner's rule is never to retry automatically after a
  safety refusal.

### OpenAI — Moderation, Image API, transcription, speech
- Moderation: `POST https://api.openai.com/v1/moderations`, `omni-moderation-latest`, "free to use"; text and image
  input; returns `flagged`, `categories`, `category_scores`. Source: https://developers.openai.com/api/docs/guides/moderation
- Images: `POST /v1/images/generations`, `POST /v1/images/edits` (multiple `image[]` inputs, optional mask); sizes
  1024x1024 / 1536x1024 / 1024x1536 or custom multiples of 16; quality low…max; response `data[0].b64_json`;
  moderation blocks return `moderation_blocked`. `gpt-image-2`: image output $30 / 1M tokens, image input $8 / 1M,
  text input $5 / 1M. **Per-image price: unverified** (published only as tokens + calculator).
  Sources: https://developers.openai.com/api/docs/pricing, https://developers.openai.com/api/docs/guides/image-generation
- Transcription: `POST /v1/audio/transcriptions`; files up to 25 MB (mp3, mp4, mpeg, mpga, m4a, wav, webm);
  `whisper-1` supports `verbose_json` with `timestamp_granularities[]=word`; Whisper $0.006 / minute.
  Arabic/German support for `gpt-transcribe`: **unverified**. Source: https://developers.openai.com/api/docs/guides/speech-to-text
- Speech: `gpt-4o-mini-tts` text $0.60 / 1M tokens + audio $12 / 1M tokens; `tts-1` $15 / 1M characters.
- Video (Sora): **no API price published on the pricing page** on the research date — not selected.

### Google — Gemini API (images, Veo video, TTS)
- Images: `POST https://generativelanguage.googleapis.com/v1beta/interactions`, header `x-goog-api-key`;
  `input` parts `{type:"text"}` / `{type:"image", mime_type, data}`; `response_format {type:"image", mime_type,
  aspect_ratio, image_size}` (sizes `1K`/`2K`/`4K`, uppercase); generated images are `image` content blocks in
  `steps[].content[]` of `model_output` steps (`data`, `mime_type`). Reference images: up to 14 in total; Nano Banana 2.1:
  10 object + 4 character; Pro: 6 object + 5 character + 3 style. All images carry SynthID.
  Prices: `gemini-nano-banana-2.1` $0.0336 (1K), $0.0504 (2K), $0.113 (4K) per image + $1.50 / 1M input tokens;
  `gemini-3-pro-image` $0.134 (1K/2K), $0.24 (4K); `gemini-3.1-flash-lite-image` $0.0336 (1K only).
  Sources: https://ai.google.dev/gemini-api/docs/pricing, https://ai.google.dev/gemini-api/docs/image-generation,
  https://ai.google.dev/api/interactions
- Veo 3.1: `POST /v1beta/models/<model>:predictLongRunning` with `instances[0].prompt`, optional `image` (first frame,
  `inlineData {mimeType, data}`), `lastFrame`, `referenceImages` (≤3, `referenceType: "asset"`, not on Lite);
  `parameters.aspectRatio` `16:9` | `9:16`; `parameters.resolution` `720p` | `1080p` | `4k` (1080p/4k need 8 s);
  `durationSeconds` `4` | `6` | `8` (8 with references); `numberOfVideos` 1. Poll `GET /v1beta/<operation>` until
  `done`; video at `response.generateVideoResponse.generatedSamples[0].video.uri`, downloaded with the API key header.
  Audio is always generated. Videos are kept **2 days** on Google's side (LIMO copies them to its own storage at once).
  `personGeneration` must be `allow_adult` in the EU, UK, CH and MENA. Latency 11 s – 6 min. Blocked videos are not charged.
  Prices per second (with audio): Standard $0.40 (720p/1080p) / $0.60 (4k); Fast $0.10 / $0.12 / $0.30; Lite $0.05 / $0.08.
  Source: https://ai.google.dev/gemini-api/docs/veo
- TTS: `gemini-3.8-flash-tts` $0.50 / 1M input, $9.00 / 1M audio output until 2026-12-31 (then $1.00 / $18.00).
- Rate limits are shown per project in AI Studio only; spend limits per 10 minutes by tier (Tier 1 $10 … Tier 3 $200).
  Source: https://ai.google.dev/gemini-api/docs/rate-limits
- Terms: Google does not claim ownership of generated content; paid-service prompts and responses are not used to
  improve products (logged for a limited period for abuse detection); **18+ only and apps directed at or likely
  accessed by under-18s are not allowed**; only paid services may be offered to users in the EEA, UK and Switzerland.
  Source: https://ai.google.dev/gemini-api/terms — **legal check needed** because LIMO's characters are family-friendly.

### ElevenLabs — text to speech
- `POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}` (audio file) and `/with-timestamps` (JSON with
  `audio_base64`, `alignment.characters`, `character_start_times_seconds`, `character_end_times_seconds`); header
  `xi-api-key`; body `text`, `model_id`, `language_code`, `voice_settings`, `seed`, `previous_text`, `next_text`;
  query `output_format` (default `mp3_44100_128`).
- Models with Arabic, French and German: `eleven_flash_v2_5` (32 languages, 40,000 characters/request),
  `eleven_multilingual_v2` (29 languages, 10,000), `eleven_v3`, `eleven_v4`.
- API prices: Flash/Turbo $0.04 / 1,000 characters; Multilingual v2 and v3 $0.08 / 1,000; Scribe v2 transcription $0.22 / hour.
  Sources: https://elevenlabs.io/pricing/api, https://elevenlabs.io/docs/overview/models
- Terms: commercial use only on paid plans; the user retains rights in the output; voice models only from voices the
  user is authorised to share. Source: https://elevenlabs.io/terms-of-use

### Runway — alternative for images and video
- `POST https://api.dev.runwayml.com/v1/image_to_video` and `/v1/text_to_image`; headers `Authorization: Bearer`,
  `X-Runway-Version: 2024-11-06`; image-to-video takes `promptImage`, `promptText`, `model`, `ratio`, `duration`;
  `gen4_image` takes `referenceImages` with `@tag` mentions. `gen4_turbo` ratios include `720:1280`, `1280:720`,
  `960:960`, `832:1104`. Credits $0.01; `gen4_turbo` 5 credits/s ($0.05/s), `gen4.5` 12 credits/s, `gen4_image` 5–8 credits.
  **Unverified on the research date:** allowed durations for gen4 models, task status values and output URL expiry.
  Sources: https://docs.dev.runwayml.com/guides/pricing/, https://docs.dev.runwayml.com/guides/using-the-api/,
  https://docs.dev.runwayml.com/assets/inputs/

### Supabase (storage and bandwidth of generated media)
- Pro plan $25/month incl. 100 GB storage (then $0.0213/GB), 250 GB egress (then $0.09/GB; cached $0.03/GB).
  Source: https://supabase.com/pricing

## Implementation status (Milestone 10)
Real adapters exist for every primary choice (`lib/providers/adapters/`), plus mocks. They were tested only against
mocked HTTP built from the documentation above (`tests/unit/provider-adapters.test.ts`); **none was called live**.
Alternatives (OpenAI images/text, Runway, ElevenLabs Scribe) are documented but have no adapter yet. Added for the
$10 pilot (2026-10-18): Gemini TTS (`lib/providers/adapters/gemini-tts.ts`) and a Claude safety review
(`claudeSafetyAdapter`), selected with `LIMO_VOICE_PROVIDER=google` / `LIMO_SAFETY_PROVIDER=anthropic`.

## Detail matrix (as documented on 2026-10-18; "unverified" = not stated on the pages read)
| Field | Claude (text) | Gemini Nano Banana 2.1 / 3 Pro Image | Veo 3.1 (Fast / Lite / Standard) | ElevenLabs TTS | OpenAI whisper-1 | OpenAI moderation |
|---|---|---|---|---|---|---|
| Official model ids | `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5` | `gemini-nano-banana-2.1`, `gemini-3-pro-image` | `veo-3.1-fast-generate-preview`, `veo-3.1-lite-generate-preview`, `veo-3.1-generate-preview` | `eleven_flash_v2_5`, `eleven_multilingual_v2` | `whisper-1` | `omni-moderation-latest` |
| Capabilities used | scripts, rewrites, dialogue, translation, story continuation, scene prompts, JSON schema output | generation, editing with input photos, character references | text- and image-to-video, asset references | speech with character timestamps | transcription with word timestamps | text + image moderation |
| Character reference support | n/a (identity text) | 4 (Nano Banana) / 5 (Pro) character images | up to 3 asset images (not Lite; 8 s clips) | voice id per character | n/a | n/a |
| Max duration / size | 1M context, 128K output | 1K/2K/4K images | 4, 6 or 8 s per clip | 40,000 chars/request (Flash) | 25 MB file | 20 MB per image |
| Aspect ratios / resolutions | — | 1:1, 4:5, 9:16, 16:9 (+3:4, 4:3…) | 16:9, 9:16; 720p, 1080p, 4k | — | — | — |
| Languages (ar, fr, de, en) | yes (quality to check on the LIMO test set) | prompts multilingual; text in images avoided | English fully supported, others "may vary" | yes | 98 languages (accuracy varies) | unverified |
| Asynchronous | no (sync; streaming possible) | no | yes (long-running operation + polling) | no | no | no |
| Authentication | `x-api-key` (SDK) | `x-goog-api-key` | `x-goog-api-key` (also for the download) | `xi-api-key` | `Authorization: Bearer` | `Authorization: Bearer` |
| Rate limits | per organisation tier (console) | per project in AI Studio; spend limits per 10 min by tier | same as Gemini | per plan (unverified numbers) | per tier (unverified numbers) | unverified |
| Commercial use | customer owns outputs; no training on customer content | no ownership claimed; paid tier not used for training; 18+, not for apps directed at minors | same as Gemini; SynthID watermark | paid plans only; user retains output rights | customer content per OpenAI terms (unverified on this date) | — |
| Content restrictions | Usage Policy; refusals as `stop_reason: "refusal"` | Prohibited Use Policy; safety filters | people restrictions (`allow_adult` in EU/UK/CH/MENA); blocked videos not charged | Prohibited Use Policy; voice cloning needs authorisation | Usage policies | free classifier |
| Pricing model | per token | per image (+ input tokens) | per generated second | per 1,000 characters | per minute | free |
| Est. cost per LIMO operation | $0.013–0.064 | $0.034 (1K) – $0.137 (Pro 2K) | $0.05–0.40 / s → $1.50–4.00 per 30 s video | $0.018 per 30 s narration | $0.003 per 30 s | $0 |
| Failure / retry behaviour | 429 with `retry-after`, 529 overloaded, refusals never retried | safety 400 / empty output = refused; 429/5xx retried | operation `error` or no video = failed (refusals not retried); 2-day retention → copy at once | 422 validation, 401 quota | 25 MB limit; 429/5xx retried | — |
| Integration complexity | low (official SDK) | low–medium (new Interactions API; first live test must confirm the raw response path) | medium (async, large downloads) | low | low (multipart) | low |
| Docs | platform.claude.com/docs | ai.google.dev/gemini-api/docs/image-generation | ai.google.dev/gemini-api/docs/veo | elevenlabs.io/docs | developers.openai.com/api/docs/guides/speech-to-text | developers.openai.com/api/docs/guides/moderation |
| Date verified | 2026-10-18 | 2026-10-18 | 2026-10-18 | 2026-10-18 | 2026-10-18 | 2026-10-18 |

## Pilot verification addendum (2026-10-18): accounts, billing caps, markets, failure billing
Re-checked for the $10 pilot (docs/AI_PILOT_PLAN.md) from official pages. "Unverified" = not stated on the pages read.

| | Google Gemini API | Anthropic | OpenAI | ElevenLabs |
|---|---|---|---|---|
| Available in Algeria | yes (available-regions list) | yes (supported countries) | yes (supported countries) | unverified |
| Account / minimum | billing account; **prepay is the default**, top-up min **$5**, max $5,000 | prepaid credits; **minimum purchase unverified** | pay-as-you-go wording; prepaid minimum unverified | subscription (Starter $6/month, first month $1) or pay-as-you-go |
| Hard external spend cap | prepay: requests stop at a **$0 balance** (HTTP 402); tier caps $250 / $2,000 / $20k–100k pause traffic; project spend caps exist but are **experimental, ≈ 10 min enforcement delay** | **user-set spend limit** below the tier cap is a hard stop (HTTP 400); tier caps Start $500 / Build $1,000 / Scale $200k (429 `enforced_spend_limit_reached`) | hard spend limits stop traffic at the limit; alerts are notification-only | **no documented hard cap or overage switch** (help page returned 403) |
| Credits | non-refundable, expire after 1 year | non-refundable, expire after 1 year | unverified | — |
| Failed requests | 400/500 not charged; blocked Veo videos not charged | failed requests not billed; refusals before output billed only in categories `bio`, `frontier_llm`, `reasoning_extraction`; after partial output input + output billed | unverified | unverified |
| Age / audience | 18+; not for apps directed at minors (legal check open) | per Usage Policy | per terms | commercial use needs a paid plan |

Model status checked on the models pages: `gemini-nano-banana-2.1` (new, stable), `gemini-3-pro-image` (stable),
`gemini-3.1-flash-image`, `gemini-3.1-flash-lite-image`; Veo `veo-3.1-generate-preview` and
`veo-3.1-lite-generate-preview` are on the models page, **`veo-3.1-fast-generate-preview` appears only on the Veo and
pricing pages** (confirm at the first live call). Gemini TTS `gemini-3.8-flash-tts` (new, stable): Interactions API,
`input: [{type:"user_input", content:[{type:"text"}]}]`, `response_format {type:"audio"}`,
`generation_config.speech_config: [{voice}]`; 24 kHz mono 16-bit audio, 30 voices, French/German/Arabic supported,
**no timestamps** (LIMO estimates subtitle timing and flags it); $0.50 / 1M input + $9 / 1M audio-output tokens until
2026-12-31, then $1 / $18 (the price sheet carries this end date and blocks after it). Audio-token rate per second of
speech: **unverified** (LIMO reserves 32 tokens/s × 1.5 and bills the reported usage).

Corrections to the Milestone 10 assumptions: the pilot uses Claude (not OpenAI moderation) for safety and Gemini TTS
(not ElevenLabs) for voice, so that only two accounts with hard caps are involved; ElevenLabs stays the production
voice candidate only after its overage controls are confirmed. The 2048 × 2730 character sheets need the **4K** Pro
image tier ($0.24), not 2K ($0.134), unless a 2K 3:4 output proves large enough (unverified).

Sources: ai.google.dev/gemini-api/docs/{pricing, billing, available-regions, models, veo, speech-generation};
platform.claude.com/docs/en/about-claude/pricing and the platform.claude.com rate-limit and refusal pages;
anthropic.com/supported-countries; support.claude.com/en/articles/8977456;
developers.openai.com/api/docs/{supported-countries, pricing, guides/production-best-practices}; elevenlabs.io/pricing/api.
