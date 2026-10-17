import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sniffImage } from '../../lib/images/formats.ts';
import {
  addLayer, assetIds, cropFromZoom, duplicateLayer, emptyDoc, hitTest, imageGeometry, moveLayer, newImageLayer, newShapeLayer, newTextLayer,
  normalizeDoc, placeholders, removeLayer, reorderLayer, resizeLayer, setLocked, updateLayer,
} from '../../lib/images/doc.ts';
import { MOCK_LABEL, generateVariations, headlineFrom, inkOn, type MockInput } from '../../lib/images/mock.ts';
import { IMAGE_STYLES } from '../../lib/images/types.ts';
import { renderDoc, wrapText, isRtl, type Ctx2D } from '../../lib/images/render.ts';
import { facebookDraftPayload, normalizeHashtags, postMessage, validatePost } from '../../lib/images/posts.ts';
import { ASPECTS, ASPECT_SIZE, EMPTY_BRIEF, type TextLayer } from '../../lib/images/types.ts';
import { createHistory, pushHistory, undo, redo } from '../../lib/studio/history.ts';

const PHOTO = '11111111-2222-4333-8444-555555555555';
const LOGO = '66666666-7777-4888-8999-aaaaaaaaaaaa';

test('format sniffing: PNG, JPEG and WebP headers give format and size', () => {
  const png = new Uint8Array(24);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0x04, 0x38, 0, 0, 0x05, 0x46]);
  assert.deepEqual(sniffImage(png), { format: 'png', width: 1080, height: 1350 });
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 17, 8, 0x07, 0x80, 0x04, 0x38, 3, 0, 0]);
  assert.deepEqual(sniffImage(jpeg), { format: 'jpeg', width: 1080, height: 1920 });
  const webpX = new Uint8Array(30);
  webpX.set([...'RIFF'].map((c) => c.charCodeAt(0)), 0);
  webpX.set([...'WEBPVP8X'].map((c) => c.charCodeAt(0)), 8);
  webpX.set([0x7f, 0x07, 0x00], 24); // 1920 - 1
  webpX.set([0x37, 0x04, 0x00], 27); // 1080 - 1
  assert.deepEqual(sniffImage(webpX), { format: 'webp', width: 1920, height: 1080 });
  assert.equal(sniffImage(new TextEncoder().encode('<svg>not an image</svg>')), null);
});

test('documents: normalisation drops invalid layers and keeps the aspect size', () => {
  const doc = normalizeDoc(
    { width: 1, height: 1, background: { kind: 'gradient', from: '#123456', to: 'red' }, layers: [{ type: 'image', asset_id: 'not-a-uuid' }, { type: 'text', content: 'Hi', font: 'Comic Sans', color: 'blue' }, { type: 'video' }, { type: 'image', asset_id: PHOTO, fit: 'contain' }] },
    '4:5',
  );
  assert.equal(doc.width, 1080);
  assert.equal(doc.height, 1350);
  assert.deepEqual(doc.background, { kind: 'gradient', from: '#123456', to: '#927dff', angle: 135 });
  assert.deepEqual(doc.layers.map((l) => l.type), ['text', 'image']);
  assert.equal((doc.layers[0] as TextLayer).font, 'Arial');
  assert.deepEqual(assetIds(doc), [PHOTO]);
  for (const a of ASPECTS) assert.deepEqual([emptyDoc(a).width, emptyDoc(a).height], [ASPECT_SIZE[a].width, ASPECT_SIZE[a].height]);
});

test('editing changes only the selected layer; locked layers are protected; undo/redo walk edits', () => {
  let doc = emptyDoc('1:1');
  const head = newTextLayer(doc, { content: 'Fresh juice', role: 'headline' });
  const box = newShapeLayer(doc);
  doc = addLayer(addLayer(doc, box), head);
  let h = createHistory(doc);
  const edit = (next: typeof doc) => (h = pushHistory(h, next, Date.now(), false));
  edit(updateLayer(h.present, head.id, { content: 'Fresh orange juice', color: '#ff0000' }));
  edit(moveLayer(h.present, head.id, 30, -10));
  edit(resizeLayer(h.present, head.id, 500, 120));
  const t = h.present.layers.find((l) => l.id === head.id) as TextLayer;
  assert.deepEqual([t.content, t.color, t.x - head.x, t.y - head.y, t.w, t.h], ['Fresh orange juice', '#ff0000', 30, -10, 500, 120]);
  assert.deepEqual(h.present.layers.find((l) => l.id === box.id), box, 'other layers untouched');
  h = undo(h);
  assert.equal((h.present.layers.find((l) => l.id === head.id) as TextLayer).w, head.w);
  h = redo(h);
  assert.equal((h.present.layers.find((l) => l.id === head.id) as TextLayer).w, 500);
  const locked = setLocked(h.present, box.id, true);
  assert.equal(updateLayer(locked, box.id, { x: 0 }).layers.find((l) => l.id === box.id)!.x, box.x, 'locked layers do not move');
  assert.equal(removeLayer(locked, box.id).layers.length, 2, 'locked layers are not deleted');
  const dup = duplicateLayer(h.present, head.id);
  assert.equal(dup.layers.length, 3);
  const re = reorderLayer(h.present, head.id, -1);
  assert.equal(re.layers[0]!.id, head.id);
  assert.equal(hitTest(h.present, t.x + 5, t.y + 5)?.id, head.id);
});

test('image fit and crop geometry', () => {
  const g = imageGeometry({ x: 0, y: 0, w: 100, h: 100, fit: 'cover', crop: null }, { width: 200, height: 100 });
  assert.deepEqual([g.sx, g.sw, g.sh, g.dw, g.dh], [50, 100, 100, 100, 100]);
  const c = imageGeometry({ x: 0, y: 0, w: 100, h: 100, fit: 'contain', crop: null }, { width: 200, height: 100 });
  assert.deepEqual([c.dy, c.dw, c.dh], [25, 100, 50]);
  assert.equal(cropFromZoom(1, 0.5, 0.5), null);
  assert.deepEqual(cropFromZoom(2, 0.9, 0.1), { x: 0.5, y: 0, w: 0.5, h: 0.5 });
});

const base: MockInput = {
  purpose: 'product_ad', aspect: '4:5', style: 'modern', prompt: 'Cold-pressed orange juice for summer.',
  brief: { ...EMPTY_BRIEF, product_name: 'Sunny Juice', price: '350 DA', cta: 'Order today' }, photos: [PHOTO], logo: LOGO,
  brand: { primary: '#7157ef', secondary: '#211e2b', name: 'Sunny', cta: '' },
};

test('mock layouts: four labelled variations built only from the customer’s photo and text', () => {
  const vs = generateVariations(base);
  assert.equal(vs.length, 4);
  for (const v of vs) {
    assert.equal(v.meta.label, MOCK_LABEL);
    assert.equal(v.meta.generator, 'mock-layout-v1');
    assert.deepEqual([v.width, v.height], [1080, 1350]);
    const texts = v.layers.filter((l): l is TextLayer => l.type === 'text').map((l) => l.content);
    for (const t of texts) assert.ok(['Sunny Juice', '350 DA', 'Order today'].includes(t), `invented text: ${t}`);
    assert.ok(assetIds(v).includes(PHOTO) && assetIds(v).includes(LOGO));
    assert.equal(placeholders(v).length, 0);
  }
  // No photo for a product ad: a visible placeholder that blocks approval, not an invented image.
  const noPhoto = generateVariations({ ...base, photos: [] })[0]!;
  assert.deepEqual(placeholders(noPhoto).map((l) => l.content), ['[Add a product photo]']);
  assert.equal(headlineFrom({ brief: EMPTY_BRIEF, prompt: '' }), '[Headline]');
  assert.equal(headlineFrom({ brief: EMPTY_BRIEF, prompt: 'Our new bakery opens. Come by!' }), 'Our new bakery opens.');
});

test('mock layouts: price and button labels are readable in every style (never white on white)', () => {
  for (const style of IMAGE_STYLES) {
    for (const primary of ['#7157ef', '#ffd84d', '#ffffff']) {
      for (const v of generateVariations({ ...base, style, brand: { ...base.brand, primary } })) {
        for (const l of v.layers) {
          if (l.type === 'text' && l.background) assert.notEqual(l.color.toLowerCase(), l.background.toLowerCase(), `${style}/${primary}: ${l.role} text matches its background`);
          if (l.type === 'text' && l.background && inkOn(l.background) === '#1d1a24') assert.notEqual(l.color, '#ffffff', `${style}/${primary}: white ${l.role} text on a light fill`);
        }
      }
    }
  }
});

test('story illustrations keep character identity and mark their artwork as pending', () => {
  const v = generateVariations({ ...base, purpose: 'story_illustration', photos: [], logo: null, brief: { ...EMPTY_BRIEF, headline: 'Market day' }, characters: [{ ref: 'limo_boy', name: 'Limo', identity: 'LIMO young boy…', reference_status: 'pending' }] })[0]!;
  assert.equal(v.meta.characters?.[0]?.ref, 'limo_boy');
  assert.ok(placeholders(v).some((l) => l.content === '[Character artwork pending: Limo]'));
});

test('renderer: background first, layers bottom to top, hidden layers skipped, RTL text', () => {
  const calls: string[] = [];
  const ctx = new Proxy({} as Ctx2D & Record<string, unknown>, {
    get(t, k: string) {
      if (k === 'measureText') return (s: string) => ({ width: s.length * 10 });
      if (k === 'createLinearGradient') return () => ({ addColorStop() {} });
      if (k in t) return t[k];
      return (...a: unknown[]) => calls.push(`${k}:${a[0] ?? ''}`);
    },
    set(t, k: string, v) {
      t[k] = v;
      return true;
    },
  });
  let doc = emptyDoc('1:1');
  doc = addLayer(doc, newImageLayer(doc, PHOTO));
  doc = addLayer(doc, newTextLayer(doc, { content: 'مرحبا بكم', w: 400 }));
  doc = addLayer(doc, { ...newTextLayer(doc, { content: 'hidden' }), visible: false });
  renderDoc(ctx, doc, new Map([[PHOTO, { source: 'img', width: 10, height: 10 }]]));
  const bg = calls.findIndex((c) => c.startsWith('fillRect'));
  assert.ok(bg >= 0 && calls.slice(0, bg).every((c) => !c.startsWith('drawImage') && !c.startsWith('fillText')), 'background first');
  const draw = calls.findIndex((c) => c.startsWith('drawImage'));
  const txt = calls.findIndex((c) => c.startsWith('fillText:مرحبا'));
  assert.ok(draw > 0 && txt > draw, 'image under text');
  assert.ok(!calls.some((c) => c.includes('hidden')));
  assert.equal(ctx.direction, 'rtl');
  assert.ok(isRtl('مرحبا') && !isRtl('Hello'));
  assert.deepEqual(wrapText({ measureText: (s: string) => ({ width: s.length * 10 }) }, 'one two three four', 90), ['one two', 'three', 'four']);
});

test('social posts: hashtags, validation and the prepared (unpublished) Facebook payload', () => {
  assert.deepEqual(normalizeHashtags('#Summer, summer #juice!! #عصير'), ['Summer', 'juice', 'عصير']);
  assert.deepEqual(validatePost({ caption: ' ', media_asset_id: null, image_status: null }), ['caption_required', 'image_required']);
  assert.deepEqual(validatePost({ caption: 'Hi', media_asset_id: PHOTO, image_status: 'draft' }), ['image_not_approved']);
  assert.deepEqual(validatePost({ caption: 'Hi', media_asset_id: PHOTO, image_status: 'approved' }), []);
  assert.equal(postMessage('New juice!', ['summer', 'juice']), 'New juice!\n\n#summer #juice');
  const p = facebookDraftPayload({ id: 'p1', caption: 'New juice!', hashtags: ['summer'], media_asset_id: PHOTO });
  assert.equal(p.published, false);
  assert.deepEqual(p.media, [{ asset_id: PHOTO, type: 'image' }]);
});
