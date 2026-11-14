// JSON Schemas for the YAML extension (completion, hover): the engine's own, per type. The extension
// checks what the engine checks again in its own words, so the copy it gets leaves out what only
// rejects (unknown keys, required keys): the Problems list then holds each problem once, as the CLI says it.
import { eachSchema, modelKeys, modelProperties, modelSchema } from '@linework/core';
import { findType, schemaOf, types } from '@linework/engine';

type Json = Record<string, unknown>;

/** A copy without `additionalProperties: false`, `required` and `propertyNames`, everywhere. Schemas under additionalProperties stay. */
export function relaxed(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(relaxed);
  if (!schema || typeof schema !== 'object') return schema;
  const out: Json = {};
  for (const [k, v] of Object.entries(schema as Json)) {
    if (k === 'required' && Array.isArray(v)) continue;
    if (k === 'additionalProperties' && v === false) continue;
    // Names are checked by the engine after each: wrote its patterns out: <domain>_<env> is a fine key here.
    if (k === 'propertyNames') continue;
    out[k] = relaxed(v);
  }
  return out;
}

const shared = {
  theme: { description: 'The look: light, dark, a built-in theme name, or a .theme.yaml file next to the diagram (docs/themes.md)', anyOf: [{ type: 'string' }, { type: 'object' }] },
  icons: { description: 'Icon packs or SVG files for kinds (docs/style.md)' },
};

/** What a diagram of this type may hold, as an editor completes it; `model` for a model file. */
export function editorSchema(id: string): Json | undefined {
  if (id === 'model') return relaxed({ ...modelSchema, properties: { ...shared, each: eachSchema, ...(modelSchema as { properties?: Json }).properties } }) as Json;
  const type = findType(id);
  if (!type) return undefined;
  const full = schemaOf(type) as { properties?: Json };
  // Types that do not list the model keys still take them (the engine checks them apart).
  const model = Object.fromEntries(modelKeys.filter((k) => !(k in (full.properties ?? {}))).map((k) => [k, modelProperties[k]]));
  const typeKey = { const: id, description: `${type.name}: ${type.tagline ?? type.description}` };
  return relaxed({ ...full, properties: { type: typeKey, ...shared, ...model, ...full.properties } }) as Json;
}

/** Every `type:` there is a schema for. */
export const schemaIds = () => [...types.map((t) => t.id), 'model'];

/** A schema's own `$ref`s, pointed at its definitions under a prefix, so several fit in one file. */
function prefixed(schema: unknown, id: string): unknown {
  if (Array.isArray(schema)) return schema.map((x) => prefixed(x, id));
  if (!schema || typeof schema !== 'object') return schema;
  return Object.fromEntries(
    Object.entries(schema as Json).map(([k, v]) => [k, k === '$ref' && typeof v === 'string' ? v.replace(/^#\/(\$defs|definitions)\//, `#/$defs/${id}.`).replace(/^#$/, `#/$defs/${id}`) : prefixed(v, id)]),
  );
}

/** One schema for every diagram: the type key picks the rest (for tools that take one schema file). */
export function combinedSchema(): Json {
  const ids = schemaIds();
  const defs: Json = {};
  for (const id of ids) {
    const { $schema: _, $defs, definitions, ...body } = editorSchema(id)! as Json & { $defs?: Json; definitions?: Json };
    for (const [name, d] of Object.entries({ ...(definitions ?? {}), ...($defs ?? {}) })) defs[`${id}.${name}`] = prefixed(d, id);
    defs[id] = prefixed(body, id);
  }
  return {
    $schema: 'http://json-schema.org/draft-07/schema#',
    title: 'Linework diagram',
    type: 'object',
    properties: { type: { enum: ids, description: 'What kind of diagram this is' } },
    allOf: ids.map((id) => ({ if: { properties: { type: { const: id } }, required: ['type'] }, then: { $ref: `#/$defs/${id}` } })),
    $defs: defs,
  };
}

export const SCHEMA_SCHEME = 'linework';
export const schemaUri = (id: string) => `${SCHEMA_SCHEME}://schema/${id}.json`;
export const idOfSchemaUri = (uri: string) => /^linework:\/\/schema\/([\w-]+)\.json$/.exec(uri)?.[1];
