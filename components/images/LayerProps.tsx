'use client';
import { useId } from 'react';
import { useI18n } from '@/lib/i18n/client';
import { cropFromZoom } from '@/lib/images/doc';
import { FONTS, type Background, type ImageLayer, type Layer, type ShapeLayer, type TextLayer } from '@/lib/images/types';
import { Icon } from '@/components/ui/Icon';

type Patch = (patch: Partial<Layer>) => void;

function Num({ label, value, onChange, min, max, step = 1, disabled }: { label: string; value: number; onChange: (v: number) => void; min: number; max: number; step?: number; disabled?: boolean }) {
  const id = useId();
  return (
    <div className="field prop-num">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="input input-sm ltr"
        type="number"
        inputMode="decimal"
        value={Number.isInteger(value) ? value : Number(value.toFixed(2))}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (e.target.value !== '' && Number.isFinite(v)) onChange(Math.min(max, Math.max(min, v)));
        }}
      />
    </div>
  );
}

function Color({ label, value, onChange, disabled }: { label: string; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const id = useId();
  return (
    <div className="field prop-color">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <span className="color-input">
        <input id={id} type="color" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
        <span className="mono xsmall">{value}</span>
      </span>
    </div>
  );
}

function Select<T extends string | number>({ label, value, options, onChange, disabled }: { label: string; value: T; options: Array<{ value: T; label: string }>; onChange: (v: T) => void; disabled?: boolean }) {
  const id = useId();
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        className="select select-sm"
        value={String(value)}
        disabled={disabled}
        onChange={(e) => {
          const o = options.find((x) => String(x.value) === e.target.value);
          if (o) onChange(o.value);
        }}
      >
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function Range({ label, value, onChange, min, max, step, disabled, display }: { label: string; value: number; onChange: (v: number) => void; min: number; max: number; step: number; disabled?: boolean; display: string }) {
  const id = useId();
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label} <small className="ltr">{display}</small>
      </label>
      <input id={id} className="range" type="range" min={min} max={max} step={step} value={value} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}

/** Properties of the selected layer. Every change applies to that layer only. */
export function LayerProps({ layer, docSize, disabled, onPatch, onReplaceImage, textRef }: { layer: Layer; docSize: { width: number; height: number }; disabled: boolean; onPatch: Patch; onReplaceImage: () => void; textRef: React.RefObject<HTMLTextAreaElement | null> }) {
  const { t } = useI18n();
  const e = t.images.editor;
  const off = disabled || layer.locked;
  const id = useId();
  return (
    <div className="stack prop-panel" data-testid="layer-props">
      {layer.locked && !disabled && (
        <p className="callout small">
          <Icon name="lock" />
          <span>{e.layerLocked}</span>
        </p>
      )}
      {layer.type === 'text' && <TextProps layer={layer} disabled={off} onPatch={onPatch} textRef={textRef} />}
      {layer.type === 'image' && <ImageProps layer={layer} disabled={off} onPatch={onPatch} onReplace={onReplaceImage} />}
      {layer.type === 'shape' && <ShapeProps layer={layer} disabled={off} onPatch={onPatch} />}
      <fieldset className="prop-group">
        <legend>{e.position}</legend>
        <div className="prop-grid">
          <Num label="X" value={layer.x} min={-docSize.width} max={docSize.width * 2} onChange={(x) => onPatch({ x })} disabled={off} />
          <Num label="Y" value={layer.y} min={-docSize.height} max={docSize.height * 2} onChange={(y) => onPatch({ y })} disabled={off} />
          <Num label={e.width} value={layer.w} min={4} max={docSize.width * 3} onChange={(w) => onPatch({ w })} disabled={off} />
          <Num label={e.height} value={layer.h} min={4} max={docSize.height * 3} onChange={(h) => onPatch({ h })} disabled={off} />
          <Num label={e.rotation} value={layer.rotation} min={-180} max={180} onChange={(rotation) => onPatch({ rotation })} disabled={off} />
          <Num label={e.opacity} value={Math.round(layer.opacity * 100)} min={0} max={100} onChange={(v) => onPatch({ opacity: v / 100 })} disabled={off} />
        </div>
        <div className="row">
          <button type="button" className="btn btn-sm" disabled={off} onClick={() => onPatch({ x: Math.round((docSize.width - layer.w) / 2) })}>
            {e.centerH}
          </button>
          <button type="button" className="btn btn-sm" disabled={off} onClick={() => onPatch({ y: Math.round((docSize.height - layer.h) / 2) })}>
            {e.centerV}
          </button>
        </div>
      </fieldset>
      <div className="field">
        <label className="field-label" htmlFor={`${id}-name`}>
          {e.layerName}
        </label>
        <input id={`${id}-name`} className="input input-sm" maxLength={80} value={layer.name} disabled={off} onChange={(ev) => onPatch({ name: ev.target.value })} dir="auto" />
      </div>
    </div>
  );
}

function TextProps({ layer, disabled, onPatch, textRef }: { layer: TextLayer; disabled: boolean; onPatch: Patch; textRef: React.RefObject<HTMLTextAreaElement | null> }) {
  const { t } = useI18n();
  const e = t.images.editor;
  const id = useId();
  const p = onPatch as (patch: Partial<TextLayer>) => void;
  return (
    <fieldset className="prop-group">
      <legend>{e.textGroup}</legend>
      <div className="field">
        <label className="field-label" htmlFor={`${id}-content`}>
          {e.content}
        </label>
        <textarea id={`${id}-content`} ref={textRef} className="textarea" rows={3} maxLength={1000} value={layer.content} disabled={disabled} onChange={(ev) => p({ content: ev.target.value })} dir="auto" data-testid="text-content" />
      </div>
      <div className="prop-grid">
        <Select label={e.font} value={layer.font} options={FONTS.map((f) => ({ value: f, label: f }))} onChange={(font) => p({ font })} disabled={disabled} />
        <Num label={e.size} value={layer.size} min={8} max={400} onChange={(size) => p({ size })} disabled={disabled} />
        <Select label={e.weight} value={layer.weight} options={([400, 700, 900] as const).map((w) => ({ value: w, label: e.weights[w] }))} onChange={(weight) => p({ weight })} disabled={disabled} />
        <Select
          label={e.align}
          value={layer.align}
          options={(['left', 'center', 'right'] as const).map((a) => ({ value: a, label: e.aligns[a] }))}
          onChange={(align) => p({ align })}
          disabled={disabled}
        />
        <Color label={e.color} value={layer.color} onChange={(color) => p({ color })} disabled={disabled} />
        <Num label={e.lineHeight} value={layer.line_height} min={0.8} max={3} step={0.05} onChange={(line_height) => p({ line_height })} disabled={disabled} />
      </div>
      <label className="checkbox">
        <input type="checkbox" checked={layer.italic} disabled={disabled} onChange={(ev) => p({ italic: ev.target.checked })} />
        <span>{e.italic}</span>
      </label>
      <label className="checkbox">
        <input type="checkbox" checked={layer.background !== null} disabled={disabled} onChange={(ev) => p({ background: ev.target.checked ? '#7157ef' : null, padding: ev.target.checked && layer.padding === 0 ? 24 : layer.padding })} />
        <span>{e.textBg}</span>
      </label>
      {layer.background !== null && (
        <div className="prop-grid">
          <Color label={e.bgColor} value={layer.background} onChange={(background) => p({ background })} disabled={disabled} />
          <Num label={e.padding} value={layer.padding} min={0} max={200} onChange={(padding) => p({ padding })} disabled={disabled} />
          <Num label={e.radius} value={layer.radius} min={0} max={500} onChange={(radius) => p({ radius })} disabled={disabled} />
        </div>
      )}
    </fieldset>
  );
}

function ImageProps({ layer, disabled, onPatch, onReplace }: { layer: ImageLayer; disabled: boolean; onPatch: Patch; onReplace: () => void }) {
  const { t } = useI18n();
  const e = t.images.editor;
  const p = onPatch as (patch: Partial<ImageLayer>) => void;
  const c = layer.crop;
  const zoom = c ? 1 / c.w : 1;
  const fx = c ? c.x + c.w / 2 : 0.5;
  const fy = c ? c.y + c.h / 2 : 0.5;
  return (
    <fieldset className="prop-group">
      <legend>{e.imageGroup}</legend>
      <p className="xsmall muted">{e.originalKept}</p>
      <Select
        label={e.fit}
        value={layer.fit}
        options={[
          { value: 'contain', label: e.contain },
          { value: 'cover', label: e.cover },
        ]}
        onChange={(fit) => p({ fit })}
        disabled={disabled}
      />
      <Range label={e.zoom} value={zoom} min={1} max={4} step={0.05} display={`${zoom.toFixed(2)}×`} onChange={(z) => p({ crop: cropFromZoom(z, fx, fy) })} disabled={disabled} />
      <Range label={e.focusX} value={fx} min={0} max={1} step={0.01} display={`${Math.round(fx * 100)}%`} onChange={(x) => p({ crop: cropFromZoom(zoom, x, fy) })} disabled={disabled || zoom <= 1} />
      <Range label={e.focusY} value={fy} min={0} max={1} step={0.01} display={`${Math.round(fy * 100)}%`} onChange={(y) => p({ crop: cropFromZoom(zoom, fx, y) })} disabled={disabled || zoom <= 1} />
      <div className="prop-grid">
        <Num label={e.radius} value={layer.radius} min={0} max={2000} onChange={(radius) => p({ radius })} disabled={disabled} />
        <Select
          label={e.role}
          value={layer.role}
          options={(['product', 'logo', 'photo', 'reference'] as const).map((r) => ({ value: r, label: e.roles[r] }))}
          onChange={(role) => p({ role })}
          disabled={disabled}
        />
      </div>
      <div className="row">
        <button type="button" className="btn btn-sm" disabled={disabled} onClick={onReplace}>
          <Icon name="image" />
          {e.replaceImage}
        </button>
        <button type="button" className="btn btn-sm btn-ghost" disabled={disabled || !layer.crop} onClick={() => p({ crop: null })}>
          {e.resetCrop}
        </button>
      </div>
    </fieldset>
  );
}

function ShapeProps({ layer, disabled, onPatch }: { layer: ShapeLayer; disabled: boolean; onPatch: Patch }) {
  const { t } = useI18n();
  const e = t.images.editor;
  const p = onPatch as (patch: Partial<ShapeLayer>) => void;
  return (
    <fieldset className="prop-group">
      <legend>{e.shapeGroup}</legend>
      <div className="prop-grid">
        <Select
          label={e.shape}
          value={layer.shape}
          options={[
            { value: 'rect', label: e.rect },
            { value: 'ellipse', label: e.ellipse },
          ]}
          onChange={(shape) => p({ shape })}
          disabled={disabled}
        />
        <Color label={e.fill} value={layer.fill} onChange={(fill) => p({ fill })} disabled={disabled} />
        {layer.shape === 'rect' && <Num label={e.radius} value={layer.radius} min={0} max={2000} onChange={(radius) => p({ radius })} disabled={disabled} />}
      </div>
    </fieldset>
  );
}

/** Canvas background: a solid colour or a two-colour gradient. */
export function BackgroundProps({ background, disabled, onChange }: { background: Background; disabled: boolean; onChange: (b: Background) => void }) {
  const { t } = useI18n();
  const e = t.images.editor;
  const solid = background.kind === 'color' ? background.color : background.from;
  return (
    <fieldset className="prop-group" data-testid="background-props">
      <legend>{e.background}</legend>
      <Select
        label={e.bgKind}
        value={background.kind}
        options={[
          { value: 'color', label: e.bgSolid },
          { value: 'gradient', label: e.bgGradient },
        ]}
        onChange={(kind) => onChange(kind === 'color' ? { kind: 'color', color: solid } : { kind: 'gradient', from: solid, to: '#211e2b', angle: 135 })}
        disabled={disabled}
      />
      {background.kind === 'color' ? (
        <Color label={e.color} value={background.color} onChange={(color) => onChange({ kind: 'color', color })} disabled={disabled} />
      ) : (
        <div className="prop-grid">
          <Color label={e.from} value={background.from} onChange={(from) => onChange({ ...background, from })} disabled={disabled} />
          <Color label={e.to} value={background.to} onChange={(to) => onChange({ ...background, to })} disabled={disabled} />
          <Num label={e.angle} value={background.angle} min={0} max={360} onChange={(angle) => onChange({ ...background, angle })} disabled={disabled} />
        </div>
      )}
    </fieldset>
  );
}
