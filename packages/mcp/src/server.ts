// The MCP surface: tools, resources and a prompt over the handlers in tools.ts. Descriptions are
// written for the model that reads them: what each tool is for and in which order to use them.
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { questionsFor } from '@cartography/core';
import { findType, themes, types } from '@cartography/engine';
import { editDiagram } from './edit.ts';
import { describeDiagram, diffDiagrams, reviewDiagram, threatsOf, traceDiagram } from './insight.ts';
import { getSchema, importMermaidText, listTypes, newDiagram, renderDiagram, validateDiagram, type Checked } from './tools.ts';

const themeNames = Object.keys(themes) as [string, ...string[]];
const version = '0.0.0';

const instructions = `Cartography turns a short YAML file into a clean architecture diagram (Azure, systems, ERD, access, GitHub, data products). Positions are automatic: never write coordinates.
Workflow: list_types → get_schema(type) → write YAML → validate → fix every error (each has line, column and a hint) and act on the layout suggestions → render.
Validate before every render; "quality.verdict" should be "clean" or "good".
To change an existing diagram, use edit_diagram (edits by YAML path) rather than rewriting the file: comments and pins stay. describe, review, threats, diff and trace read a diagram without changing it.`;

const json = (value: unknown): CallToolResult => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] });
const failed = (message: string): CallToolResult => ({ isError: true, content: [{ type: 'text', text: message }] });

/** Thrown errors (unknown type, bad path) become tool errors the model can read, not protocol errors. */
const safely =
  <A>(fn: (args: A) => Promise<CallToolResult> | CallToolResult) =>
  async (args: A): Promise<CallToolResult> => {
    try {
      return await fn(args);
    } catch (e) {
      return failed(e instanceof Error ? e.message : String(e));
    }
  };

const source = {
  yaml: z.string().optional().describe('The diagram as YAML text. Pass this or "file".'),
  file: z.string().optional().describe('Path to a .yaml diagram instead of "yaml" (relative to the working directory, or absolute). Contract files and <name>.layout.json next to it are used too.'),
};

const pathSchema = z.array(z.union([z.string(), z.number().int().min(0)])).min(1).describe('Keys and list indexes from the top of the YAML, e.g. ["nodes", "orders-db"] or ["edges", 3]');
const edits = z
  .array(
    z.object({
      op: z.enum(['set', 'append', 'delete', 'rename']),
      path: pathSchema,
      value: z.unknown().optional().describe('For set and append: the YAML value as JSON (an object for an entry, a string for a line like "a -> b: HTTPS" or a field)'),
      to: z.string().optional().describe('For rename: the new id'),
    }),
  )
  .min(1)
  .describe(
    'Run in order. "set" writes a value at a path (a new entry, or a field of one; maps are created as needed). "append" adds an item to the list at a path. "delete" removes what is at a path; deleting an entry also removes the lines and references to it. "rename" changes an entry\'s id and every reference to it.',
  );

/** What to draw: a view, a focus, layers, a stage or a step, as the CLI's flags say it. */
const drawnArgs = {
  view: z.string().optional().describe('One of the diagram\'s views: (by name)'),
  focus: z.array(z.string()).optional().describe('Element ids to focus on: those and what is within "hops" lines'),
  hops: z.union([z.number().int().min(0), z.literal('all')]).optional().describe('With focus: how many lines out, default 1'),
  direction: z.enum(['both', 'upstream', 'downstream']).optional().describe('With focus: which way to follow lines, default both'),
  layer: z.array(z.string()).optional().describe('Draw through these of the diagram\'s layers:'),
  stage: z.string().optional().describe('One of the diagram\'s stages: (id, number or title), or "overview"'),
  step: z.number().int().min(1).optional().describe('Draw at this step (1-based) of the diagram\'s steps:'),
};

const typeId = z.string().describe(`Diagram type id: ${types.map((t) => t.id).join(', ')}`);

/** A one-line summary first, so the model sees the outcome before the details. */
function summary(r: Checked): string {
  const errors = r.problems.filter((p) => p.severity === 'error').length;
  if (!r.ok) return `Invalid: ${errors} error${errors === 1 ? '' : 's'}. Fix them (see line, column and hint) and validate again.`;
  const q = r.quality;
  return q ? `Valid ${r.type} diagram. Layout ${q.verdict} (score ${q.score}, ${q.crossings} crossings).${q.suggestions.length ? ' Suggestions below.' : ''}` : `Valid ${r.type} diagram.`;
}

export function createServer(cwd = process.cwd()): McpServer {
  const server = new McpServer({ name: 'cartography', version }, { instructions });

  server.registerTool(
    'list_types',
    {
      title: 'List diagram types',
      description: 'Lists the Cartography diagram types with what each is for. Call this first to pick the type that fits what the user wants to draw.',
      annotations: { readOnlyHint: true },
    },
    safely(() => json(listTypes())),
  );

  server.registerTool(
    'get_schema',
    {
      title: 'Get a type schema',
      description: 'Returns the JSON Schema for a diagram type, its starter template and a fuller example. Read it before writing YAML: unknown fields and kinds are errors.',
      inputSchema: { type: typeId },
      annotations: { readOnlyHint: true },
    },
    safely(({ type }) => {
      const s = getSchema(type);
      return {
        content: [
          { type: 'text', text: `JSON Schema for type "${s.type}" (${s.name}):\n${JSON.stringify(s.schema)}` },
          { type: 'text', text: `Template (what new_diagram returns):\n${s.template}` },
          ...(s.example ? [{ type: 'text' as const, text: `Example (${s.example.file}), for style and structure; do not copy its content:\n${s.example.yaml}` }] : []),
        ],
      };
    }),
  );

  server.registerTool(
    'new_diagram',
    {
      title: 'New diagram from template',
      description: 'Returns the starter YAML for a type: a small, valid diagram to edit rather than writing from scratch.',
      inputSchema: { type: typeId },
      annotations: { readOnlyHint: true },
    },
    safely(({ type }) => ({ content: [{ type: 'text', text: newDiagram(type) }] })),
  );

  server.registerTool(
    'validate',
    {
      title: 'Validate a diagram',
      description:
        'Checks diagram YAML against its type schema and references, and lays it out to measure quality. Returns problems (line, column, message, hint) and, when valid, layout quality: crossings, lines through boxes, label overlaps, bends, empty space, aspect, a score (lower is better) and concrete suggestions. Fix all errors, apply suggestions that fit, validate again, then render.',
      inputSchema: source,
      annotations: { readOnlyHint: true },
    },
    safely(async (args) => {
      const r = await validateDiagram(args, cwd);
      return { content: [{ type: 'text', text: summary(r) }, ...json(r).content] };
    }),
  );

  server.registerTool(
    'render',
    {
      title: 'Render a diagram',
      description:
        'Renders diagram YAML to SVG or PNG. With "path", writes the file (relative to the working directory, or absolute) and returns where. A PNG also comes back as an image so you can look at the result; an SVG without a path comes back as text. Validate first: invalid diagrams are not rendered.',
      inputSchema: {
        ...source,
        format: z.enum(['svg', 'png']).optional().describe('Default: from the path extension, else svg'),
        theme: z.enum(themeNames).optional().describe('A built-in look. Default survey; also survey-dark, survey-cool, transit, drafting, classic and their dark versions'),
        path: z.string().optional().describe('Output file, e.g. docs/architecture.svg. The extension is added when missing.'),
        scale: z.number().min(0.5).max(4).optional().describe('PNG pixel density, default 2'),
        ...drawnArgs,
      },
    },
    safely(async (args) => {
      const r = await renderDiagram(args, cwd);
      const { png, svg, ...rest } = r;
      if (!r.ok) return { isError: true, content: [{ type: 'text', text: summary(r) }, ...json(rest).content] };
      const head = `${r.path ? `Wrote ${r.path}` : `Rendered ${r.format.toUpperCase()}`} (${r.width}×${r.height}).`;
      return {
        content: [
          { type: 'text', text: `${head} ${summary(r)}` },
          ...json(rest).content,
          ...(png ? [{ type: 'image' as const, data: png.toString('base64'), mimeType: 'image/png' }] : []),
          ...(svg ? [{ type: 'text' as const, text: svg }] : []),
        ],
      };
    }),
  );

  server.registerTool(
    'edit_diagram',
    {
      title: 'Edit a diagram',
      description:
        'Changes a diagram by YAML path: everything you do not touch keeps its exact text, comments included. An id you rename takes its pins (<name>.layout.json) along. The result is validated and laid out before anything is written: when it does not validate, nothing is written and you get the problems; otherwise the file is written and you get the layout quality. With "yaml" instead of "file", the new YAML comes back. Prefer this to rewriting a file. When the user has the diagram open in an editor, propose is the friendlier way: they see the change and accept it.',
      inputSchema: { ...source, edits, dryRun: z.boolean().optional().describe('Check and lay out, but write nothing; the new YAML comes back') },
      annotations: { destructiveHint: false, idempotentHint: false },
    },
    safely(async (args) => {
      const r = await editDiagram(args, cwd);
      if (r.error) return failed(r.error);
      const { yaml, ...rest } = r;
      const head = !r.ok ? `Not written: the change does not validate. ${summary(r)}` : r.written ? `Wrote ${r.written}${r.pins ? ` and ${r.pins}` : ''}. ${summary(r)}` : summary(r);
      return { ...(r.ok ? {} : { isError: true }), content: [{ type: 'text', text: head }, ...json(rest).content, ...(yaml && (!r.written || !r.ok) ? [{ type: 'text' as const, text: yaml }] : [])] };
    }),
  );

  server.registerTool(
    'describe',
    {
      title: 'Describe a diagram',
      description: 'The diagram in words (Markdown): what is in it, how it is grouped and what talks to what, as carto describe writes it. Use it to read a diagram you did not write, or to check that the drawing says what the user meant.',
      inputSchema: { ...source, ...drawnArgs },
      annotations: { readOnlyHint: true },
    },
    safely(async (args) => {
      const r = await describeDiagram(args, cwd);
      return r.ok ? { content: [{ type: 'text', text: r.text! }] } : { isError: true, content: [{ type: 'text', text: summary({ ...r, ok: false }) }, ...json(r).content] };
    }),
  );

  server.registerTool(
    'review',
    {
      title: 'Review a diagram',
      description: 'Runs the architecture review rules (as carto review): single points of failure, unencrypted lines, missing owners and the like, with the file\'s own review: settings. Each finding has a rule, a severity, what it is about, the line and how to fix it.',
      inputSchema: { ...source, view: drawnArgs.view, packs: z.array(z.string()).optional().describe('Only these rule packs, e.g. ["security"]') },
      annotations: { readOnlyHint: true },
    },
    safely(async (args) => {
      const r = await reviewDiagram(args, cwd);
      if (!r.ok) return { isError: true, content: [{ type: 'text', text: summary({ ...r, ok: false }) }, ...json(r).content] };
      const n = r.findings!.length;
      return { content: [{ type: 'text', text: r.off ? 'The file says review: off.' : `${n} finding${n === 1 ? '' : 's'}.` }, ...json(r).content] };
    }),
  );

  server.registerTool(
    'threats',
    {
      title: 'Threat model',
      description: 'The diagram\'s threat model as Markdown (as carto threats): trust boundaries, the lines that cross them and the threats written on elements and lines.',
      inputSchema: { ...source, view: drawnArgs.view },
      annotations: { readOnlyHint: true },
    },
    safely(async (args) => {
      const r = await threatsOf(args, cwd);
      return r.ok ? { content: [{ type: 'text', text: r.markdown! }] } : { isError: true, content: [{ type: 'text', text: summary({ ...r, ok: false }) }, ...json(r).content] };
    }),
  );

  server.registerTool(
    'diff',
    {
      title: 'Compare two versions',
      description: 'What changed between two versions of a diagram, element by element and in sentences (as carto diff): a file against another file ("before"), or against itself at a git commit, branch or tag ("ref", e.g. HEAD or main).',
      inputSchema: {
        file: z.string().describe('The newer version'),
        before: z.string().optional().describe('The older version, another file'),
        ref: z.string().optional().describe('Or: the same file at this git ref'),
        view: drawnArgs.view,
      },
      annotations: { readOnlyHint: true },
    },
    safely(async (args) => {
      const r = await diffDiagrams(args, cwd);
      return { content: [{ type: 'text', text: `${args.file} against ${r.against}: ${r.summary}` }, ...json(r).content] };
    }),
  );

  server.registerTool(
    'trace',
    {
      title: 'Trace a request',
      description: 'The routes a request takes through the diagram (as carto trace): from one element to another, from one element until each call ends (no "to"), or along the diagram\'s steps. Elements are named by id or label.',
      inputSchema: { ...source, from: z.string().optional(), to: z.string().optional(), steps: z.boolean().optional().describe('Follow the diagram\'s steps instead'), view: drawnArgs.view },
      annotations: { readOnlyHint: true },
    },
    safely(async (args) => {
      const r = await traceDiagram(args, cwd);
      return r.ok ? json(r) : { isError: true, content: [{ type: 'text', text: r.error ?? 'The diagram has errors.' }, ...json(r).content] };
    }),
  );

  server.registerTool(
    'import_mermaid',
    {
      title: 'Import Mermaid',
      description: 'Converts a Mermaid diagram (flowchart/graph, stateDiagram, architecture-beta, erDiagram, sequenceDiagram, gitGraph, gantt, timeline, journey) to Cartography YAML, with warnings for what could not be carried over. Validate the result before rendering.',
      inputSchema: { text: z.string().describe('The Mermaid source, without the ``` fence') },
      annotations: { readOnlyHint: true },
    },
    safely(({ text }) => {
      const r = importMermaidText(text);
      if (!r.yaml) return failed(r.warnings.join('\n') || 'Nothing could be imported');
      return { content: [{ type: 'text', text: r.yaml }, ...(r.warnings.length ? [{ type: 'text' as const, text: `Warnings:\n${r.warnings.map((w) => `- ${w}`).join('\n')}` }] : [])] };
    }),
  );

  server.registerResource('types', 'cartography://types', { title: 'Diagram types', description: 'Every diagram type with what it is for', mimeType: 'application/json' }, (uri) => ({
    contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(listTypes(), null, 2) }],
  }));

  server.registerResource(
    'schema',
    new ResourceTemplate('cartography://schema/{type}', {
      list: () => ({ resources: types.map((t) => ({ uri: `cartography://schema/${t.id}`, name: `${t.name} schema`, mimeType: 'application/schema+json' })) }),
      complete: { type: (v) => types.map((t) => t.id).filter((id) => id.startsWith(v)) },
    }),
    { title: 'Type schema', description: 'JSON Schema of one diagram type', mimeType: 'application/schema+json' },
    (uri, { type }) => {
      const t = findType(String(type));
      if (!t) throw new Error(`Unknown type "${String(type)}"`);
      return { contents: [{ uri: uri.href, mimeType: 'application/schema+json', text: JSON.stringify(t.schema, null, 2) }] };
    },
  );

  server.registerPrompt(
    'create-diagram',
    {
      title: 'Create a diagram',
      description: 'Guides you from "what do you want to draw?" to a validated, rendered Cartography diagram.',
      argsSchema: { what: z.string().optional().describe('What the diagram should show, if already known') },
    },
    ({ what }) => ({ messages: [{ role: 'user', content: { type: 'text', text: createPrompt(what) } }] }),
  );

  return server;
}

/** The questions behind the editor's "Describe it", per type, so the conversation gathers what a good diagram needs. */
export function createPrompt(what?: string): string {
  const perType = types
    .map((t) => {
      const qs = questionsFor(t).map((q) => `   - ${q.label}${q.options && q.kind === 'choice' ? ` (${q.options.join(' / ')})` : ''}`);
      return `- ${t.id} (${t.name}): ${t.description}\n${qs.join('\n')}`;
    })
    .join('\n');
  return `Help me make a Cartography diagram.${what ? `\n\nWhat it should show: ${what}` : ''}

1. ${what ? 'From what I said, pick' : 'Ask me what I want to draw, then pick'} the diagram type that fits best (call list_types). Say which type and why in one sentence.
2. Ask me only the questions for that type that I have not answered yet, in one message. Questions per type:
${perType}
3. Call get_schema for the type, then write the YAML: short ids, short labels, groups for structure, line styles to tell kinds of traffic apart.
4. Call validate. Fix every error, apply the layout suggestions that fit, and validate again until it is valid with verdict "clean" or "good".
5. Call render (PNG to show me, or SVG to a path I name) and tell me in one or two lines what you drew.`;
}
