// Accessibility of the built-in looks: text contrast on every ground a label can land on, tints that
// still step without colour, and tone ramps that stay apart for colour-blind readers.
import { describe, expect, it } from 'vitest';
import { tones } from '@cartography/core';
import { builtinLooks, contrast, deepestGround, look, luminance, parseColor, themeCatalog, themes, type Theme } from '../src/index.ts';

const AA = 4.5;
const names = Object.keys(themes);

/** Every fill text is drawn on: cards, the page, and each depth of group. */
const grounds = (t: Theme): string[] => [t.surface, t.canvas, ...(look(t).group.tints ?? [])];

describe('built-in themes', () => {
  it('lists the looks, the brand examples and the two aliases', () => {
    expect(names).toEqual(['survey', 'survey-dark', 'survey-cool', 'transit', 'transit-dark', 'drafting', 'drafting-dark', 'sketch', 'sketch-dark', 'classic', 'classic-dark', 'slate', 'ocean', 'mono', 'light', 'dark']);
    expect(themes.light).toBe(themes.survey);
    expect(themes.dark).toBe(themes['survey-dark']);
    expect(themeCatalog.map((x) => x.name)).toEqual(names.slice(0, -2));
    for (const entry of themeCatalog) expect(entry.description.length, entry.name).toBeGreaterThan(10);
  });

  it.each(names)('%s: text is AA on cards, the page and the deepest group tint', (name) => {
    const t = themes[name]!;
    for (const bg of grounds(t)) {
      expect(contrast(t.text, bg), `text on ${bg}`).toBeGreaterThanOrEqual(AA);
      expect(contrast(t.textMuted, bg), `muted on ${bg}`).toBeGreaterThanOrEqual(AA);
      expect(contrast(t.edge, bg), `line on ${bg}`).toBeGreaterThanOrEqual(3);
    }
    // Classic and the brand examples built on it keep the tone values they shipped with (icons and
    // chips there are graphics at 3:1); the looks added with Survey hold tone ink to text contrast.
    const older = !(name in builtinLooks) || name.startsWith('classic') ? 3 : AA;
    for (const k of tones) {
      expect(contrast(t.tones[k].fg, t.tones[k].bg), `${k} on its chip`).toBeGreaterThanOrEqual(older);
      expect(contrast(t.tones[k].fg, t.surface), `${k} on a card`).toBeGreaterThanOrEqual(older);
      expect(contrast(t.tones[k].fg, deepestGround(t)), `${k} line on the deepest tint`).toBeGreaterThanOrEqual(3);
    }
  });

  // Faint text carries captions and the imprint, so every built-in holds it to AA on every ground.
  it.each(names)('%s: faint text is AA on the deepest tint', (name) => {
    const t = themes[name]!;
    for (const bg of grounds(t)) expect(contrast(t.textFaint, bg), `faint on ${bg}`).toBeGreaterThanOrEqual(AA);
  });

  it.each(Object.keys(builtinLooks))('%s: group depth shows without colour', (name) => {
    const t = themes[name]!;
    const tints = look(t).group.tints;
    if (!tints) return;
    // Either each level is a visibly different grey, or (Drafting) the outline alone carries the nesting.
    const flat = new Set(tints).size === 1;
    if (flat) return expect(contrast(look(t).group.line!, t.canvas)).toBeGreaterThanOrEqual(3);
    const steps = [t.canvas, ...tints].map(luminance);
    for (let i = 1; i < steps.length; i++) expect(Math.abs(steps[i]! - steps[i - 1]!), `${name} tint ${i}`).toBeGreaterThan(t.mode === 'dark' ? 0.002 : 0.03);
  });
});

// ---------------------------------------------------------------- colour-blind simulation

const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
/** Machado, Oliveira and Fernandes (2009), full dichromacy, applied to linear RGB. */
const sight: Record<string, number[][]> = {
  protanopia: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deuteranopia: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
  tritanopia: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]],
};
const seen = (color: string, m: number[][]): number[] => {
  const c = parseColor(color)!.map((v) => lin(v / 255));
  return m.map((r) => Math.min(1, Math.max(0, r[0]! * c[0]! + r[1]! * c[1]! + r[2]! * c[2]!)));
};
const oklab = ([r, g, b]: number[]): number[] => {
  const l = Math.cbrt(0.4122214708 * r! + 0.5363325363 * g! + 0.0514459929 * b!);
  const m = Math.cbrt(0.2119034982 * r! + 0.6806995451 * g! + 0.1073969566 * b!);
  const s = Math.cbrt(0.0883024619 * r! + 0.2817188376 * g! + 0.6299787005 * b!);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
};
/** Distance in OKLab, times 100; about 2 is the smallest step an eye can tell. */
const apart = (a: number[], b: number[]) => 100 * Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);

describe('colour-blind readers', () => {
  // Ten inks cannot all stay far apart on the one hue axis a dichromat has left, so kind is never
  // carried by colour alone (icon, label and legend sample repeat it). What the ramps do guarantee:
  // no two tones turn into the same colour.
  it.each(['survey', 'survey-cool', 'survey-dark', 'transit', 'transit-dark', 'sketch', 'sketch-dark'])('%s: no two tones collapse into one', (name) => {
    const t = themes[name]!;
    for (const [kind, m] of Object.entries(sight)) {
      const labs = tones.map((k) => oklab(seen(t.tones[k].fg, m)));
      for (let i = 0; i < tones.length; i++) for (let j = i + 1; j < tones.length; j++) expect(apart(labs[i]!, labs[j]!), `${tones[i]} and ${tones[j]} with ${kind}`).toBeGreaterThanOrEqual(3);
    }
  });
});
