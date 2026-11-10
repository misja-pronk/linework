import { describe, expect, it } from 'vitest';
import { Ajv } from 'ajv';
import { combinedSchema, editorSchema, idOfSchemaUri, relaxed, schemaIds, schemaUri } from '../src/schemas.ts';

describe('schemas for the YAML extension', () => {
  it('has one per type and one for model files', () => {
    for (const id of schemaIds()) expect(editorSchema(id), id).toBeTruthy();
    expect(editorSchema('nope')).toBeUndefined();
  });

  it('leaves rejecting unknown and missing keys to the engine, and keeps schemas of values', () => {
    const s = relaxed({ type: 'object', required: ['a'], additionalProperties: false, properties: { m: { additionalProperties: { type: 'string' } } } }) as Record<string, any>;
    expect(s.required).toBeUndefined();
    expect(s.additionalProperties).toBeUndefined();
    expect(s.properties.m.additionalProperties).toEqual({ type: 'string' });
  });

  it('completes the shared keys and the type itself', () => {
    const s = editorSchema('erd') as { properties: Record<string, unknown> };
    for (const k of ['type', 'theme', 'steps', 'focus', 'include', 'views']) expect(s.properties, k).toHaveProperty(k);
  });

  it('compiles, as a whole too', () => {
    const ajv = new Ajv({ strict: false, allowUnionTypes: true });
    const check = ajv.compile(combinedSchema());
    expect(check({ type: 'systems', nodes: { a: { kind: 'api' } } })).toBe(true);
    expect(check({ type: 'systems', nodes: { a: { kind: 7 } } })).toBe(false);
  });

  it('names schemas by uri', () => {
    expect(idOfSchemaUri(schemaUri('data-products'))).toBe('data-products');
    expect(idOfSchemaUri('file:///x.json')).toBeUndefined();
  });
});
