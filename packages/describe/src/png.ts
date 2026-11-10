// PNG has a place for words about the picture: text chunks with the registered keywords Title and
// Description. Image viewers and digital-asset tools show them; a page still needs alt text of its own.

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** An iTXt chunk: UTF-8 text, uncompressed, no language. */
function itxt(keyword: string, text: string): Uint8Array {
  const enc = new TextEncoder();
  const body = new Uint8Array([...enc.encode(keyword), 0, 0, 0, 0, 0, ...enc.encode(text)]);
  const typed = new Uint8Array([...enc.encode('iTXt'), ...body]);
  const out = new Uint8Array(12 + body.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, body.length);
  out.set(typed, 4);
  view.setUint32(8 + body.length, crc32(typed));
  return out;
}

/** The PNG with Title and Description chunks after its header; anything that is not a PNG comes back as it was. */
export function pngWithText(png: Uint8Array, text: { title?: string; description?: string }): Uint8Array {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  if (png.length < 33 || sig.some((b, i) => png[i] !== b)) return png;
  // The header chunk is first and always 13 bytes long: 8 + 4 + 4 + 13 + 4.
  const at = 33;
  const chunks = [text.title ? itxt('Title', text.title) : undefined, text.description ? itxt('Description', text.description) : undefined].filter((c): c is Uint8Array => !!c);
  const size = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(png.length + size);
  out.set(png.subarray(0, at), 0);
  let p = at;
  for (const c of chunks) out.set(c, p), (p += c.length);
  out.set(png.subarray(at), p);
  return out;
}
