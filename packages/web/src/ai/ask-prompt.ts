// What the Ask panel sends: a fixed system prompt (cached between questions) and, per question, the
// open diagram: its YAML, its type's schema and short description, what is selected, the problems the
// engine reports and, for a review, the layout report. Nothing else leaves the browser.
import type { DiagramType, Graph, Placed } from '@cartography/core';
import { withoutBadges } from '@cartography/core';
import { measure, score } from '@cartography/layout';
import { schemaOf } from '@cartography/engine';

export const ASK_SYSTEM = `You help people with diagrams in Cartography, a diagrams-as-code editor. A diagram is one YAML file, validated against its type's JSON Schema and laid out automatically: positions never go in the YAML.

Each message gives you the open diagram: the YAML, its type and JSON Schema, which elements the user has selected (their ids), the problems the editor reports and sometimes a layout report. Then the user asks something.

When the user asks for a change, call a tool: edit_diagram for edits by path (the usual case: small or local changes, everything else keeps its exact text), or replace_diagram when most of the file changes. Never write the changed YAML in your text. The change is shown to the user as a diff to accept or reject, and you get back problems to fix if it does not validate. Write a short sentence before the tool call only when something needs saying (an assumption, a choice you made).
- Follow the schema exactly; unknown keys are errors. Ids are short, lowercase, kebab-case, and stay the same for things that stay the same: the drawing keeps their places and the user's pins.
- When something is selected, the request is about it ("split this", "put a firewall in front of it") unless it says otherwise.
- Labels are short and read well; line labels say what flows, in one or two words. Use groups for real structure.
- Do only what was asked. Do not tidy, rename or restyle anything else.

When the user asks a question (explain, review, what is missing), answer in text and do not call a tool. Be concrete and brief: short paragraphs or a list, most important first. Name elements of the diagram as [[id]] (a line as [[from -> to]]), so the user can click them; use the ids exactly as they are in the YAML. For a review (threats, single points of failure, missing monitoring, layout) say what you found, why it matters and what to change; offer to make the change, but do not make it unasked.`;

export interface AskContext {
  text: string;
  type: DiagramType;
  file?: string;
  /** Ids of the selected elements, by kind. */
  selection: { kind: 'node' | 'group' | 'edge'; id: string; label?: string }[];
  problems: string[];
  /** For a review: how the drawing lays out. */
  layout?: string;
}

/** Questions that want a review get the layout report too. */
export const isReview = (question: string) => /\b(review|threat|risk|secur|single point|spof|monitor|observab|resilien|redundan|layout|readab|check|audit|missing)/i.test(question);

/** The short description of a type: what it is for, in the type's own words. */
function typeDocs(type: DiagramType): string {
  return [`${type.name} (type: ${type.id}). ${type.description}`, type.tagline, ...(type.useWhen?.length ? [`Use it for: ${type.useWhen.join('; ')}.`] : [])].filter(Boolean).join('\n');
}

/** The first message of a conversation: everything about the diagram, then the question. */
export function contextMessage(c: AskContext, question: string): string {
  return `${diagramBlock(c, true)}\n\n${question.trim()}`;
}

/**
 * A later message: the diagram again only when it changed since it was last sent (the schema never
 * does within one conversation), and the selection and problems as they are now.
 */
export function followUpMessage(c: AskContext, question: string, changed: boolean): string {
  return `${changed ? `${diagramBlock(c, false)}\n\n` : `${situation(c)}\n\n`}${question.trim()}`;
}

function diagramBlock(c: AskContext, withSchema: boolean): string {
  const parts = [
    `<diagram${c.file ? ` file="${c.file}"` : ''}>\n${c.text.trimEnd()}\n</diagram>`,
    ...(withSchema ? [`<type>\n${typeDocs(c.type)}\n</type>`, `<schema>\n${JSON.stringify(schemaOf(c.type))}\n</schema>`] : []),
    situation(c),
  ];
  return parts.join('\n\n');
}

function situation(c: AskContext): string {
  const sel = c.selection.length ? c.selection.map((s) => `${s.kind} ${s.id}${s.label && s.label !== s.id ? ` ("${s.label}")` : ''}`).join(', ') : 'nothing (the question is about the whole diagram)';
  const lines = [`Selected: ${sel}`, `Problems: ${c.problems.length ? `\n${c.problems.map((p) => `- ${p}`).join('\n')}` : 'none'}`];
  if (c.layout) lines.push(`Layout report:\n${c.layout}`);
  return `<situation>\n${lines.join('\n')}\n</situation>`;
}

/** The layout report, as the MCP server's layout_report puts it, cut down to what the browser can measure. */
export function layoutReport(graph: Graph | undefined, placed: Placed | undefined): string | undefined {
  if (!graph || !placed || !graph.edges.length) return undefined;
  const m = measure(withoutBadges(graph), placed);
  const s = Math.round(score(m));
  const verdict = m.edgeThroughNode || m.labelOverlaps || m.crossings > 3 ? 'needs work' : m.crossings || m.voids > 0.25 || m.backward > 1 ? 'good' : 'clean';
  return [
    `- verdict: ${verdict} (score ${s}; lower is better)`,
    `- ${m.crossings} line crossings, ${m.edgeThroughNode} lines through boxes they do not connect, ${m.labelOverlaps} label overlaps`,
    `- ${m.bends} bends, ${m.backward} lines against the flow, ${Math.round(m.voids * 100)}% empty space, aspect ${m.aspect}:1, ${Math.round(m.width)}×${Math.round(m.height)}px`,
  ].join('\n');
}

/** Text with [[id]] references cut out: plain runs and the ids they name. */
export type Piece = { text: string } | { ref: string; label?: string };

export function splitRefs(text: string): Piece[] {
  const out: Piece[] = [];
  const re = /\[\[([^\]|\n]{1,120})(?:\|([^\]\n]{1,120}))?\]\]/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    out.push({ ref: m[1]!.trim(), ...(m[2] ? { label: m[2].trim() } : {}) });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

/** What a reference names in the drawing: a node, a group, or a line written "a -> b". */
export function resolveRef(ref: string, graph: Graph | undefined): { kind: 'node' | 'group' | 'edge'; id: string; label: string } | undefined {
  if (!graph) return undefined;
  const arrow = /^(.+?)\s*-+>\s*(.+)$/.exec(ref);
  if (arrow) {
    const [a, b] = [arrow[1]!.trim(), arrow[2]!.trim()];
    const e = graph.edges.find((x) => x.from.node === a && x.to.node === b);
    return e ? { kind: 'edge', id: e.id, label: `${nameOf(graph, a)} → ${nameOf(graph, b)}` } : undefined;
  }
  const n = graph.nodes.find((x) => x.id === ref);
  if (n) return { kind: 'node', id: n.id, label: nameOf(graph, n.id) };
  const g = graph.groups.find((x) => x.id === ref);
  return g ? { kind: 'group', id: g.id, label: g.label || g.id } : undefined;
}

function nameOf(graph: Graph, id: string): string {
  const s = graph.nodes.find((n) => n.id === id)?.shape;
  return (s?.kind === 'card' ? s.label : s?.kind === 'table' ? s.title : undefined) || id;
}
