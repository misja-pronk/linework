// Untyped font tools (also used by scripts/fonts.mjs).
declare module 'fontkit' {
  export function create(buffer: Buffer): unknown;
}
declare module 'wawoff2' {
  const wawoff2: { decompress(b: Uint8Array): Promise<Uint8Array>; compress(b: Uint8Array): Promise<Uint8Array> };
  export default wawoff2;
}
