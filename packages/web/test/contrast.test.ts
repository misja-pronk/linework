// The editor's colours, read from the token layer (src/styles.css) as the browser would resolve them:
// every text token at least 4.5:1 on the grounds it is set on, every border that says "this is a
// control" at least 3:1, in the light and the night-chart theme.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

/** The declarations of the first rule with this selector. */
function block(selector: string): Record<string, string> {
  const at = css.indexOf(`${selector} {`);
  if (at < 0) throw new Error(`no ${selector} in styles.css`);
  const body = css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
  return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]));
}

const light = block(':root');
const dark = { ...light, ...block(":root[data-theme='dark']") };

function resolve(tokens: Record<string, string>, name: string): string {
  let v = tokens[name];
  for (let i = 0; v && i < 8; i++) {
    const ref = /^var\((--[\w-]+)\)$/.exec(v);
    if (!ref) break;
    v = tokens[ref[1]!];
  }
  if (!v || !/^#[0-9a-f]{6}$/i.test(v)) throw new Error(`${name} is not a plain colour: ${v}`);
  return v;
}

const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
};

/** Text tokens and the grounds each is set on. */
const TEXT: [string, string[]][] = [
  ['--text', ['--paper', '--sheet', '--table', '--hover']],
  ['--text-muted', ['--paper', '--sheet', '--table', '--hover']],
  ['--text-faint', ['--paper', '--sheet', '--table', '--hover']],
  // Rust: the selection's callout on the sheet, the drag readout and a chosen index number on paper.
  // Never as text on the table (4.49:1 there): keep it so.
  ['--rust', ['--paper', '--sheet']],
  ['--danger-ink', ['--paper', '--sheet']],
  ['--warning-ink', ['--paper', '--sheet', '--table']],
  ['--success-ink', ['--paper', '--sheet']],
  ['--count', ['--count-soft']],
  // Filled: the primary button and the active tool (paper on ink), a drop label (on the rust).
  ['--paper', ['--ink']],
  ['--accent-text', ['--accent']],
  ['--syn-key', ['--sheet', '--active-line']],
  ['--syn-string', ['--sheet', '--active-line']],
  ['--syn-atom', ['--sheet', '--active-line']],
  ['--syn-comment', ['--sheet', '--active-line']],
  ['--syn-punct', ['--sheet', '--active-line']],
  ['--syn-meta', ['--sheet', '--active-line']],
];
/** Borders that identify a control, and the grounds they stand on. */
const BORDERS: [string, string[]][] = [['--rule', ['--paper', '--sheet', '--table']]];

describe.each([
  ['light', light],
  ['dark', dark],
])('the %s theme', (_, tokens) => {
  it('sets every text at 4.5:1 or more on its grounds', () => {
    const low = TEXT.flatMap(([fg, grounds]) => grounds.map((bg) => [fg, bg, ratio(resolve(tokens, fg), resolve(tokens, bg))] as const)).filter(([, , r]) => r < 4.5);
    expect(low.map(([fg, bg, r]) => `${fg} on ${bg}: ${r.toFixed(2)}`)).toEqual([]);
  });
  it('draws control borders at 3:1 or more', () => {
    const low = BORDERS.flatMap(([fg, grounds]) => grounds.map((bg) => [fg, bg, ratio(resolve(tokens, fg), resolve(tokens, bg))] as const)).filter(([, , r]) => r < 3);
    expect(low.map(([fg, bg, r]) => `${fg} on ${bg}: ${r.toFixed(2)}`)).toEqual([]);
  });
});
