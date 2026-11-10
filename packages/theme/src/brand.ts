// Brand themes: a small spec (1–2 brand colours, font, corners, title block) becomes a full Theme.
// Everything not given is derived, and every text/background pair is checked against WCAG AA.
import { tones as toneSlots, type Tone } from '@cartography/core';
import { contrast, ensureContrast, fromHsl, hex, isColor, isDark, mix, parseColor, toHsl } from './color.ts';
import { bundledFamilies, bundledFamily } from './fonts.ts';
import { classic, type PptxLook, type EdgeLabelLook, type FontFace, type GroupLook, type LegendPosition, type LineLook, type MonoRole, type SheetLook, type SketchLook, type Theme, type TileStyle, type TitleBlock, type TitleLook, type ToneColors } from './tokens.ts';

type FontFiles = string[] | Record<string, string>;
const RADIUS_KEYS = ['card', 'group', 'tile', 'chip', 'corner'] as const;

type ToneSpec = string | { slot?: string; color?: string; fg?: string; bg?: string; wash?: string; line?: string };

/** What a `*.theme.yaml` file (or a diagram's `theme:` block) holds, after parsing. */
export interface ThemeSpec {
  name?: string;
  extends?: string;
  colors?: { primary?: string; accent?: string; canvas?: string; surface?: string; border?: string; text?: string; muted?: string; faint?: string; edge?: string };
  /** Slot (blue, teal…) → colour, or a brand name → { slot, color }. */
  tones?: Record<string, ToneSpec>;
  font?: {
    family?: string;
    files?: FontFiles;
    scale?: number;
    /** The monospace face: a bundled or installed family, or { family, files }. */
    mono?: { family?: string; files?: FontFiles };
    /** Which text is set in the monospace face. */
    monoFor?: MonoRole[];
  };
  radius?: number | 'sharp' | 'soft' | 'round' | Partial<Record<(typeof RADIUS_KEYS)[number], number>>;
  lineWeight?: number;
  /** Shadow strength: 0 for a flat, print-friendly look; 1 is the default. */
  shadow?: number;
  tile?: TileStyle;
  iconSize?: number;
  cardBar?: boolean;
  titleBlock?: Omit<TitleBlock, 'logo'> & { logo?: string };
  /** `pptx: template.potx`, or { template, layout, keepLook }: decks are made in that PowerPoint template. */
  pptx?: PptxLook;
  legend?: LegendPosition;
  legendStyle?: Theme['legendStyle'];
  group?: GroupLook;
  edgeLabel?: EdgeLabelLook['style'];
  edgeLabelInk?: EdgeLabelLook['ink'];
  edgeLabelCaps?: boolean;
  lines?: LineLook;
  sheet?: SheetLook;
  tableHead?: Theme['tableHead'];
  number?: Theme['number'];
  chip?: Theme['chip'];
  cardLine?: Theme['cardLine'];
  title?: TitleLook;
  background?: { dots?: boolean | { step?: number; r?: number; color?: string } };
  /** Drawn by hand (true, or { roughness, fill, double }); false makes a sketch theme ruled again. */
  sketch?: boolean | SketchLook;
  /** high: borders and outlines get 3:1 against what they sit on, faint text 4.5:1. */
  contrast?: 'normal' | 'high';
  /** Pull the tones nobody chose towards the brand's saturation (default true). */
  harmonize?: boolean;
}

export interface ThemeWarning {
  path: (string | number)[];
  message: string;
}

const COLOR_KEYS = ['primary', 'accent', 'canvas', 'surface', 'border', 'text', 'muted', 'faint', 'edge'] as const;
const TOP_KEYS = ['name', 'extends', 'colors', 'tones', 'font', 'radius', 'lineWeight', 'shadow', 'tile', 'iconSize', 'cardBar', 'titleBlock', 'legend', 'legendStyle', 'harmonize', 'group', 'edgeLabel', 'edgeLabelInk', 'edgeLabelCaps', 'lines', 'sheet', 'tableHead', 'number', 'chip', 'cardLine', 'title', 'background', 'sketch', 'contrast', 'pptx'];
const BLOCK_KEYS = ['logo', 'client', 'project', 'version', 'date', 'classification', 'footer', 'imprint'];
const RADIUS = { sharp: 0.35, soft: 1, round: 1.4 };
/** Every tone slot can be given. */
const MAX_TONES = toneSlots.length;
const TILES: TileStyle[] = ['soft', 'solid', 'outline', 'bare', 'disc', 'ring'];
const MONO_ROLES: MonoRole[] = ['edgeLabel', 'type', 'title'];
const GROUP_KEYS = ['tints', 'line', 'dash', 'label', 'labelSize', 'tracking', 'labelColor', 'captionColor', 'icon'];
const LINE_KEYS = ['bridge', 'junction', 'junctionSize', 'corner', 'arrow', 'arrowScale', 'dashScale'];
const SHEET_KEYS = ['marks', 'inset', 'zones', 'ticks'];
const TITLE_KEYS = ['mono', 'caps', 'size', 'weight', 'tracking'];
const DASH = /^\d+(\.\d+)?( \d+(\.\d+)?){1,5}$/;
const or = (list: readonly string[]) => (list.length > 1 ? `${list.slice(0, -1).join(', ')} or ${list.at(-1)}` : list[0]!);

/** Checks a parsed theme value and keeps what is usable; everything else becomes a warning. */
export function parseThemeSpec(v: unknown, warn: (w: ThemeWarning) => void): ThemeSpec {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return (warn({ path: [], message: 'A theme is a map: extends, colors, tones, font, titleBlock…' }), {});
  const o = v as Record<string, unknown>;
  const spec: ThemeSpec = {};
  for (const k of Object.keys(o)) if (!TOP_KEYS.includes(k)) warn({ path: [k], message: `Unknown theme key "${k}", use one of: ${TOP_KEYS.join(', ')}` });
  const str = (k: string, x: unknown) => (typeof x === 'string' || typeof x === 'number' ? String(x) : (x != null && warn({ path: [k], message: `${k} must be text` }), undefined));
  const num = (path: (string | number)[], x: unknown, lo: number, hi: number) => {
    if (x == null) return undefined;
    if (typeof x === 'number' && x >= lo && x <= hi) return x;
    warn({ path, message: `${path.join('.')} must be a number from ${lo} to ${hi}` });
    return undefined;
  };
  if (o.name != null) spec.name = str('name', o.name);
  if (o.extends != null) spec.extends = str('extends', o.extends);
  if (o.colors != null) {
    if (typeof o.colors !== 'object') warn({ path: ['colors'], message: 'colors is a map, e.g. primary: "#0B5FFF"' });
    else {
      spec.colors = {};
      for (const [k, c] of Object.entries(o.colors as object)) {
        if (!(COLOR_KEYS as readonly string[]).includes(k)) warn({ path: ['colors', k], message: `Unknown colour "${k}", use one of: ${COLOR_KEYS.join(', ')}` });
        else if (!isColor(c)) warn({ path: ['colors', k], message: `colors.${k} must be a hex colour like "#0B5FFF"` });
        else spec.colors[k as (typeof COLOR_KEYS)[number]] = c;
      }
    }
  }
  if (o.tones != null) {
    const list = typeof o.tones === 'object' && !Array.isArray(o.tones) ? Object.entries(o.tones as object) : [];
    if (!list.length) warn({ path: ['tones'], message: 'tones is a map of slot: colour, e.g. teal: "#00A3A1"' });
    if (list.length > MAX_TONES) warn({ path: ['tones'], message: `Up to ${MAX_TONES} brand tones; the rest are derived` });
    spec.tones = {};
    for (const [k, t] of list.slice(0, MAX_TONES)) {
      const slot = typeof t === 'object' && t && 'slot' in t ? String((t as { slot: unknown }).slot) : k;
      if (!(toneSlots as string[]).includes(slot)) warn({ path: ['tones', k], message: `"${slot}" is not a tone slot, use one of: ${toneSlots.join(', ')} (or name: { slot, color })` });
      else if (typeof t === 'string' ? !isColor(t) : !t || typeof t !== 'object' || !Object.entries(t).every(([kk, c]) => kk === 'slot' || isColor(c)))
        warn({ path: ['tones', k], message: 'A tone is a hex colour, or { slot, color } / { fg, bg, wash, line }' });
      else spec.tones[k] = t as ToneSpec;
    }
  }
  if (o.font != null) {
    const f = typeof o.font === 'string' ? { family: o.font } : (o.font as Record<string, unknown>);
    spec.font = {};
    if (f.family != null) spec.font.family = String(f.family);
    if (f.files != null) {
      const ok = Array.isArray(f.files) ? f.files.every((x) => typeof x === 'string') : typeof f.files === 'object' && Object.values(f.files as object).every((x) => typeof x === 'string');
      if (ok) spec.font.files = f.files as string[] | Record<string, string>;
      else warn({ path: ['font', 'files'], message: 'font.files is a list of .woff2/.ttf paths, or weight: path' });
    }
    spec.font.scale = num(['font', 'scale'], f.scale, 0.6, 1.6);
    if (f.mono != null) {
      const m = typeof f.mono === 'string' ? { family: f.mono } : (f.mono as Record<string, unknown>);
      if (!m || typeof m !== 'object' || m.family == null) warn({ path: ['font', 'mono'], message: `font.mono is a family name (bundled: ${bundledFamilies.filter((x) => /mono/i.test(x)).join(', ')}) or { family, files }` });
      else {
        spec.font.mono = { family: String(m.family) };
        const ok = m.files == null || (Array.isArray(m.files) ? m.files.every((x) => typeof x === 'string') : typeof m.files === 'object' && Object.values(m.files as object).every((x) => typeof x === 'string'));
        if (!ok) warn({ path: ['font', 'mono', 'files'], message: 'font.mono.files is a list of .woff2/.ttf paths, or weight: path' });
        else if (m.files != null) spec.font.mono.files = m.files as FontFiles;
      }
    }
    if (f.monoFor != null) {
      const list = Array.isArray(f.monoFor) ? f.monoFor.map(String) : [String(f.monoFor)];
      const bad = list.filter((x) => !(MONO_ROLES as string[]).includes(x));
      if (bad.length) warn({ path: ['font', 'monoFor'], message: `font.monoFor lists what is set in the monospace face: ${or(MONO_ROLES)}` });
      spec.font.monoFor = list.filter((x) => (MONO_ROLES as string[]).includes(x)) as MonoRole[];
    }
  }
  if (o.radius != null) {
    if (typeof o.radius === 'string' && o.radius in RADIUS) spec.radius = o.radius as keyof typeof RADIUS;
    else if (typeof o.radius === 'object' && !Array.isArray(o.radius)) {
      const r: Partial<Record<(typeof RADIUS_KEYS)[number], number>> = {};
      for (const [k, x] of Object.entries(o.radius as object)) {
        if (!(RADIUS_KEYS as readonly string[]).includes(k)) warn({ path: ['radius', k], message: `Unknown radius "${k}", use one of: ${RADIUS_KEYS.join(', ')}` });
        else {
          const n = num(['radius', k], x, 0, 40);
          if (n !== undefined) r[k as (typeof RADIUS_KEYS)[number]] = n;
        }
      }
      spec.radius = r;
    } else spec.radius = num(['radius'], o.radius, 0, 3) ?? (typeof o.radius === 'string' ? (warn({ path: ['radius'], message: 'radius is sharp, soft, round or a scale like 0.5' }), undefined) : undefined);
  }
  spec.lineWeight = num(['lineWeight'], o.lineWeight, 0.5, 3);
  spec.shadow = num(['shadow'], o.shadow === false ? 0 : o.shadow === true ? 1 : o.shadow, 0, 3);
  /** One of a fixed set of words; anything else is a warning that lists them. */
  const pick = <T extends string>(path: string[], x: unknown, options: readonly T[]): T | undefined => {
    if (x == null) return undefined;
    if ((options as readonly string[]).includes(String(x))) return String(x) as T;
    warn({ path, message: `${path.join('.')} is ${or(options)}` });
    return undefined;
  };
  const flag = (path: string[], x: unknown) => (x == null ? undefined : typeof x === 'boolean' ? x : (warn({ path, message: `${path.join('.')} is true or false` }), undefined));
  /** A map with known keys; unknown ones are named. */
  const block = (key: string, x: unknown, keys: string[]): Record<string, unknown> | undefined => {
    if (x == null) return undefined;
    if (typeof x !== 'object' || Array.isArray(x)) return warn({ path: [key], message: `${key} is a map: ${keys.join(', ')}` }), undefined;
    for (const k of Object.keys(x)) if (!keys.includes(k)) warn({ path: [key, k], message: `Unknown ${key} key "${k}", use one of: ${keys.join(', ')}` });
    return x as Record<string, unknown>;
  };
  const clean = <T extends object>(x: T): T => Object.fromEntries(Object.entries(x).filter(([, v]) => v !== undefined)) as T;

  spec.tile = pick(['tile'], o.tile, TILES);
  spec.iconSize = num(['iconSize'], o.iconSize, 10, 34);
  spec.legendStyle = pick(['legendStyle'], o.legendStyle, ['row', 'key']);
  spec.edgeLabel = pick(['edgeLabel'], o.edgeLabel, ['pill', 'halo', 'plate']);
  spec.edgeLabelInk = pick(['edgeLabelInk'], o.edgeLabelInk, ['muted', 'text', 'line']);
  spec.edgeLabelCaps = flag(['edgeLabelCaps'], o.edgeLabelCaps);
  spec.tableHead = pick(['tableHead'], o.tableHead, ['tone', 'paper', 'plain']);
  spec.number = pick(['number'], o.number, ['solid', 'ink', 'ring']);
  spec.chip = pick(['chip'], o.chip, ['fill', 'outline']);
  spec.cardLine = pick(['cardLine'], o.cardLine, ['border', 'tone']);
  spec.contrast = pick(['contrast'], o.contrast, ['normal', 'high']);
  const g = block('group', o.group, GROUP_KEYS);
  if (g) {
    const group: GroupLook = {};
    if (g.tints != null) {
      const list = Array.isArray(g.tints) ? g.tints : [g.tints];
      if (list.length < 1 || list.length > 6 || !list.every(isColor)) warn({ path: ['group', 'tints'], message: 'group.tints is a list of hex colours, one per nesting depth, e.g. ["#F8F6F1", "#F0EDE4", "#E8E4D8"]' });
      else group.tints = list as string[];
    }
    if (g.line != null) {
      if (g.line === 'none' || g.line === false || isColor(g.line)) group.line = g.line === false ? 'none' : (g.line as string);
      else warn({ path: ['group', 'line'], message: 'group.line is a hex colour, or none for groups without an outline' });
    }
    if (g.dash != null) {
      if (typeof g.dash === 'string' && DASH.test(g.dash.trim())) group.dash = g.dash.trim();
      else warn({ path: ['group', 'dash'], message: 'group.dash is a dash pattern like "4 3"' });
    }
    group.label = pick(['group', 'label'], g.label, ['plain', 'caps']);
    group.labelSize = num(['group', 'labelSize'], g.labelSize, 8, 18);
    group.tracking = num(['group', 'tracking'], g.tracking, 0, 4);
    group.labelColor = pick(['group', 'labelColor'], g.labelColor, ['tone', 'muted', 'text']);
    group.captionColor = pick(['group', 'captionColor'], g.captionColor, ['faint', 'muted']);
    group.icon = g.icon === false ? 0 : g.icon === true ? undefined : num(['group', 'icon'], g.icon, 0, 24);
    spec.group = clean(group);
  }
  const l = block('lines', o.lines, LINE_KEYS);
  if (l)
    spec.lines = clean({
      bridge: l.bridge === false ? 0 : num(['lines', 'bridge'], l.bridge, 0, 12),
      junction: pick(['lines', 'junction'], l.junction, ['dot', 'ring']),
      junctionSize: num(['lines', 'junctionSize'], l.junctionSize, 1, 10),
      corner: pick(['lines', 'corner'], l.corner, ['round', 'chamfer', 'square']),
      arrow: pick(['lines', 'arrow'], l.arrow, ['filled', 'slim', 'open']),
      arrowScale: num(['lines', 'arrowScale'], l.arrowScale, 0.5, 2.5),
      dashScale: flag(['lines', 'dashScale'], l.dashScale),
    });
  if (o.sheet != null) {
    const sh = typeof o.sheet === 'string' ? { marks: o.sheet } : block('sheet', o.sheet, SHEET_KEYS);
    if (sh) {
      const marks = pick(['sheet', 'marks'], sh.marks ?? 'corners', ['none', 'corners', 'frame']);
      if (marks) spec.sheet = clean({ marks, inset: num(['sheet', 'inset'], sh.inset, 4, 40), zones: flag(['sheet', 'zones'], sh.zones), ticks: flag(['sheet', 'ticks'], sh.ticks) });
    }
  }
  const t = block('title', o.title, TITLE_KEYS);
  if (t)
    spec.title = clean({
      mono: flag(['title', 'mono'], t.mono),
      caps: flag(['title', 'caps'], t.caps),
      size: num(['title', 'size'], t.size, 10, 40),
      weight: t.weight == null ? undefined : (Number(pick(['title', 'weight'], t.weight, ['400', '500', '600'])) as 400 | 500 | 600) || undefined,
      tracking: num(['title', 'tracking'], t.tracking, 0, 4),
    });
  const bg = block('background', o.background, ['dots']);
  if (bg && bg.dots != null) {
    if (typeof bg.dots === 'boolean') spec.background = { dots: bg.dots };
    else if (typeof bg.dots !== 'object') warn({ path: ['background', 'dots'], message: 'background.dots is true, or a map: step, r, color' });
    else {
      const d = bg.dots as Record<string, unknown>;
      for (const k of Object.keys(d)) if (!['step', 'r', 'color'].includes(k)) warn({ path: ['background', 'dots', k], message: `Unknown dots key "${k}", use one of: step, r, color` });
      if (d.color != null && !isColor(d.color)) warn({ path: ['background', 'dots', 'color'], message: 'background.dots.color must be a hex colour like "#CDD3DA"' });
      spec.background = { dots: clean({ step: num(['background', 'dots', 'step'], d.step, 6, 64), r: num(['background', 'dots', 'r'], d.r, 0.2, 3), color: isColor(d.color) ? d.color : undefined }) };
    }
  }
  if (o.sketch != null) {
    if (typeof o.sketch === 'boolean') spec.sketch = o.sketch;
    else {
      const k = block('sketch', o.sketch, ['roughness', 'fill', 'double']);
      if (k) spec.sketch = clean({ roughness: num(['sketch', 'roughness'], k.roughness, 0, 3), fill: k.fill == null ? undefined : (pick(['sketch', 'fill'], k.fill, ['hachure', 'solid']) as SketchLook['fill']), double: flag(['sketch', 'double'], k.double) });
    }
  }
  if (o.cardBar != null) spec.cardBar = !!o.cardBar;
  if (o.harmonize != null) spec.harmonize = !!o.harmonize;
  if (o.legend != null) {
    if (['bottom', 'top', 'right', 'none'].includes(String(o.legend))) spec.legend = o.legend as LegendPosition;
    else warn({ path: ['legend'], message: 'legend is bottom, top, right or none' });
  }
  if (o.pptx != null) {
    const x = typeof o.pptx === 'string' ? { template: o.pptx } : block('pptx', o.pptx, ['template', 'layout', 'keepLook']);
    if (x && typeof x.template === 'string' && /\.(potx|pptx)$/i.test(x.template)) spec.pptx = clean({ template: x.template, layout: x.layout == null ? undefined : String(x.layout), keepLook: flag(['pptx', 'keepLook'], x.keepLook) });
    else warn({ path: ['pptx'], message: 'pptx is a PowerPoint template file (.potx or .pptx), or a map: template, layout, keepLook' });
  }
  if (o.titleBlock != null) {
    if (typeof o.titleBlock !== 'object') warn({ path: ['titleBlock'], message: 'titleBlock is a map: logo, client, project, version, date, classification, footer' });
    else {
      spec.titleBlock = {};
      for (const [k, x] of Object.entries(o.titleBlock as object)) {
        if (!BLOCK_KEYS.includes(k)) warn({ path: ['titleBlock', k], message: `Unknown title block field "${k}", use one of: ${BLOCK_KEYS.join(', ')}` });
        else if (k === 'imprint') spec.titleBlock.imprint = flag(['titleBlock', 'imprint'], x);
        else if (x != null) (spec.titleBlock as Record<string, string>)[k] = x instanceof Date ? x.toISOString().slice(0, 10) : String(x);
      }
    }
  }
  return clean(spec);
}

/** A spec layered on another (a diagram's `theme:` block on top of the file it extends). */
export function mergeSpecs(a: ThemeSpec, b: ThemeSpec): ThemeSpec {
  return {
    ...a,
    ...b,
    colors: { ...a.colors, ...b.colors },
    tones: { ...a.tones, ...b.tones },
    font: a.font || b.font ? { ...a.font, ...b.font } : undefined,
    titleBlock: a.titleBlock || b.titleBlock ? { ...a.titleBlock, ...b.titleBlock } : undefined,
    ...(a.group || b.group ? { group: { ...a.group, ...b.group } } : {}),
    ...(a.lines || b.lines ? { lines: { ...a.lines, ...b.lines } } : {}),
    ...(a.sheet || b.sheet ? { sheet: { ...a.sheet, ...b.sheet } as SheetLook } : {}),
    ...(a.title || b.title ? { title: { ...a.title, ...b.title } } : {}),
    ...(a.background || b.background ? { background: { ...a.background, ...b.background } } : {}),
    extends: a.extends,
  };
}

export interface DeriveExtras {
  faces?: FontFace[];
  /** Files of the monospace face, when the theme brings its own. */
  monoFaces?: FontFace[];
  logo?: TitleBlock['logo'];
}

/** The full theme: base tokens, brand colours, derived tints, contrast-checked text. */
export function deriveTheme(base: Theme, spec: ThemeSpec, extras: DeriveExtras = {}, warn: (w: ThemeWarning) => void = () => {}): Theme {
  const c = spec.colors ?? {};
  const dark = base.mode === 'dark';
  const primary = c.primary;
  const tint = (neutral: string, amount: number) => (primary ? mix(primary, neutral, amount) : neutral);
  const canvas = c.canvas ?? base.canvas;
  const surface = c.surface ?? (c.canvas ? (isDark(canvas) ? mix('#FFFFFF', canvas, 0.05) : '#FFFFFF') : base.surface);
  const mode = isDark(canvas) ? 'dark' : 'light';
  if (mode !== base.mode) warn({ path: ['colors', 'canvas'], message: `canvas ${canvas} is ${mode} but the theme extends a ${base.mode} theme; extend ${mode} instead` });
  const high = spec.contrast === 'high';

  // Group tints follow the page: on another canvas they keep their step away from it.
  const baseTints = base.group?.tints;
  const moved = (colour: string) => (c.canvas && colour !== 'none' ? shift(colour, base.canvas, canvas) : colour);
  const tints = spec.group?.tints ?? baseTints?.map(moved);
  // Text sits on cards, on the page and on every group tint; the deepest tint is the hardest.
  const grounds = [surface, canvas, ...(tints ?? [])];
  const worstOn = (colour: string) => Math.min(...grounds.map((g) => contrast(colour, g)));
  const fixOn = (colour: string, ratio: number) => grounds.reduce((x, g) => ensureContrast(x, g, ratio), colour);
  let groupLine = spec.group?.line ?? (base.group?.line ? moved(base.group.line) : undefined);
  if (high && groupLine && groupLine !== 'none') groupLine = fixOn(groupLine, 3);

  // A colour someone chose is kept unless it fails; then it is fixed and they are told.
  const readable = (key: string, chosen: string | undefined, derived: string, ratio: number, what: string) => {
    const want = chosen ?? derived;
    const worst = worstOn(want);
    if (worst >= ratio) return want;
    const fixed = fixOn(want, ratio);
    if (chosen) warn({ path: ['colors', key], message: `${what} ${chosen} has ${worst.toFixed(1)}:1 contrast on the background (needs ${ratio}:1), using ${fixed}` });
    return fixed;
  };
  const text = readable('text', c.text, tint(base.text, 0.1), 4.5, 'Text');
  const textMuted = readable('muted', c.muted, tint(base.textMuted, 0.12), 4.5, 'Muted text');
  const textFaint = readable('faint', c.faint, tint(base.textFaint, 0.12), high ? 4.5 : 3, 'Faint text');
  const edge = readable('edge', c.edge, tint(base.edge, 0.16), high ? 4.5 : 3, 'Line colour');
  const softBorder = c.border ?? (primary ? mix(primary, base.border, 0.1) : base.border);
  const border = high ? fixOn(softBorder, 3) : softBorder;
  // On a paper look every tone shares the group wash and outline: depth tells groups apart, not colour.
  const paper = tints ? { wash: tints[0]!, line: groupLine && groupLine !== 'none' ? groupLine : tints.at(-1)! } : undefined;

  // Tones: brand colours on their slots, primary on blue and accent on teal unless named otherwise.
  const chosen = new Map<Tone, { spec: ToneSpec; path: (string | number)[] }>();
  if (primary) chosen.set('blue', { spec: primary, path: ['colors', 'primary'] });
  if (c.accent) chosen.set('teal', { spec: c.accent, path: ['colors', 'accent'] });
  for (const [k, t] of Object.entries(spec.tones ?? {})) chosen.set((typeof t === 'object' && t.slot ? t.slot : k) as Tone, { spec: t, path: ['tones', k] });
  const brandSat = primary ? toHsl(primary)[1] : undefined;
  const tones = {} as Record<Tone, ToneColors>;
  for (const slot of toneSlots) {
    const pick = chosen.get(slot);
    if (pick) {
      tones[slot] = toneFrom(pick.spec, { dark, canvas, surface, paper }, (m) => warn({ path: pick.path, message: m }));
      continue;
    }
    const b = base.tones[slot];
    if (brandSat === undefined || spec.harmonize === false) {
      tones[slot] = c.canvas || c.surface ? toneFrom(b.fg, { dark, canvas, surface, paper }) : paper ? { ...b, ...paper } : b;
      continue;
    }
    // Unchosen tones keep their hue (blue stays blue) but take on the brand's saturation, so the set reads as one palette.
    const [h, s, l] = toHsl(b.fg);
    tones[slot] = toneFrom(fromHsl(h, slot === 'slate' ? s : s * 0.55 + brandSat * 0.45, l), { dark, canvas, surface, paper });
  }

  const exact = typeof spec.radius === 'object' ? spec.radius : {};
  const radius = spec.radius === undefined || typeof spec.radius === 'object' ? 1 : typeof spec.radius === 'string' ? RADIUS[spec.radius] : spec.radius;
  const scaleR = (r: number) => Math.round(r * radius * 2) / 2;
  const lw = spec.lineWeight ?? 1;
  // A bundled family is measured by its own widths; any other is the brand font, measured against Inter.
  const family = spec.font?.family;
  const ours = extras.faces?.length ? undefined : bundledFamily(family);
  const monoFamily = spec.font?.mono?.family;
  const ourMono = extras.monoFaces?.length ? undefined : bundledFamily(monoFamily);
  const faces = [...(extras.faces ?? []), ...(extras.monoFaces ?? []).map((f) => ({ ...f, mono: true }))];
  const group: GroupLook | undefined = base.group || spec.group ? { ...base.group, ...spec.group, ...(tints ? { tints } : {}), ...(groupLine ? { line: groupLine } : {}) } : undefined;
  const edgeLabel: EdgeLabelLook | undefined =
    base.edgeLabel || spec.edgeLabel || spec.edgeLabelInk || spec.edgeLabelCaps !== undefined
      ? { ...base.edgeLabel, ...(spec.edgeLabel ? { style: spec.edgeLabel } : {}), ...(spec.edgeLabelInk ? { ink: spec.edgeLabelInk } : {}), ...(spec.edgeLabelCaps !== undefined ? { caps: spec.edgeLabelCaps } : {}) }
      : undefined;
  const dots = spec.background?.dots;
  const background = dots === undefined ? base.background : dots === false ? undefined : { dots: { step: 16, r: 0.6, color: mix(border, canvas, 0.6), ...base.background?.dots, ...(dots === true ? {} : dots) } };
  const titleBlock = spec.titleBlock || extras.logo ? { ...spec.titleBlock, logo: extras.logo, date: today(spec.titleBlock?.date) } : undefined;
  const accent = c.accent ?? primary ?? base.accent;
  return {
    ...base,
    name: spec.name ?? base.name,
    mode,
    canvas,
    surface,
    border,
    text,
    textMuted,
    textFaint,
    edge,
    shadow: { color: base.shadow.color, opacity: base.shadow.opacity * (spec.shadow ?? 1) },
    tones,
    font: {
      ...base.font,
      // The fallback after a brand family is Inter: its widths are what the brand font is measured against.
      ...(family ? { family: ours && ours !== 'Inter' ? `'${ours}', ${classic.font.family}` : ours ? classic.font.family : `'${family.replace(/'/g, '')}', ${classic.font.family}`, sans: ours } : {}),
      ...(monoFamily ? { mono: `'${(ourMono ?? monoFamily).replace(/'/g, '')}', ui-monospace, 'SF Mono', Menlo, Consolas, monospace`, monoFace: ourMono } : {}),
      ...(spec.font?.monoFor ? { monoFor: spec.font.monoFor } : {}),
      ...(faces.length ? { faces } : {}),
      ...(spec.font?.scale ? { scale: spec.font.scale } : {}),
    },
    radius: {
      card: exact.card ?? scaleR(base.radius.card),
      group: exact.group ?? scaleR(base.radius.group),
      tile: exact.tile ?? scaleR(base.radius.tile),
      chip: exact.chip ?? scaleR(base.radius.chip),
      pill: base.radius.pill,
      corner: exact.corner ?? (base.radius.corner ? Math.max(2, scaleR(base.radius.corner)) : 0),
    },
    stroke: { ...base.stroke, card: base.stroke.card * Math.min(lw, 1.5), group: base.stroke.group * Math.min(lw, 1.5), edge: Math.round(base.stroke.edge * lw * 100) / 100 },
    ...(accent ? { accent: readable('accent', undefined, accent, 3, 'Accent') } : {}),
    ...(titleBlock ? { titleBlock: Object.fromEntries(Object.entries(titleBlock).filter(([, x]) => x !== undefined)) } : {}),
    ...(spec.legend ? { legend: spec.legend } : {}),
    ...(spec.tile ? { tile: spec.tile } : {}),
    // The icon size belongs to the tile style: another tile takes its own default unless a size is given too.
    ...(spec.iconSize ? { iconSize: spec.iconSize } : spec.tile && spec.tile !== base.tile ? { iconSize: undefined } : {}),
    ...(spec.cardBar !== undefined ? { cardBar: spec.cardBar } : {}),
    ...(group ? { group } : {}),
    ...(edgeLabel ? { edgeLabel } : {}),
    ...(spec.lines ? { line: { ...base.line, ...spec.lines } } : {}),
    ...(spec.legendStyle ? { legendStyle: spec.legendStyle } : {}),
    ...(spec.sheet ? { sheet: { ...base.sheet, ...spec.sheet } } : {}),
    ...(spec.tableHead ? { tableHead: spec.tableHead } : {}),
    ...(spec.number ? { number: spec.number } : {}),
    ...(spec.chip ? { chip: spec.chip } : {}),
    ...(spec.cardLine ? { cardLine: spec.cardLine } : {}),
    ...(spec.title ? { title: { ...base.title, ...spec.title } } : {}),
    ...(spec.sketch === false ? { sketch: undefined } : spec.sketch ? { sketch: { ...base.sketch, ...(spec.sketch === true ? {} : spec.sketch) } } : {}),
    background,
  };
}

/** A colour moved along with the page it was chosen for: the same step away from the new canvas. */
function shift(colour: string, from: string, to: string): string {
  const [a, b, c] = [parseColor(colour), parseColor(from), parseColor(to)];
  if (!a || !b || !c) return colour;
  return hex([0, 1, 2].map((i) => Math.max(0, Math.min(255, c[i]! + a[i]! - b[i]!))) as [number, number, number]);
}

const today = (d: string | undefined) => (d === 'today' ? new Date().toISOString().slice(0, 10) : d);

/** One tone from a brand colour: tile tint, group wash and border, and a foreground that reads on the tile. */
function toneFrom(t: ToneSpec, bgs: { dark: boolean; canvas: string; surface: string; paper?: { wash: string; line: string } }, warn: (m: string) => void = () => {}): ToneColors {
  const o = typeof t === 'string' ? { color: t } : t;
  const color = o.color ?? o.fg!;
  const { dark, canvas, surface, paper } = bgs;
  const bg = o.bg ?? mix(color, surface, dark ? 0.2 : 0.12);
  const wash = o.wash ?? paper?.wash ?? mix(color, canvas, dark ? 0.07 : 0.04);
  const line = o.line ?? paper?.line ?? mix(color, canvas, dark ? 0.32 : 0.26);
  // Badges put tone text on the tile, so the foreground needs text contrast there (and on the card).
  const fg = ensureContrast(ensureContrast(o.fg ?? color, bg, 4.5), surface, 4.5);
  // A brand colour is only a starting point and is darkened quietly; an explicit fg was a choice, so say so.
  if (o.fg && fg !== o.fg) warn(`fg ${o.fg} has ${contrast(o.fg, bg).toFixed(1)}:1 on its tile ${bg} (needs 4.5:1), using ${fg}`);
  return { fg, bg, wash, line };
}

// Built-in brand themes. Each is a spec run through the same derivation people's themes go through.

export const builtinSpecs: Record<string, ThemeSpec & { extends: 'classic' | 'classic-dark'; description: string }> = {
  slate: {
    name: 'slate',
    description: 'Sober consulting: navy and brass on a paper-grey page, tight corners, flat cards',
    extends: 'classic',
    colors: { primary: '#1F3A5F', accent: '#9A6B1F', canvas: '#F5F6F8', text: '#141B26', muted: '#4D5866', edge: '#7D8794', border: '#D3D8DF' },
    tones: { sky: '#2F6690', indigo: '#3A4E7A', violet: '#5B4B7A', green: '#3D6B4F', amber: '#9A6B1F', orange: '#A4552B', rose: '#9B3B4A', slate: '#56606E' },
    radius: 0.45,
    lineWeight: 1.1,
    shadow: 0.35,
    cardBar: true,
    legend: 'top',
  },
  ocean: {
    name: 'ocean',
    description: 'Fresh and bright: deep sea blue, seafoam and coral, round corners, solid icon tiles',
    extends: 'classic',
    colors: { primary: '#0B6E99', accent: '#0F9D8A', canvas: '#F2F8FB', text: '#0B2533', muted: '#3F5F70', edge: '#6F93A6', border: '#D2E4EC' },
    tones: { sky: '#1A8FC4', indigo: '#2B5BA8', violet: '#5A55B5', green: '#2E9160', amber: '#C27C0E', orange: '#E0663B', rose: '#D64563', slate: '#58717F' },
    radius: 1.3,
    lineWeight: 1.15,
    tile: 'solid',
  },
  mono: {
    name: 'mono',
    description: 'Print-friendly: greyscale with one vermilion accent, outlined tiles, no shadows',
    extends: 'classic',
    colors: { primary: '#D2401E', accent: '#D2401E', canvas: '#FFFFFF', text: '#111111', muted: '#4A4A4A', faint: '#767676', edge: '#8C8C8C', border: '#9E9E9E' },
    tones: Object.fromEntries(toneSlots.filter((t) => t !== 'blue').map((t, i) => [t, { fg: ['#2B2B2B', '#3D3D3D', '#4F4F4F', '#333333', '#454545'][i % 5]!, bg: '#F1F1F1', wash: '#FAFAFA', line: '#BDBDBD' }])),
    radius: 0.6,
    lineWeight: 1.25,
    shadow: 0,
    tile: 'outline',
    harmonize: false,
  },
};

export const builtinThemes: Record<string, Theme> = Object.fromEntries(Object.entries(builtinSpecs).map(([k, s]) => [k, deriveTheme(classic, s)]));
