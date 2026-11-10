import { describe, expect, it } from 'vitest';
import { tones } from '@cartography/core';
import { builtinSpecs, classic, classicDark, contrast, deepestGround, deriveTheme, ensureContrast, fromHsl, light, dark, look, parseThemeSpec, resolveTheme, themes, type Theme, type ThemeWarning } from '../src/index.ts';

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
      checkAA(deriveTheme(classic, spec, {}, (x) => w.push(x)));
      expect(w, name).toEqual([]);
    }
  });

  it('derives a whole palette from one brand colour, AA on light and dark', () => {
    for (const base of [light, dark, classic, classicDark]) {
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

  it('keeps the previous default as classic, untouched by the new tokens', () => {
    expect(themes.classic).toBe(classic);
    expect(themes['classic-dark']).toBe(classicDark);
    expect(classic.font.family).toMatch(/^Inter/);
    expect(look(classic)).toMatchObject({ tile: 'soft', legend: 'row', tableHead: 'tone', number: 'solid', chip: 'fill', edgeLabel: { style: 'pill', mono: false }, sheet: { marks: 'none' }, line: { bridge: 0, junction: 'dot', corner: 'round', arrow: 'filled' } });
    expect(look(classic).group.tints).toBeUndefined();
    expect(themes.slate!.font.family).toMatch(/^Inter/);
    expect(look(themes.slate!).edgeLabel.style).toBe('pill');
  });

  it('reads the look tokens and says what it cannot use', () => {
    const w: ThemeWarning[] = [];
    const spec = parseThemeSpec(
      {
        tile: 'ring',
        iconSize: 20,
        edgeLabel: 'halo',
        edgeLabelInk: 'line',
        edgeLabelCaps: true,
        legendStyle: 'key',
        group: { tints: ['#F4F4F4', '#EAEAEA'], line: 'none', dash: '4 3', label: 'caps', tracking: 1, labelColor: 'muted', bogus: 1 },
        lines: { bridge: 4, junction: 'ring', corner: 'chamfer', arrow: 'open', dashScale: true },
        sheet: { marks: 'frame', zones: true, ticks: true },
        tableHead: 'paper',
        number: 'ring',
        chip: 'outline',
        title: { mono: true, caps: true, size: 16 },
        background: { dots: true },
        contrast: 'high',
        font: { mono: { family: 'Geist Mono' }, monoFor: ['edgeLabel', 'type'] },
      },
      (x) => w.push(x),
    );
    expect(w.map((x) => x.path.join('.'))).toEqual(['group.bogus']);
    expect(spec).toMatchObject({ tile: 'ring', edgeLabel: 'halo', legendStyle: 'key', lines: { bridge: 4, corner: 'chamfer' }, sheet: { marks: 'frame', zones: true }, contrast: 'high' });

    const bad: ThemeWarning[] = [];
    parseThemeSpec({ tile: 'blob', edgeLabel: 'bubble', lines: { junction: 'star', bridge: 99 }, sheet: { marks: 'border' }, group: { tints: ['red-ish'], dash: 'dotted' }, font: { monoFor: ['body'] }, contrast: 'max' }, (x) => bad.push(x));
    expect(bad.map((x) => x.path.join('.')).sort()).toEqual(['contrast', 'edgeLabel', 'font.monoFor', 'group.dash', 'group.tints', 'lines.bridge', 'lines.junction', 'sheet.marks', 'tile']);
    expect(bad.find((x) => x.path[0] === 'tile')!.message).toMatch(/soft, solid, outline, bare, disc or ring/);
  });

  it('applies look tokens on top of the base and keeps text readable on the deepest tint', () => {
    const w: ThemeWarning[] = [];
    const t = deriveTheme(light, { group: { tints: ['#EEEEEE', '#D8D8D8', '#BDBDBD'] }, colors: { faint: '#8A8A8A' }, edgeLabel: 'plate', lines: { bridge: 0 } }, {}, (x) => w.push(x));
    expect(look(t).edgeLabel.style).toBe('plate');
    expect(look(t).line.bridge).toBe(0);
    expect(look(t).line.junction).toBe('ring'); // from Survey
    expect(deepestGround(t)).toBe('#BDBDBD');
    // Faint text is checked against the deepest tint, not only the page: 3:1 normally, AA with contrast: high.
    expect(contrast('#8A8A8A', '#BDBDBD')).toBeLessThan(3);
    expect(contrast(t.textFaint, '#BDBDBD')).toBeGreaterThanOrEqual(3);
    expect(contrast(t.textMuted, '#BDBDBD')).toBeGreaterThanOrEqual(AA);
    expect(w.some((x) => x.path.join('.') === 'colors.faint')).toBe(true);
    const high = deriveTheme(light, { group: { tints: ['#EEEEEE', '#D8D8D8', '#BDBDBD'] }, colors: { faint: '#8A8A8A' }, contrast: 'high' });
    expect(contrast(high.textFaint, '#BDBDBD')).toBeGreaterThanOrEqual(AA);
  });

  it('takes all ten tones and sharpens outlines with contrast: high', () => {
    const w: ThemeWarning[] = [];
    const all = Object.fromEntries(tones.map((k, i) => [k, fromHsl(i * 36, 0.6, 0.4)]));
    const spec = parseThemeSpec({ tones: all, contrast: 'high' }, (x) => w.push(x));
    expect(w).toEqual([]);
    expect(Object.keys(spec.tones!)).toHaveLength(10);
    const t = deriveTheme(light, { contrast: 'high' });
    for (const bg of [t.canvas, t.surface]) expect(contrast(t.border, bg)).toBeGreaterThanOrEqual(3);
    expect(contrast(look(t).group.line!, deepestGround(t))).toBeGreaterThanOrEqual(3);
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
