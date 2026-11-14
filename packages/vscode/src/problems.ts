// The engine's diagnostics as an editor wants them: zero-based ranges, and the fixes the message
// itself already names (the allowed values, quotes around a label). The words stay the CLI's.
import { isMap, isScalar, isSeq, parseDocument } from 'yaml';
import type { Diagnostic, Path } from '@linework/core';

export interface Position {
  line: number;
  character: number;
}

export interface Fix {
  title: string;
  /** Offsets of the text to replace (equal: insert). */
  from: number;
  to: number;
  text: string;
  /** The one to apply with a single key press. */
  preferred?: boolean;
}

export interface Problem {
  start: Position;
  end: Position;
  severity: Diagnostic['severity'];
  message: string;
  fixes: Fix[];
}

/** Offsets to zero-based line/character, from a table of line starts. */
export function lineIndex(text: string): (offset: number) => Position {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return (offset) => {
    const o = Math.max(0, Math.min(offset, text.length));
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid]! <= o) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo, character: o - starts[lo]! };
  };
}

export function toProblems(text: string, diagnostics: readonly Diagnostic[]): Problem[] {
  const at = lineIndex(text);
  const seen = new Set<string>();
  const out: Problem[] = [];
  for (const d of diagnostics) {
    // The same problem found in several views is one problem (as `linework validate` prints it).
    const key = `${d.line}:${d.column}:${d.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    let start: Position;
    let end: Position;
    if (d.from != null) {
      start = at(d.from);
      end = at(Math.max(d.from, d.to ?? d.from));
    } else if (d.line != null) {
      start = { line: d.line - 1, character: Math.max(0, (d.column ?? 1) - 1) };
      end = start;
    } else {
      start = { line: 0, character: 0 };
      end = start;
    }
    // Nothing to underline: the rest of the line, so the squiggle can be seen.
    if (end.line === start.line && end.character <= start.character) {
      const line = text.split('\n')[start.line] ?? '';
      end = { line: start.line, character: Math.max(start.character + 1, line.length) };
    }
    out.push({ start, end, severity: d.severity, message: d.message, fixes: fixesFor(text, d) });
  }
  return out;
}

/** Edit distance, for putting the closest allowed value first. */
export function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const was = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1]!.toLowerCase() === b[j - 1]!.toLowerCase() ? 0 : 1));
      prev = was;
    }
  }
  return row[b.length]!;
}

/** The scalar value at a path: its offsets and text, when it is written as a plain value. */
function valueAt(text: string, path: Path): { from: number; to: number; value: string } | undefined {
  const doc = parseDocument(text);
  let node: unknown = doc.contents;
  for (const key of path) {
    if (isMap(node)) node = node.items.find((p) => isScalar(p.key) && String(p.key.value) === String(key))?.value;
    else if (isSeq(node) && typeof key === 'number') node = node.items[key];
    else return undefined;
  }
  if (!isScalar(node) || !node.range) return undefined;
  return { from: node.range[0], to: node.range[1], value: String(node.value ?? '') };
}

const MAX_CHOICES = 3;

function choicesFix(text: string, path: Path, choices: string[]): Fix[] {
  const v = valueAt(text, path);
  if (!v) return [];
  const ranked = choices.map((c, i) => ({ c, d: distance(v.value, c), i })).sort((a, b) => a.d - b.d || a.i - b.i);
  return ranked.slice(0, MAX_CHOICES).map(({ c }, i) => ({ title: `Change to "${c}"`, from: v.from, to: v.to, text: /^[\w./-]+$/.test(c) ? c : JSON.stringify(c), ...(i === 0 ? { preferred: true } : {}) }));
}

/** Fixes the message already says: the allowed values, the type to add, the quotes a label needs. */
export function fixesFor(text: string, d: Diagnostic): Fix[] {
  const unknownType = /^Unknown type "(.*)", use one of: (.+) \(or model\)$/.exec(d.message);
  if (unknownType) return choicesFix(text, ['type'], unknownType[2]!.split(', '));
  const oneOf = /must be one of: ([^(]+?)(?: \(did you mean .*\))?$/.exec(d.message);
  if ((d.choices || oneOf) && d.path) return choicesFix(text, d.path, d.choices ?? oneOf![1]!.split(', '));
  const noType = /^Add "type:" at the top, one of: (.+?) \(or model\)$/.exec(d.message);
  if (noType) {
    const first = noType[1]!.split(', ')[0]!;
    return [{ title: `Add "type: ${first}" at the top`, from: 0, to: 0, text: `type: ${first}\n`, preferred: true }];
  }
  if (d.message.startsWith('Text that starts with [ ] and goes on after it needs quotes') && d.from != null) {
    const lineStart = text.lastIndexOf('\n', d.from - 1) + 1;
    const lineEnd = text.indexOf('\n', lineStart);
    const line = text.slice(lineStart, lineEnd < 0 ? text.length : lineEnd);
    const m = /:\s+(\[[^\]]*\]\s*[^\s#][^#]*?)\s*(#.*)?$/.exec(line);
    if (!m) return [];
    const from = lineStart + m.index + m[0].indexOf(m[1]!);
    return [{ title: 'Put the text in quotes', from, to: from + m[1]!.length, text: JSON.stringify(m[1]), preferred: true }];
  }
  return [];
}
