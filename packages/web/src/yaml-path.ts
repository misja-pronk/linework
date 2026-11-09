// Where the cursor is in block YAML, as a path of keys: what autocomplete and selection need.
// Line based on purpose: it works on half-typed documents that a parser rejects.

export interface CursorContext {
  /** Keys from the root to the map the cursor is in. List items count as '-'. */
  path: string[];
  /** Typing a key (true) or a value (false). */
  key: boolean;
  /** The key whose value is being typed. */
  valueKey?: string;
  /** Text typed so far for the current word. */
  word: string;
  from: number;
}

const indentOf = (line: string) => line.length - line.trimStart().length;

export function cursorContext(text: string, pos: number): CursorContext {
  const lineStart = text.lastIndexOf('\n', pos - 1) + 1;
  const before = text.slice(lineStart, pos);
  const wordMatch = /[\w.-]*$/.exec(before)!;
  const word = wordMatch[0];
  const from = pos - word.length;

  // Parent keys: walk up to lines with smaller indentation.
  const lines = text.slice(0, lineStart).split('\n');
  lines.pop();
  let indent = indentOf(before);
  const item = /^\s*- /.test(before);
  const path: string[] = [];
  for (let i = lines.length - 1; i >= 0 && indent > 0; i--) {
    const l = lines[i]!;
    if (!l.trim() || l.trim().startsWith('#')) continue;
    const ind = indentOf(l);
    if (ind >= indent) continue;
    const m = /^\s*(-\s+)?([\w.-]+)\s*:/.exec(l);
    if (m?.[1]) {
      // "- key: x": the cursor is in this item's map; the key is a parent only when the cursor is deeper still.
      if (indent > ind + m[1].length) path.unshift(m[2]!);
      path.unshift('-');
    } else if (/^\s*-\s/.test(l)) path.unshift('-');
    else if (m) path.unshift(m[2]!);
    indent = ind;
  }
  if (item) path.push('-');

  // Inside a flow map on this line: "web: { kind: ap|".
  const flowOpen = before.lastIndexOf('{');
  const flowClose = before.lastIndexOf('}');
  let rest = before.trimStart().replace(/^-\s+/, '');
  if (flowOpen > flowClose) {
    const owner = /([\w.-]+)\s*:\s*\{[^{]*$/.exec(before)?.[1];
    if (owner) path.push(owner);
    rest = before.slice(flowOpen + 1).split(',').pop()!.trimStart();
  } else if (/^[\w.-]+\s*:\s*\[[^\]]*$/.test(rest)) {
    // Flow list: "inputs: [orders, cus|".
    path.push(/^([\w.-]+)/.exec(rest)![1]!, '-');
    return { path, key: false, word, from };
  }
  const kv = /^([\w.-]+)\s*:\s*(.*)$/.exec(rest);
  if (kv && !kv[2]!.includes(':')) return { path, key: false, valueKey: kv[1], word, from };
  return { path, key: true, word, from };
}
