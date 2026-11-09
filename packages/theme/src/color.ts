// Colour arithmetic for brand themes: parse, mix, WCAG contrast, and nudging a colour until it reads.
export type Rgb = [number, number, number];

export function parseColor(s: string): Rgb | undefined {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s.trim());
  if (!m) return undefined;
  const h = m[1]!.length === 3 ? [...m[1]!].map((c) => c + c).join('') : m[1]!;
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb;
}

export const isColor = (s: unknown): s is string => typeof s === 'string' && !!parseColor(s);

export function hex([r, g, b]: Rgb): string {
  return '#' + [r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('').toUpperCase();
}

const rgb = (c: string): Rgb => parseColor(c) ?? [0, 0, 0];

/** `amount` of `a` over `b`: mix('#2563EB', '#FFFFFF', 0.1) is a tenth of the blue on white. */
export function mix(a: string, b: string, amount: number): string {
  const x = rgb(a);
  const y = rgb(b);
  return hex([0, 1, 2].map((i) => y[i]! + (x[i]! - y[i]!) * amount) as Rgb);
}

export function luminance(c: string): number {
  const lin = (v: number) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = rgb(c).map(lin) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2 contrast ratio, 1 to 21. AA asks 4.5 for text, 3 for large text and icons. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

export const isDark = (c: string) => luminance(c) < 0.2;

/** The colour moved towards black (on a light background) or white (on a dark one) just far enough to reach `ratio`. */
export function ensureContrast(fg: string, bg: string, ratio: number): string {
  if (contrast(fg, bg) >= ratio) return fg;
  const to = isDark(bg) ? '#FFFFFF' : '#000000';
  let lo = 0;
  let hi = 1;
  // Binary search on the mix: the smallest change keeps most of the hue.
  for (let i = 0; i < 18; i++) {
    const m = (lo + hi) / 2;
    if (contrast(mix(to, fg, m), bg) >= ratio) hi = m;
    else lo = m;
  }
  return mix(to, fg, hi);
}

export function toHsl(c: string): [number, number, number] {
  const [r, g, b] = rgb(c).map((v) => v / 255) as Rgb;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

export function fromHsl(h: number, s: number, l: number): string {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return hex([f(0) * 255, f(8) * 255, f(4) * 255]);
}
