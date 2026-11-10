// Kinds people write for a person: "user" in a sequence diagram (whose kind is person), "person" in
// a cloud diagram (whose kinds are user and users). Each type names them its own way; what is clearly
// the same thing is read as that type's kind, with a hint to write the name the type uses.
import type { PaletteItem } from './diagram-type.ts';
import type { Path } from './model.ts';

/** One person, then several: the first of a row the type has stands for the rest. */
const ONE = ['person', 'user', 'actor', 'human'];
const MANY = ['people', 'users', 'persons', 'customers'];

const isMap = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** The type's kind for an alias in a collection, if the alias is not a kind there itself. */
function aliasFor(word: string, kinds: Set<string>): string | undefined {
  if (kinds.has(word)) return undefined;
  const one = ONE.includes(word);
  if (!one && !MANY.includes(word)) return undefined;
  return [...(one ? ONE : MANY), ...(one ? MANY : ONE)].find((k) => kinds.has(k));
}

/**
 * The data with person-like kinds read as the type's own ("user" → person), and where each was.
 * The data is copied only where something changes.
 */
export function readKindAliases(data: Record<string, unknown>, palette: readonly PaletteItem[]): { data: Record<string, unknown>; read: { path: Path; from: string; to: string }[] } {
  const read: { path: Path; from: string; to: string }[] = [];
  const byCollection = new Map<string, Set<string>>();
  for (const p of palette) byCollection.set(p.collection, (byCollection.get(p.collection) ?? new Set()).add(p.kind));
  let out = data;
  for (const [coll, kinds] of byCollection) {
    const entries = data[coll];
    if (!isMap(entries)) continue;
    let copy: Record<string, unknown> | undefined;
    for (const [id, e] of Object.entries(entries)) {
      const word = typeof e === 'string' ? e : isMap(e) && typeof e.kind === 'string' ? e.kind : undefined;
      const to = word && aliasFor(word.toLowerCase(), kinds);
      if (!to) continue;
      copy ??= { ...entries };
      copy[id] = typeof e === 'string' ? to : { ...(e as object), kind: to };
      read.push({ path: typeof e === 'string' ? [coll, id] : [coll, id, 'kind'], from: word!, to });
    }
    if (copy) out = { ...(out === data ? { ...data } : out), [coll]: copy };
  }
  return { data: out, read };
}
