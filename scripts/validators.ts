// Compiles every JSON Schema the engine validates diagrams against (validatedSchemas) ahead of time,
// with Ajv's standalone code, into packages/core/src/generated/validators.ts. Core finds a schema's
// validator there by schemaKey, so neither the CLI nor the web app compiles one with Function() at
// run time, and the web app's Content-Security-Policy needs no 'unsafe-eval'.
//   pnpm validators      after changing a schema (a test checks the file is current)
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ajvOptions, schemaKey } from '../packages/core/src/source.ts';
import { validatedSchemas } from '../packages/engine/src/index.ts';

const root = path.resolve(import.meta.dirname, '..');
export const generated = path.join(root, 'packages/core/src/generated/validators.ts');

// Ajv is core's dependency: the same copy core compiles with when a schema is missing.
const fromCore = createRequire(path.join(root, 'packages/core/package.json'));
interface AjvLike {
  addSchema(schema: object, key: string): unknown;
}
const { Ajv } = fromCore('ajv') as { Ajv: new (o: object) => AjvLike };
const standaloneCode = (fromCore('ajv/dist/standalone') as { default: (ajv: AjvLike, refs: Record<string, string>) => string }).default;

/** The helpers Ajv's generated code requires at run time, by what it requires. */
const runtime: Record<string, string> = {
  'ajv/dist/runtime/equal': 'equal',
  'ajv/dist/runtime/ucs2length': 'ucs2length',
};

type Schema = Record<string, unknown>;
const isSchema = (v: unknown): v is Schema => !!v && typeof v === 'object' && !Array.isArray(v);
/** Keywords whose value is a map of schemas, a schema, or a list of schemas (enum, const and the like hold data, not schemas). */
const MAPS = ['properties', 'patternProperties', 'definitions', '$defs', 'dependentSchemas'];
const ONE = ['items', 'additionalProperties', 'additionalItems', 'not', 'if', 'then', 'else', 'contains', 'propertyNames', 'unevaluatedProperties', 'unevaluatedItems'];
const LISTS = ['anyOf', 'oneOf', 'allOf', 'items', 'prefixItems'];

/** Each subschema of a schema, with how to put another in its place. */
function children(s: Schema, visit: (child: Schema, replace: (x: Schema) => Schema) => void): Schema {
  const out: Schema = { ...s };
  for (const k of MAPS) if (isSchema(s[k])) out[k] = Object.fromEntries(Object.entries(s[k]).map(([p, v]) => [p, isSchema(v) ? replaceWith(v, visit) : v]));
  for (const k of ONE) if (isSchema(s[k])) out[k] = replaceWith(s[k], visit);
  for (const k of LISTS) if (Array.isArray(s[k])) out[k] = (s[k] as unknown[]).map((v) => (isSchema(v) ? replaceWith(v, visit) : v));
  return out;
}
function replaceWith(child: Schema, visit: (child: Schema, replace: (x: Schema) => Schema) => void): Schema {
  let result = child;
  visit(child, (x) => (result = x));
  return result;
}

/** Subschemas worth sharing: a larger one that the schemas hold more than once (the model keys are in nearly every type's). */
const SHARE_FROM = 100;

/** The text of packages/core/src/generated/validators.ts. */
export function validatorsModule(): string {
  const ajv = new Ajv({ ...ajvOptions, code: { source: true, esm: true, lines: false } });
  const top = new Map<string, object>();
  for (const schema of validatedSchemas()) top.set(schemaKey(schema), schema);

  // Ajv inlines every subschema into each validator: shared by $ref instead, compiled once. An
  // equal subschema checks the same wherever it is, and errors keep their path, keyword and schema.
  const seen = new Map<string, number>();
  const count = (s: Schema) =>
    children(s, (c) => {
      const json = JSON.stringify(c);
      // One that refers into its own document ("#/$defs/…") only reads right where it is.
      if (json.length >= SHARE_FROM && !json.includes('"$ref":"#')) seen.set(json, (seen.get(json) ?? 0) + 1);
      count(c);
    });
  for (const s of top.values()) count(s as Schema);
  const shared = new Map<string, string>();
  for (const [json, n] of seen) if (n > 1) shared.set(json, `s${schemaKey(JSON.parse(json))}`);
  const rewrite = (s: Schema): Schema =>
    children(s, (c, replace) => {
      const id = shared.get(JSON.stringify(c));
      replace(id ? { $ref: id } : rewrite(c));
    });
  for (const [json, id] of shared) ajv.addSchema(rewrite(JSON.parse(json)), id);

  const names: Record<string, string> = {};
  for (const [key, schema] of top) {
    ajv.addSchema(rewrite(schema as Schema), key);
    names[key] = key;
  }
  let code = standaloneCode(ajv, names);
  // The generated code requires a few helpers; core has its own, so the module needs no CommonJS.
  code = code.replace(/require\("([^"]+)"\)\.default/g, (_, mod: string) => {
    const name = runtime[mod];
    if (!name) throw new Error(`Ajv's code requires ${mod}: give scripts/validators.ts a helper for it`);
    return `runtime.${name}`;
  });
  if (/require\(/.test(code)) throw new Error('Ajv\'s code requires something scripts/validators.ts does not know');
  return [
    '// Generated by scripts/validators.ts from the engine\'s schemas (validatedSchemas): do not edit.',
    '// Run pnpm validators after changing a schema.',
    '// @ts-nocheck',
    '/* eslint-disable */',
    "import * as runtime from '../validator-runtime.ts';",
    code.replace(/^"use strict";\n?/, ''),
    '',
  ].join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const text = validatorsModule();
  fs.mkdirSync(path.dirname(generated), { recursive: true });
  fs.writeFileSync(generated, text);
  console.log(`${path.relative(process.cwd(), generated)} ${(text.length / 1024).toFixed(1)} kB`);
}
