import { nextSlot, utcToZoned } from './schedule.ts';
import type { BusinessType, ComposeInput, ComposeResult, MediaCandidate, PostDraftProposal, PostFacts, PostLanguage, PostTone } from './types.ts';

/**
 * Mock AI Facebook composer (deterministic, free, no network). It writes ONLY from the customer's own
 * words and the facts they typed. When the request asks for something it does not know (a price, a
 * discount, availability, a review…) it leaves a visible [placeholder] that blocks approval.
 * Results are labelled "Mock AI"; a real language model replaces this adapter in Milestone 10.
 */
export const MOCK_COMPOSER_LABEL = 'Mock AI — template draft, not a language model';

type Need = keyof PostFacts | 'testimonial';
const NEEDS: Array<[Need, RegExp]> = [
  ['price', /\b(price|prices|cost|costs|priced)\b|\bprix\b|\btarifs?\b|سعر|أسعار|ثمن|\bpreis(e)?\b/i],
  ['offer', /\b(discount|offer|promo|promotion|sale|deal)\b|%|\b(réduction|remise|soldes?|offre|promo)\b|خصم|تخفيض|عرض خاص|\b(rabatt|angebot|aktion)\b/i],
  ['availability', /\b(available|availability|in stock|limited)\b|\b(disponible|disponibilité|en stock)\b|متوفر|متاح|\b(verfügbar|vorrätig|begrenzt)\b/i],
  ['location', /\b(address|location|where to find)\b|\b(adresse|où nous trouver)\b|العنوان|موقعنا|\b(adresse|standort)\b/i],
  ['hours', /\b(opening hours|open from|hours)\b|\b(horaires|ouvert de)\b|ساعات العمل|أوقات العمل|\b(öffnungszeiten|geöffnet)\b/i],
  ['testimonial', /\b(review|reviews|testimonial|testimonials|customers say|rated)\b|\b(avis clients?|témoignages?)\b|آراء العملاء|تقييمات|\b(bewertungen?|kundenstimmen)\b/i],
];

const T: Record<PostLanguage, {
  tone: Record<PostTone, string>;
  question: string;
  facts: Record<'price' | 'offer' | 'availability' | 'location' | 'hours' | 'link', string>;
  missing: Record<Need, string>;
  cta: Record<BusinessType, string>;
  new: string;
}> = {
  en: {
    tone: { friendly: 'Say hello to', professional: 'Introducing', playful: 'Guess what’s here:', premium: 'Discover', energetic: 'It’s here:', calm: 'Take a moment for' },
    question: 'Have you tried {s} yet?',
    facts: { price: 'Price: {v}', offer: 'Offer: {v}', availability: 'Availability: {v}', location: 'Where: {v}', hours: 'Hours: {v}', link: 'More: {v}' },
    missing: { business_name: '[Business name]', product_name: '[Product name]', price: '[Price]', offer: '[Offer details]', availability: '[Availability]', location: '[Address]', hours: '[Opening hours]', link: '[Link]', testimonial: '[Paste a real customer review]' },
    cta: { restaurant: 'Order now', retail: 'Shop now', services: 'Book now', agency: 'Get in touch', education: 'Sign up today', creator: 'Follow for more', storytelling: 'Read the full story', other: 'Learn more' },
    new: 'new',
  },
  fr: {
    tone: { friendly: 'Dites bonjour à', professional: 'Nous présentons', playful: 'Devinez qui arrive :', premium: 'Découvrez', energetic: 'C’est là :', calm: 'Prenez un moment pour' },
    question: 'Avez-vous déjà essayé {s} ?',
    facts: { price: 'Prix : {v}', offer: 'Offre : {v}', availability: 'Disponibilité : {v}', location: 'Où : {v}', hours: 'Horaires : {v}', link: 'Plus d’infos : {v}' },
    missing: { business_name: '[Nom de l’entreprise]', product_name: '[Nom du produit]', price: '[Prix]', offer: '[Détails de l’offre]', availability: '[Disponibilité]', location: '[Adresse]', hours: '[Horaires]', link: '[Lien]', testimonial: '[Collez un vrai avis client]' },
    cta: { restaurant: 'Commandez maintenant', retail: 'Achetez maintenant', services: 'Réservez', agency: 'Contactez-nous', education: 'Inscrivez-vous', creator: 'Suivez-nous', storytelling: 'Lisez l’histoire', other: 'En savoir plus' },
    new: 'nouveau',
  },
  ar: {
    tone: { friendly: 'رحّبوا معنا بـ', professional: 'نقدّم لكم', playful: 'خمّنوا ما الجديد:', premium: 'اكتشفوا', energetic: 'وصل أخيراً:', calm: 'خذوا لحظة مع' },
    question: 'هل جربتم {s}؟',
    facts: { price: 'السعر: {v}', offer: 'العرض: {v}', availability: 'التوفر: {v}', location: 'العنوان: {v}', hours: 'ساعات العمل: {v}', link: 'للمزيد: {v}' },
    missing: { business_name: '[اسم النشاط]', product_name: '[اسم المنتج]', price: '[السعر]', offer: '[تفاصيل العرض]', availability: '[التوفر]', location: '[العنوان]', hours: '[ساعات العمل]', link: '[الرابط]', testimonial: '[الصق رأي عميل حقيقي]' },
    cta: { restaurant: 'اطلبوا الآن', retail: 'تسوقوا الآن', services: 'احجزوا الآن', agency: 'تواصلوا معنا', education: 'سجّلوا اليوم', creator: 'تابعونا', storytelling: 'اقرؤوا القصة كاملة', other: 'اعرفوا المزيد' },
    new: 'جديد',
  },
  de: {
    tone: { friendly: 'Sag hallo zu', professional: 'Wir präsentieren', playful: 'Rate mal, was da ist:', premium: 'Entdecke', energetic: 'Endlich da:', calm: 'Nimm dir einen Moment für' },
    question: 'Hast du {s} schon probiert?',
    facts: { price: 'Preis: {v}', offer: 'Angebot: {v}', availability: 'Verfügbarkeit: {v}', location: 'Wo: {v}', hours: 'Öffnungszeiten: {v}', link: 'Mehr: {v}' },
    missing: { business_name: '[Name des Geschäfts]', product_name: '[Produktname]', price: '[Preis]', offer: '[Angebotsdetails]', availability: '[Verfügbarkeit]', location: '[Adresse]', hours: '[Öffnungszeiten]', link: '[Link]', testimonial: '[Echte Kundenbewertung einfügen]' },
    cta: { restaurant: 'Jetzt bestellen', retail: 'Jetzt shoppen', services: 'Jetzt buchen', agency: 'Kontakt aufnehmen', education: 'Jetzt anmelden', creator: 'Folge uns', storytelling: 'Ganze Geschichte lesen', other: 'Mehr erfahren' },
    new: 'neu',
  },
};

/** Best-time heuristic per business type (local time); the customer can always change it. */
const BEST_TIME: Record<BusinessType, { times: string[]; reason: string }> = {
  restaurant: { times: ['11:30', '18:00'], reason: 'before lunch and dinner' },
  retail: { times: ['12:30', '19:30'], reason: 'lunch break and evening browsing' },
  services: { times: ['09:00', '17:30'], reason: 'start and end of the working day' },
  agency: { times: ['10:00', '14:00'], reason: 'working hours' },
  education: { times: ['17:00', '20:00'], reason: 'after school and work' },
  creator: { times: ['19:00', '21:00'], reason: 'evening scrolling' },
  storytelling: { times: ['20:00'], reason: 'evening reading' },
  other: { times: ['12:00', '18:00'], reason: 'midday and early evening' },
};

const INTRO = /^(please\s+)?(create|write|make|prepare)\s+(a|an|me a)?\s*(facebook\s+)?(post|ad|caption)\s+(promoting|about|for|announcing|advertising|presenting)\s+/i;
const INTRO_FR = /^(crée|créez|écris|écrivez|rédige|rédigez)\s+(une|un)\s+(publication|post|annonce)\s+(facebook\s+)?(pour|sur|qui présente|annonçant)\s+/i;
const INTRO_AR = /^(أنشئ|اكتب|حضّر|حضر)\s+(منشور(اً|ا)?|إعلان(اً|ا)?)\s+(على\s+)?(فيسبوك\s+)?(للترويج\s+ل(?=\S)|للترويج\s+|يروج\s+ل(?=\S)|عن\s+|حول\s+|لـ\s*)/;
const INTRO_DE = /^(erstelle|schreibe|mach)\s+(einen|eine)\s+(facebook-?)?(beitrag|post|anzeige)\s+(über|für|zu)\s+/i;

/** The customer's own words for "what the post is about" (never invented). */
export function subjectFrom(input: Pick<ComposeInput, 'prompt' | 'facts'>): string {
  if (input.facts.product_name.trim()) return input.facts.product_name.trim();
  const first = (input.prompt.trim().split(/(?<=[.!?؟])\s+|[,،;]\s+(?:using|with|avec|mit|باستخدام)\b/i)[0] ?? '').trim();
  let cleaned = first.replace(INTRO, '').replace(INTRO_FR, '').replace(INTRO_AR, '').replace(INTRO_DE, '').replace(/[.!?؟]+$/, '').trim();
  // "… with the price / a discount / reviews / a friendly tone / a call to action" describes the post, not the subject.
  const tail = /\s+(with|including|avec|mit|inklusive|مع)\s+(?=[^]*?(price|prix|preis|سعر|discount|offer|promo|réduction|rabatt|عرض|خصم|review|avis|bewertung|آراء|tone|ton|ton|أسلوب|call to action|appel|handlungsaufforderung|دعوة|brand|marque|marke|علامة))/i;
  const cut = cleaned.search(tail);
  if (cut > 0) cleaned = cleaned.slice(0, cut).trim();
  return (cleaned || input.facts.business_name.trim() || '').slice(0, 120);
}

/** Which facts the request needs that the customer did not provide. */
export function missingFacts(input: Pick<ComposeInput, 'prompt' | 'facts'>): Need[] {
  return NEEDS.filter(([key, re]) => re.test(input.prompt) && (key === 'testimonial' || !input.facts[key].trim())).map(([key]) => key);
}

const fill = (s: string, v: Record<string, string>) => s.replace(/\{(\w+)\}/g, (_, k: string) => v[k] ?? '');

const STOP = new Set(['with', 'this', 'that', 'your', 'from', 'about', 'avec', 'pour', 'dans', 'notre', 'votre', 'nouveau', 'nouvelle', 'mit', 'unser', 'unsere', 'neue', 'neuen', 'über', 'لـ', 'على', 'الجديدة', 'الجديد']);

export function hashtagsFrom(subject: string, input: Pick<ComposeInput, 'brand' | 'business_type'>): string[] {
  const words = subject.normalize('NFKC').split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 3 && !STOP.has(w.toLowerCase())).slice(0, 3);
  const brand = input.brand.name.replace(/[^\p{L}\p{N}_]/gu, '');
  const out = [...words, brand, input.business_type === 'other' ? '' : input.business_type].filter(Boolean);
  return [...new Set(out.map((w) => w.toLowerCase()))].slice(0, 5);
}

function factLines(input: ComposeInput, missing: Need[]): string[] {
  const L = T[input.language];
  const lines: string[] = [];
  for (const key of ['price', 'offer', 'availability', 'location', 'hours', 'link'] as const) {
    const v = input.facts[key].trim();
    if (v) lines.push(fill(L.facts[key], { v }));
    else if (missing.includes(key)) lines.push(fill(L.facts[key], { v: L.missing[key] }));
  }
  if (missing.includes('testimonial')) lines.push(`“${L.missing.testimonial}”`);
  return lines;
}

export function suggestMedia(media: MediaCandidate[], business: BusinessType): MediaCandidate | null {
  const approved = media.filter((m) => m.approved).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const preferVideo = business === 'creator' || business === 'storytelling';
  return approved.find((m) => (m.kind === 'video') === preferVideo) ?? approved[0] ?? null;
}

export function suggestTime(business: BusinessType, timezone: string, now: Date) {
  const plan = BEST_TIME[business];
  // At least one hour from now, any day of the week.
  const at = nextSlot([0, 1, 2, 3, 4, 5, 6], plan.times, timezone, new Date(now.getTime() + 3_600_000))!;
  return { local: utcToZoned(at, timezone), timezone, iso: at.toISOString(), reason: plan.reason };
}

export function composePost(input: ComposeInput): ComposeResult {
  const L = T[input.language];
  const missing = missingFacts(input);
  const subject = subjectFrom(input) || L.missing.product_name;
  const brand = input.brand.name.trim() || input.facts.business_name.trim();
  const cta = input.brand.cta.trim() || L.cta[input.business_type];
  const facts = factLines(input, missing);
  const hashtags = hashtagsFrom(subject, input);
  const headline = brand ? `${brand} · ${subject}` : subject;
  const intro = `${L.tone[input.tone]} ${subject}.`;
  const proposals: PostDraftProposal[] = [
    { variant: 'standard', headline, caption: [intro, facts.join('\n')].filter(Boolean).join('\n\n'), hashtags, cta },
    { variant: 'short', headline: subject, caption: [intro, facts.slice(0, 2).join(' · ')].filter(Boolean).join(' '), hashtags: hashtags.slice(0, 3), cta },
    { variant: 'question', headline, caption: [fill(L.question, { s: subject }), facts.join('\n')].filter(Boolean).join('\n\n'), hashtags, cta },
  ];
  return {
    provider: 'mock',
    label: MOCK_COMPOSER_LABEL,
    proposals,
    missing_facts: missing,
    suggested_media: suggestMedia(input.media, input.business_type),
    suggested_time: suggestTime(input.business_type, input.timezone, input.now),
  };
}

/** Facts from a Universal Creation brief (product ad / business promo / social post projects). */
export function factsFromBrief(brief: Record<string, unknown>): Partial<PostFacts> {
  const s = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  return { product_name: s(brief.productName) || s(brief.topic), business_name: s(brief.businessName), price: s(brief.price), offer: s(brief.offer), location: s(brief.location) };
}
