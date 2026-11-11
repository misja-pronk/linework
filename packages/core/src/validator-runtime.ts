// The helpers the precompiled validators (generated/validators.ts) call, as Ajv's runtime has them:
// deep equality for enum, const and uniqueItems, and string length in code points for minLength.

/** Deep equality of JSON values (fast-deep-equal, which Ajv uses, for what YAML can hold). */
export function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    if (a.constructor !== b.constructor) return false;
    if (Array.isArray(a)) {
      const other = b as unknown[];
      if (a.length !== other.length) return false;
      for (let i = 0; i < a.length; i++) if (!equal(a[i], other[i])) return false;
      return true;
    }
    if (a instanceof Date) return a.getTime() === (b as Date).getTime();
    if (a instanceof RegExp) return a.source === (b as RegExp).source && a.flags === (b as RegExp).flags;
    const ka = Object.keys(a);
    if (ka.length !== Object.keys(b).length) return false;
    for (const k of ka) if (!Object.prototype.hasOwnProperty.call(b, k) || !equal((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
    return true;
  }
  // NaN equals NaN.
  return a !== a && b !== b;
}

/** A string's length in code points: a surrogate pair counts once. */
export function ucs2length(str: string): number {
  const len = str.length;
  let length = 0;
  let pos = 0;
  while (pos < len) {
    length++;
    const value = str.charCodeAt(pos++);
    if (value >= 0xd800 && value <= 0xdbff && pos < len && (str.charCodeAt(pos) & 0xfc00) === 0xdc00) pos++;
  }
  return length;
}
