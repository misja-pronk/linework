// The MCP surface: tools, resources and a prompt over the handlers in tools.ts. Descriptions are
// written for the model that reads them: what each tool is for and in which order to use them.
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { findType, themes, types } from '@cartography/engine';

const themeNames = Object.keys(themes) as [string, ...string[]];
import { questionsFor } from '../../web/src/ai/questions.ts';
import { getSchema, importMermaidText, listTypes, newDiagram, renderDiagram, validateDiagram, type Checked } from './tools.ts';

const version = '0.0.0';

const instructions = `Cartography turns a short YAML file into a clean architecture diagram (Azure, systems, ERD, access, GitHub, data products). Positions are automatic: never write coordinates.
Workflow: list_types → get_schema(type) → write YAML → validate → fix every error (each has line, column and a hint) and act on the layout suggestions → render.
Validate before every render; "quality.verdict" should be "clean" or "good".`;

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
