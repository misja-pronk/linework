// Claude's text answers in the Ask panel: paragraphs, lists, bold and code, and [[id]] references
// as buttons that select the element in the drawing. Built as React nodes, never as HTML.
import type { ReactNode } from 'react';
import type { Graph } from '@cartography/core';
import { resolveRef, splitRefs } from './ask-prompt.ts';

export type Ref = { kind: 'node' | 'group' | 'edge'; id: string };

function inline(text: string, graph: Graph | undefined, onRef: (r: Ref) => void, key: string): ReactNode[] {
  return splitRefs(text).flatMap((p, i): ReactNode[] => {
    if ('ref' in p) {
      const r = resolveRef(p.ref, graph);
      return r
        ? [
            <button key={`${key}r${i}`} type="button" className="ref" onClick={() => onRef(r)} title={`Select ${r.label} in the drawing`}>
              {p.label ?? r.label}
            </button>,
          ]
        : [<code key={`${key}r${i}`}>{p.label ?? p.ref}</code>];
    }
    // **bold** and `code`, nothing more.
    return p.text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((s, j) =>
      s.startsWith('**') && s.endsWith('**') && s.length > 4 ? <strong key={`${key}${i}-${j}`}>{s.slice(2, -2)}</strong> : s.startsWith('`') && s.endsWith('`') && s.length > 2 ? <code key={`${key}${i}-${j}`}>{s.slice(1, -1)}</code> : s,
    );
  });
}

const ITEM = /^\s*(?:[-*•]|\d+[.)])\s+/;

/** A block's lines in runs: list items together, other lines together. */
function runs(lines: string[]): { list: boolean; lines: string[] }[] {
  const out: { list: boolean; lines: string[] }[] = [];
  for (const l of lines) {
    const list = ITEM.test(l);
    const last = out.at(-1);
    if (last && last.list === list) last.lines.push(l);
    else out.push({ list, lines: [l] });
  }
  return out;
}

export function Answer({ text, graph, onRef }: { text: string; graph: Graph | undefined; onRef(r: Ref): void }) {
  const blocks = text.split(/\n\s*\n/).filter((b) => b.trim());
  return (
    <div className="answer">
      {blocks.flatMap((b, i) =>
        runs(b.split('\n').filter((l) => l.trim())).map((r, k) => {
          const key = `${i}.${k}`;
          if (r.list) {
            const List = /^\s*\d/.test(r.lines[0]!) ? 'ol' : 'ul';
            return (
              <List key={key}>
                {r.lines.map((l, j) => (
                  <li key={j}>{inline(l.replace(ITEM, ''), graph, onRef, `${key}.${j}`)}</li>
                ))}
              </List>
            );
          }
          const head = /^#{1,4}\s+(.*)$/.exec(r.lines[0]!);
          if (head && r.lines.length === 1) return <h4 key={key}>{inline(head[1]!, graph, onRef, key)}</h4>;
          return (
            <p key={key}>
              {r.lines.map((l, j) => (
                <span key={j}>
                  {j > 0 && <br />}
                  {inline(l.replace(/^#{1,4}\s+/, ''), graph, onRef, `${key}.${j}`)}
                </span>
              ))}
            </p>
          );
        }),
      )}
    </div>
  );
}
