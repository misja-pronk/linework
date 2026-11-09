// Mermaid architecture-beta → systems. Groups and services map one to one; junctions only exist to
// route lines in Mermaid, so they are replaced by direct lines between their neighbours.
import { guessGroupKind, guessKind, systemsYaml, type SysEdge, type SysGroup, type SysNode } from './systems.ts';
import { cleanLabel, Ids, type Warnings } from './text.ts';

const DECL = /^(group|service|junction)\s+([\w-]+)(?:\s*\(([^)]*)\))?(?:\s*\[([^\]]*)\])?(?:\s+in\s+([\w-]+))?\s*$/;
const EDGE = /^([\w-]+)(\{group\})?\s*:\s*([LRTB])\s*(<?)-(?:\[([^\]]*)\])?-(>?)\s*([LRTB])\s*:\s*([\w-]+)(\{group\})?\s*$/;

// Mermaid's built-in icons, and words from iconify names like logos:aws-lambda.
const ICONS: Record<string, string> = { database: 'database', disk: 'storage', internet: 'external', server: 'server', cloud: 'service' };

export function importArchitecture(body: string[], title: string | undefined, warn: Warnings): string {
  const ids = new Ids();
  const groups: SysGroup[] = [];
  const nodes: SysNode[] = [];
  const junctions = new Set<string>();
  const raw: { a: string; b: string; start: boolean; end: boolean; label?: string }[] = [];

  for (const line of body) {
    const s = line.trim();
    if (!s) continue;
    const d = DECL.exec(s);
    if (d) {
      const [, what, id, icon = '', label, parent] = d;
      if (what === 'junction') {
        junctions.add(id!);
        continue;
      }
      const text = label ? cleanLabel(label) : id!;
      const iconWords = icon.replace(/^[\w-]+:/, '').replace(/-/g, ' ');
      if (what === 'group') {
        const kind = icon === 'cloud' && guessGroupKind(text, false) === 'system' ? 'cloud' : guessGroupKind(text, !!parent);
        groups.push({ id: ids.get(id!), label: text, kind, parent: parent && ids.get(parent) });
      } else nodes.push({ id: ids.get(id!), label: text, kind: guessKind(text) ?? ICONS[icon] ?? guessKind(iconWords) ?? 'service', parent: parent && ids.get(parent) });
      continue;
    }
    const e = EDGE.exec(s);
    if (e) {
      raw.push({ a: e[1]!, b: e[8]!, start: e[4] === '<', end: e[6] === '>', label: e[5] ? cleanLabel(e[5]) : undefined });
      continue;
    }
    warn.add(`Could not read "${s}"`);
  }

  // Each junction: lines from the neighbours that point into it (or the first neighbour) to the rest.
  // Repeated, so junctions joined to junctions dissolve too.
  for (let pass = 0; pass < junctions.size; pass++)
    for (const j of junctions) {
      const touching = raw.filter((r) => r.a === j || r.b === j);
      if (!touching.length) continue;
      const others = touching.map((r) => (r.a === j ? { id: r.b, into: r.start && !r.end } : { id: r.a, into: r.end }));
      const sources = others.filter((o) => o.into).map((o) => o.id);
      const from = sources.length ? sources : others.slice(0, 1).map((o) => o.id);
      const directed = touching.some((r) => r.start || r.end);
      for (const r of touching) raw.splice(raw.indexOf(r), 1);
      for (const a of from) for (const o of others) if (!from.includes(o.id)) raw.push({ a, b: o.id, start: false, end: directed });
      warn.onceFor('junction', 'Junctions are replaced by direct lines between what they join');
    }

  const edges: SysEdge[] = raw
    .filter((r) => r.a !== r.b && !junctions.has(r.a) && !junctions.has(r.b))
    .map((r) => {
      const [a, b] = r.start && !r.end ? [r.b, r.a] : [r.a, r.b];
      return { from: ids.get(a), to: ids.get(b), op: r.start && r.end ? '<->' : r.start || r.end ? '->' : '--', label: r.label };
    });
  return systemsYaml({ title, direction: 'right', groups, nodes, edges });
}
