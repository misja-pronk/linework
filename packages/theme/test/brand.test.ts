import { describe, expect, it } from 'vitest';
import { tones } from '@cartography/core';
import { builtinSpecs, contrast, deriveTheme, ensureContrast, light, dark, parseThemeSpec, resolveTheme, themes, type Theme, type ThemeWarning } from '../src/index.ts';

const AA = 4.5;

/** Every text/background pair the renderer draws. */
function checkAA(t: Theme) {
  for (const bg of [t.surface, t.canvas]) {
    expect(contrast(t.text, bg)).toBeGreaterThanOrEqual(AA);
    expect(contrast(t.textMuted, bg)).toBeGreaterThanOrEqual(AA);
    expect(contrast(t.edge, bg)).toBeGreaterThanOrEqual(3);
  }
  for (const k of tones) {
    expect(contrast(t.tones[k].fg, t.tones[k].bg), `${t.name} ${k}`).toBeGreaterThanOrEqual(AA);
    expect(contrast(t.text, t.tones[k].wash)).toBeGreaterThanOrEqual(AA);
  }
}

describe('colour', () => {
  it('computes WCAG contrast', () => {
    expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21, 1);
    expect(contrast('#777777', '#FFFFFF')).toBeCloseTo(4.48, 1);
  });

  it('nudges a colour just far enough', () => {
    const fixed = ensureContrast('#FFC20E', '#FFFFFF', AA);
    expect(contrast(fixed, '#FFFFFF')).toBeGreaterThanOrEqual(AA);
    expect(contrast(fixed, '#FFFFFF')).toBeLessThan(5);
    expect(ensureContrast('#7AA7FF', '#0D1117', AA)).toBe('#7AA7FF');
  });
});

describe('theme specs', () => {
  it('reports what it cannot use', () => {
    const w: ThemeWarning[] = [];
    const spec = parseThemeSpec({ colours: {}, colors: { primary: 'blue', accent: '#0F9D8A' }, tones: { teal: '#00A3A1', mauve: '#AA00AA' }, legend: 'left' }, (x) => w.push(x));
    expect(spec.colors).toEqual({ accent: '#0F9D8A' });
    expect(spec.tones).toEqual({ teal: '#00A3A1' });
    expect(w.map((x) => x.path.join('.'))).toEqual(['colours', 'colors.primary', 'tones.mauve', 'legend']);
  });

  it('keeps the shipped themes AA without warnings', () => {
    for (const [name, spec] of Object.entries(builtinSpecs)) {
      const w: ThemeWarning[] = [];
      checkAA(deriveTheme(light, spec, {}, (x) => w.push(x)));
      expect(w, name).toEqual([]);
    }
  });

  it('derives a whole palette from one brand colour, AA on light and dark', () => {
    for (const base of [light, dark]) {
      const t = deriveTheme(base, { colors: { primary: '#FFC20E' } });
      checkAA(t);
      expect(t.tones.blue.bg).not.toBe(base.tones.blue.bg);
    }
  });

  it('fixes a chosen text colour that fails and says so', () => {
    const w: ThemeWarning[] = [];
    const t = deriveTheme(light, { colors: { text: '#BBBBBB', canvas: '#FAFAFA' } }, {}, (x) => w.push(x));
    expect(contrast(t.text, t.canvas)).toBeGreaterThanOrEqual(AA);
    expect(w[0]).toMatchObject({ path: ['colors', 'text'] });
    expect(w[0]!.message).toMatch(/needs 4.5:1/);
  });

  it('scales corners and line weight', () => {
    const t = deriveTheme(light, { radius: 'sharp', lineWeight: 1.5 });
    expect(t.radius.card).toBeLessThan(light.radius.card);
    expect(t.stroke.edge).toBeCloseTo(light.stroke.edge * 1.5);
  });

  it('leaves light and dark as they were', () => {
    expect(themes.light).toBe(light);
    expect(themes.dark).toBe(dark);
    expect(Object.keys(themes)).toEqual(['light', 'dark', 'slate', 'ocean', 'mono']);
  });
});

describe('theme files', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 30"><rect width="30" height="30"/></svg>';
  const fakeTtf = new Uint8Array([0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const files: Record<string, string> = {
    'brand/acme.theme.yaml': 'extends: slate\ncolors: { primary: "#E4572E" }\nfont: { family: Acme Sans, files: { 600: fonts/AcmeSans-Bold.ttf } }\ntitleBlock: { logo: logo.svg, client: Acme }\n',
    'brand/logo.svg': svg,
  };
  const io = { load: (f: string) => files[f] ?? (() => { throw new Error(f); })(), assets: (f: string) => (f === 'brand/fonts/AcmeSans-Bold.ttf' ? fakeTtf : undefined) };

  it('reads a chain of files, fonts and logo relative to the file that names them', () => {
    const r = resolveTheme({ extends: './brand/acme.theme.yaml', titleBlock: { version: 'v2' } }, io);
    expect(r.warnings).toEqual([]);
    expect(r.files).toEqual(['brand/acme.theme.yaml', 'brand/fonts/AcmeSans-Bold.ttf', 'brand/logo.svg']);
    expect(r.theme.cardBar).toBe(true); // from slate
    expect(r.theme.font.family).toMatch(/^'Acme Sans', Inter/);
    expect(r.theme.font.faces).toMatchObject([{ family: 'Acme Sans', weight: 600, format: 'truetype' }]);
    expect(r.theme.titleBlock).toMatchObject({ client: 'Acme', version: 'v2', logo: { width: 120, height: 30 } });
    expect(r.theme.titleBlock!.logo!.href).toMatch(/^data:image\/svg\+xml;base64,/);
  });

  it('names what is missing', () => {
    expect(resolveTheme('./nope.theme.yaml', io).warnings[0]!.message).toMatch(/Cannot read theme file nope.theme.yaml/);
    expect(resolveTheme('sepia', io).warnings[0]!.message).toMatch(/Unknown theme "sepia"/);
    expect(resolveTheme('mono', io).theme).toBe(themes.mono);
  });
});
