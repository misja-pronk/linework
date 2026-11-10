// The template's look as a Cartography theme, made by the same derivation a brand theme file goes
// through: the page from the slide background, text from tx1, tones from the six accents, the
// body font for every word. An accent that cannot be drawn with on that page (too light, the
// background's own colour) keeps Cartography's tone, and the export says so.
import { tones as toneSlots, type Tone } from '@cartography/core';
import { contrast, deriveTheme, ensureContrast, themes, toHsl, type Theme, type ThemeSpec } from '@cartography/theme';
import type { PptxTemplate, SchemeColor, TemplateLayout } from './read.ts';

/** Under this against the page an accent is a background colour, not one to draw lines and icons with. */
const DRAWABLE = 1.6;
/** Greys go to the neutral slot, whatever their slight hue. */
const GREY = 0.12;

/** The colour behind a slide of this layout: its own background, the master's, or lt1. */
export function pageColor(t: PptxTemplate, layout: TemplateLayout): string {
  const master = t.masters.find((m) => m.path === layout.master);
  const bg = layout.background ?? master?.background;
  return (bg && 'color' in bg && bg.color) || t.colors.lt1;
}

/** A scheme name (tx1, bg2, accent1) as the master maps it, as a colour. */
export function schemeColor(t: PptxTemplate, layout: TemplateLayout, name: string): string {
  const map = layout.clrMap ?? t.masters.find((m) => m.path === layout.master)?.clrMap ?? {};
  const key = (map[name] ?? { bg1: 'lt1', tx1: 'dk1', bg2: 'lt2', tx2: 'dk2' }[name] ?? name) as SchemeColor;
  return t.colors[key] ?? t.colors.dk1;
}

export interface TemplateTheme {
  theme: Theme;
  /** Accents that were left out or changed to be readable, in words. */
  warnings: string[];
  /** Which accent went on which tone slot. */
  tones: Partial<Record<Tone, string>>;
}

const hueGap = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

export function templateTheme(t: PptxTemplate, layout: TemplateLayout): TemplateTheme {
  const canvas = pageColor(t, layout);
  const dark = contrast(canvas, '#000000') < contrast(canvas, '#FFFFFF');
  const base = dark ? themes.dark : themes.light;
  // Text in tx1, unless the layout puts it on a ground it does not read on (a dark title layout): then the scheme colour that does.
  const text = ['tx1', 'bg1', 'tx2', 'bg2'].map((k) => schemeColor(t, layout, k)).find((c) => contrast(c, canvas) >= 4.5) ?? schemeColor(t, layout, 'tx1');
  const warnings: string[] = [];
  const accents = (['accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'] as const).map((k) => ({ key: k, color: t.colors[k] }));
  const usable = accents.filter((a) => {
    const c = contrast(a.color, canvas);
    if (c >= DRAWABLE) return true;
    warnings.push(`${a.key} ${a.color} is too close to the slide background ${canvas} (${c.toFixed(1)}:1) to draw with: that tone stays Cartography's`);
    return false;
  });
  // The first accent is the main tone (blue, what most things are drawn in), the second the second
  // (teal); the rest go to the slot nearest in hue, so a red accent is what says "danger".
  const slots: Partial<Record<Tone, string>> = {};
  const names: Partial<Record<Tone, string>> = {};
  const free = new Set<Tone>(toneSlots);
  const put = (slot: Tone, a: { key: string; color: string }) => {
    slots[slot] = a.color;
    names[slot] = a.key;
    free.delete(slot);
  };
  const colourful = usable.filter((a) => toHsl(a.color)[1] >= GREY);
  const grey = usable.find((a) => toHsl(a.color)[1] < GREY);
  if (grey) put('slate', grey);
  if (colourful[0]) put('blue', colourful[0]);
  if (colourful[1]) put('teal', colourful[1]);
  for (const a of colourful.slice(2)) {
    const h = toHsl(a.color)[0];
    const near = [...free].filter((s) => s !== 'slate').sort((x, y) => hueGap(toHsl(base.tones[x].fg)[0], h) - hueGap(toHsl(base.tones[y].fg)[0], h))[0];
    if (near) put(near, a);
  }
  // A light accent still names its hue, darkened until it reads; said when that is far from the colour itself.
  for (const [slot, c] of Object.entries(slots) as [Tone, string][]) {
    const drawn = ensureContrast(c, canvas, 4.5);
    if (contrast(c, canvas) < 2) warnings.push(`${names[slot]} ${c} has ${contrast(c, canvas).toFixed(1)}:1 on the slide background: text and icons in it are drawn darker (${drawn})`);
  }
  const spec: ThemeSpec = {
    name: t.themeName ?? 'template',
    colors: { canvas, text, ...(slots.blue ? { primary: slots.blue } : {}), ...(slots.teal ? { accent: slots.teal } : {}) },
    tones: Object.fromEntries(Object.entries(slots).filter(([s]) => s !== 'blue' && s !== 'teal')),
    // Every word in the template's body face: a deck uses the faces its template brings, nothing else.
    font: { family: t.fonts.minor, monoFor: [] },
  };
  const theme = deriveTheme(base, spec, {}, (w) => warnings.push(w.message));
  return { theme, warnings, tones: names };
}
