// The YAML side of a proposed change, in the web editor and the VS Code preview: a line diff with a
// few lines of context around each change, the rest folded. Diagrams are small, so a plain longest-common-subsequence table is fast enough.

export type YamlDiffLine = { kind: 'same' | 'add' | 'del'; text: string; old?: number; new?: number } | { kind: 'fold'; count: number };

export function yamlDiff(before: string, after: string, context = 3): YamlDiffLine[] {
  const a = before.replace(/\n$/, '').split('\n');
  const b = after.replace(/\n$/, '').split('\n');
  // Common start and end first: most changes are local, and the table stays small.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let end = 0;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
  const x = a.slice(start, a.length - end);
  const y = b.slice(start, b.length - end);
  const lines: YamlDiffLine[] = a.slice(0, start).map((text, i) => ({ kind: 'same', text, old: i + 1, new: i + 1 }));
  if (x.length * y.length > 4_000_000) {
    // Too big to align: all of it out, all of it in.
    x.forEach((text, i) => lines.push({ kind: 'del', text, old: start + i + 1 }));
    y.forEach((text, i) => lines.push({ kind: 'add', text, new: start + i + 1 }));
  } else {
    const w = y.length + 1;
    const t = new Uint32Array((x.length + 1) * w);
    for (let i = x.length - 1; i >= 0; i--) for (let j = y.length - 1; j >= 0; j--) t[i * w + j] = x[i] === y[j] ? t[(i + 1) * w + j + 1]! + 1 : Math.max(t[(i + 1) * w + j]!, t[i * w + j + 1]!);
    let [i, j] = [0, 0];
    while (i < x.length || j < y.length) {
      if (i < x.length && j < y.length && x[i] === y[j]) lines.push({ kind: 'same', text: x[i]!, old: start + ++i, new: start + ++j });
      else if (j < y.length && (i === x.length || t[i * w + j + 1]! >= t[(i + 1) * w + j]!)) lines.push({ kind: 'add', text: y[j]!, new: start + ++j });
      else lines.push({ kind: 'del', text: x[i]!, old: start + ++i });
    }
  }
  const tail = a.length - end;
  a.slice(tail).forEach((text, k) => lines.push({ kind: 'same', text, old: tail + k + 1, new: b.length - end + k + 1 }));
  return fold(lines, context);
}

/** Unchanged runs longer than twice the context fold to a count. */
function fold(lines: YamlDiffLine[], context: number): YamlDiffLine[] {
  const changed = lines.map((l) => l.kind === 'add' || l.kind === 'del');
  const near = lines.map((_, i) => changed.slice(Math.max(0, i - context), i + context + 1).some(Boolean));
  const out: YamlDiffLine[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (near[i]) out.push(lines[i]!);
    else {
      let n = 0;
      while (i < lines.length && !near[i]) [n, i] = [n + 1, i + 1];
      i--;
      out.push({ kind: 'fold', count: n });
    }
  }
  return out;
}
