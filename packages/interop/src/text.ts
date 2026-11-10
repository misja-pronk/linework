// Small text helpers the writers and readers share.

export const r2 = (n: number) => Math.round(n * 100) / 100;

/** Text inside an element, or HTML text inside a label. */
export const xmlText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A value inside a double-quoted attribute; a line break survives as a character reference. */
export const xmlAttr = (s: string) => xmlText(s).replace(/"/g, '&quot;').replace(/\n/g, '&#10;').replace(/\t/g, '&#9;');

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Character and entity references back to text. */
export function unescapeXml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, ref: string) => {
    if (ref[0] === '#') {
      const code = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : all;
    }
    return NAMED[ref.toLowerCase()] ?? all;
  });
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function base64Bytes(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    out += B64[a >> 2]! + B64[((a & 3) << 4) | ((b ?? 0) >> 4)]! + (b === undefined ? '=' : B64[((b & 15) << 2) | ((c ?? 0) >> 6)]!) + (c === undefined ? '=' : B64[c & 63]!);
  }
  return out;
}

/** Text as base64 of its UTF-8 bytes; the same in Node and in the browser. */
export const base64 = (text: string) => base64Bytes(new TextEncoder().encode(text));

export function fromBase64(text: string): Uint8Array {
  const clean = text.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let n = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const [a, b, c, d] = [0, 1, 2, 3].map((k) => (i + k < clean.length ? B64.indexOf(clean[i + k]!) : -1));
    out[n++] = (a! << 2) | (b! >> 4);
    if (c! >= 0) out[n++] = ((b! & 15) << 4) | (c! >> 2);
    if (d! >= 0) out[n++] = ((c! & 3) << 6) | d!;
  }
  return out.subarray(0, n);
}

/** HTML of a label as plain lines: tags dropped, <br> and blocks as line breaks. */
export function htmlLines(html: string): string[] {
  const text = html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(div|p|li|h[1-6]|tr)(\s[^>]*)?>/gi, '\n')
    .replace(/<[^>]*>/g, '');
  return unescapeXml(text)
    .split('\n')
    .map((l) => l.replace(/[ \s]+/g, ' ').trim())
    .filter(Boolean);
}
