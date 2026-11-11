// The two ways Claude may change a diagram in the Ask panel, as tools: small edits by YAML path
// (the default: comments, order and hand edits elsewhere keep their bytes) or the whole file at once
// for a restructure. Inputs stream eagerly, so nothing the API hands back is trusted: every call is
// checked against these shapes here, applied to the text, and the result goes through the engine.
import type Anthropic from '@anthropic-ai/sdk';
import type { Operation } from '@cartography/core';

export { applyOperations, type Operation } from '@cartography/core';

type Path = (string | number)[];

export type ToolCall = { name: 'edit_diagram'; summary: string; operations: Operation[] } | { name: 'replace_diagram'; summary: string; yaml: string };

const path = { type: 'array', items: { type: ['string', 'integer'] }, minItems: 1, description: 'Keys and list indexes from the top of the YAML, e.g. ["nodes", "orders-db"] or ["edges", 3].' };

export const TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: 'edit_diagram',
    description:
      'Propose a change to the open diagram as edits by YAML path. Preferred for anything that keeps most of the diagram: everything you do not touch keeps its exact text. ' +
      'Operations run in order on the YAML: "set" writes a value at a path (a new entry, or a field of one; maps are created as needed), "append" adds an item to the list at a path (e.g. a line "a -> b: HTTPS" to ["edges"]), ' +
      '"delete" removes what is at a path (deleting an entry also removes the lines and references to it), "rename" changes an entry\'s id and every reference to it ("to" is the new id). ' +
      'The user sees the change as a diff and accepts or rejects it; nothing is applied before that.',
    eager_input_streaming: true,
    input_schema: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'One short sentence: what the change does, for the user reviewing it.' },
        operations: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            properties: {
              op: { type: 'string', enum: ['set', 'append', 'delete', 'rename'] },
              path,
              value: { description: 'For set and append: the YAML value as JSON (an object for an entry, a string for a line or a field).' },
              to: { type: 'string', description: 'For rename: the new id.' },
            },
            required: ['op', 'path'],
            additionalProperties: false,
          },
        },
      },
      required: ['summary', 'operations'],
      additionalProperties: false,
    },
  },
  {
    name: 'replace_diagram',
    description:
      'Propose a new version of the whole diagram. Only for restructures where most of the file changes (another layout of groups, a different type); otherwise use edit_diagram. ' +
      'Keep ids that still mean the same thing, so their places in the drawing and the user\'s pins stay. The user reviews the diff before anything is applied.',
    eager_input_streaming: true,
    input_schema: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'One short sentence: what the change does.' },
        yaml: { type: 'string', description: 'The complete new YAML file.' },
      },
      required: ['summary', 'yaml'],
      additionalProperties: false,
    },
  },
];

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isPath = (v: unknown): v is Path => Array.isArray(v) && v.length > 0 && v.every((s) => (typeof s === 'string' && s !== '') || (Number.isInteger(s) && (s as number) >= 0));
const extra = (o: Record<string, unknown>, allowed: string[]) => Object.keys(o).filter((k) => !allowed.includes(k));

/**
 * A tool call's input checked against its schema: the call, or why it does not fit. The streamed
 * input is parsed tolerantly by the SDK, so a cut-off call can look like a shorter valid one; the
 * caller also checks the stop reason.
 */
export function checkCall(name: string, input: unknown): ToolCall | { error: string } {
  if (!isObj(input)) return { error: 'The input is not a JSON object.' };
  const summary = typeof input.summary === 'string' ? input.summary.trim() : '';
  if (name === 'replace_diagram') {
    const bad = extra(input, ['summary', 'yaml']);
    if (bad.length) return { error: `Unknown field ${bad.map((k) => `"${k}"`).join(', ')}.` };
    if (typeof input.yaml !== 'string' || !input.yaml.trim()) return { error: '"yaml" must be the complete YAML file as a string.' };
    return { name, summary, yaml: input.yaml.endsWith('\n') ? input.yaml : `${input.yaml}\n` };
  }
  if (name !== 'edit_diagram') return { error: `There is no tool "${name}". Use edit_diagram or replace_diagram.` };
  const bad = extra(input, ['summary', 'operations']);
  if (bad.length) return { error: `Unknown field ${bad.map((k) => `"${k}"`).join(', ')}.` };
  if (!Array.isArray(input.operations) || !input.operations.length) return { error: '"operations" must be a non-empty list.' };
  const operations: Operation[] = [];
  for (const [i, o] of input.operations.entries()) {
    const at = `operations[${i}]`;
    if (!isObj(o)) return { error: `${at} is not an object.` };
    const unknown = extra(o, ['op', 'path', 'value', 'to']);
    if (unknown.length) return { error: `${at} has unknown field ${unknown.map((k) => `"${k}"`).join(', ')}.` };
    if (!isPath(o.path)) return { error: `${at}.path must be a non-empty list of keys (strings) and list indexes (whole numbers).` };
    if (o.op === 'set' || o.op === 'append') {
      if (!('value' in o) || o.value === undefined || o.value === null) return { error: `${at} (${o.op}) needs a "value".` };
      operations.push({ op: o.op, path: o.path, value: o.value });
    } else if (o.op === 'delete') operations.push({ op: 'delete', path: o.path });
    else if (o.op === 'rename') {
      if (typeof o.to !== 'string' || !o.to.trim()) return { error: `${at} (rename) needs "to", the new id.` };
      operations.push({ op: 'rename', path: o.path, to: o.to.trim() });
    } else return { error: `${at}.op must be one of set, append, delete, rename.` };
  }
  return { name, summary, operations };
}

