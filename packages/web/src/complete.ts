// Autocomplete from the type's JSON Schema: keys that fit where the cursor is, allowed values,
// and ids already in the document where a value refers to something.
import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import { parse } from 'yaml';
import { findType, schemaOf, types } from '@linework/engine';
import { cursorContext } from './yaml-path.ts';

type Schema = Record<string, any>;

/** Every schema that can apply at a path, with anyOf branches spread out. */
export function schemasAt(root: Schema, path: string[]): Schema[] {
  let current = spread(root, root);
  for (const seg of path) {
    const next: Schema[] = [];
    for (const s of current) {
      if (seg === '-') {
        if (s.items) next.push(...spread(s.items, root));
      } else if (s.properties?.[seg]) next.push(...spread(s.properties[seg], root));
      else if (s.additionalProperties && typeof s.additionalProperties === 'object') next.push(...spread(s.additionalProperties, root));
    }
    current = next;
  }
  return current;
}

/** A schema as its branches; one that points at a definition (states inside a state) is that definition. */
function spread(s: Schema | undefined, root: Schema): Schema[] {
  if (!s || typeof s !== 'object') return [];
  const ref = typeof s.$ref === 'string' ? /^#\/(definitions|\$defs)\/(.+)$/.exec(s.$ref) : null;
  if (ref) return spread(root[ref[1]!]?.[ref[2]!], root);
  const alts = s.anyOf ?? s.oneOf;
  return alts ? alts.flatMap((a: Schema) => spread(a, root)) : [s];
}

/** Values that point at other entries, by the key they are written under. */
const refKeys: Record<string, string[]> = {
  in: ['groups', 'resources'],
  domain: ['domains'],
  schema: ['schemas'],
  catalog: ['catalogs'],
  contract: ['contracts'],
};
const ID_COLLECTIONS = ['nodes', 'groups', 'tables', 'principals', 'packages', 'resources', 'roles', 'sources', 'products', 'consumers'];

function ids(data: any, collections: string[]): Completion[] {
  const out: Completion[] = [];
  for (const c of collections)
    for (const [id, v] of Object.entries((data?.[c] ?? {}) as Record<string, any>))
      out.push({ label: id, type: 'variable', detail: typeof v === 'object' && v?.label ? v.label : c.replace(/s$/, '') });
  return out;
}

function lastGood(text: string): any {
  try {
    return parse(text);
  } catch {
    return undefined;
  }
}

export function schemaCompletion(ctx: CompletionContext): CompletionResult | null {
  const text = ctx.state.doc.toString();
  const c = cursorContext(text, ctx.pos);
  if (!ctx.explicit && !c.word && c.key) return null;

  // Before "type:" is chosen, only that.
  if (c.path.length === 0 && c.valueKey === 'type')
    return { from: c.from, options: types.map((t) => ({ label: t.id, type: 'enum', detail: t.name })) };
  const type = findType(/^type:\s*([\w-]+)/m.exec(text)?.[1]);
  if (!type) return c.key && c.path.length === 0 ? { from: c.from, options: [{ label: 'type', type: 'property', apply: 'type: ' }] } : null;

  const data = lastGood(text);
  const options: Completion[] = [];
  if (c.key) {
    const here = schemasAt(schemaOf(type), c.path);
    const existing = new Set(Object.keys(pick(data, c.path) ?? {}));
    const seen = new Set<string>();
    for (const s of here)
      for (const [k, v] of Object.entries((s.properties ?? {}) as Record<string, Schema>)) {
        if (seen.has(k) || existing.has(k)) continue;
        seen.add(k);
        options.push({ label: k, type: 'property', info: v.description, apply: `${k}: ` });
      }
    // Inside a list of edges or references a bare item is an id, too.
    if (c.path.at(-1) === '-') options.push(...ids(data, ID_COLLECTIONS));
  } else {
    const path = c.valueKey ? [...c.path, c.valueKey] : c.path;
    for (const s of schemasAt(schemaOf(type), path)) {
      for (const e of s.enum ?? []) options.push({ label: String(e), type: 'enum' });
      if (s.const != null) options.push({ label: String(s.const), type: 'enum' });
      if (s.type === 'boolean') options.push({ label: 'true', type: 'keyword' }, { label: 'false', type: 'keyword' });
    }
    const refs = c.valueKey ? refKeys[c.valueKey] : undefined;
    if (refs) options.push(...ids(data, refs));
    else if (path.at(-1) === '-' || !options.length) options.push(...ids(data, ID_COLLECTIONS));
  }
  if (!options.length) return null;
  const unique = [...new Map(options.map((o) => [o.label, o])).values()];
  return { from: c.from, options: unique, validFor: /^[\w.-]*$/ };
}

function pick(data: any, path: string[]): any {
  let v = data;
  for (const seg of path) {
    if (v == null) return undefined;
    v = seg === '-' ? (Array.isArray(v) ? v.at(-1) : undefined) : v[seg];
  }
  return v && typeof v === 'object' ? v : undefined;
}
