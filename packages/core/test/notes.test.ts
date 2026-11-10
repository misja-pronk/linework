// Review notes: the file format (stable, merge-friendly), anchors that follow renames and survive
// deletion, the three-way merge, and that two people's notes merge cleanly in git.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  anchorFor,
  healNotes,
  mergeNotes,
  newNoteId,
  noteBlocks,
  noteLines,
  noteNumbers,
  notePlain,
  notesInView,
  notesMarkdown,
  notesPath,
  parseNotes,
  printNotes,
  renameNoteAnchors,
  resolveAnchor,
  type Graph,
  type NoteThread,
  type NotesFile,
} from '../src/index.ts';

const card = (id: string, label: string) => ({ id, path: ['nodes', id], shape: { kind: 'card' as const, label, tone: 'blue' as const } });
const graph = (nodes: [string, string][], edges: [string, string, string?][] = [], groups: [string, string][] = []): Graph => ({
  direction: 'right',
  nodes: nodes.map(([id, l]) => card(id, l)),
  groups: groups.map(([id, label]) => ({ id, label, tone: 'slate', border: 'solid', path: ['groups', id] })),
  edges: edges.map(([from, to, label], i) => ({ id: `e${i}`, from: { node: from }, to: { node: to }, ...(label ? { label } : {}), line: 'solid', start: 'none', end: 'arrow' })),
});

const thread = (id: string, over: Partial<NoteThread> = {}): NoteThread => ({
  id,
  anchor: { kind: 'node', id: 'web', label: 'Storefront' },
  status: 'open',
  author: 'Ann',
  created: `2026-11-10T09:0${id.length % 10}:00Z`,
  text: `About ${id}`,
  ...over,
});
const file = (...threads: NoteThread[]): NotesFile => ({ version: 1, threads });

describe('notes file', () => {
  it('lives next to the diagram', () => {
    expect(notesPath('docs/shop.yaml')).toBe('docs/shop.notes.json');
    expect(notesPath('shop.yml')).toBe('shop.notes.json');
  });

  it('prints keys in a fixed order and threads sorted by id, whatever order they came in', () => {
    const a = thread('b2', { replies: [{ id: 'r2', author: 'Bo', created: '2026-11-10T11:00:00Z', text: 'two' }, { id: 'r1', author: 'Bo', created: '2026-11-10T10:00:00Z', text: 'one' }] });
    const b = thread('a1', { anchor: { kind: 'edge', from: 'web', to: 'db', label: 'SQL' }, view: 'data' });
    const text = printNotes(file(a, b))!;
    expect(text).toBe(printNotes(file(b, a)));
    expect(text.indexOf('"id": "a1"')).toBeLessThan(text.indexOf('"id": "b2"'));
    expect(text.indexOf('"one"')).toBeLessThan(text.indexOf('"two"'));
    // Each thread on lines of its own, key order fixed.
    const first = JSON.parse(text).threads[0];
    expect(Object.keys(first)).toEqual(['id', 'anchor', 'view', 'status', 'author', 'created', 'text']);
    expect(parseNotes(text).notes).toEqual({ version: 1, threads: [b, { ...a, replies: [a.replies![1], a.replies![0]] }] });
  });

  it('writes nothing for no threads', () => {
    expect(printNotes(file())).toBeUndefined();
  });

  it('reads leniently: a broken thread is skipped and said', () => {
    const r = parseNotes(JSON.stringify({ version: 1, threads: [thread('a1'), { id: 'x' }, { ...thread('b2'), anchor: { kind: 'node' } }, thread('a1')] }));
    expect(r.notes.threads.map((t) => t.id)).toEqual(['a1']);
    expect(r.problems).toHaveLength(3);
    expect(parseNotes('{ nope').problems[0]).toMatch(/not valid JSON/);
    expect(parseNotes('<<<<<<< HEAD\n{}').problems[0]).toMatch(/merge-driver/);
    expect(parseNotes('').notes.threads).toEqual([]);
  });

  it('makes random ids that differ', () => {
    const ids = new Set(Array.from({ length: 200 }, newNoteId));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]{7}$/);
  });

  it('numbers threads in the order they were written, resolved ones too', () => {
    const n = noteNumbers(file(thread('zz', { created: '2026-11-10T08:00:00Z' }), thread('aa', { created: '2026-11-10T09:00:00Z', status: 'resolved' })));
    expect([n.get('zz'), n.get('aa')]).toEqual([1, 2]);
  });

  it('shows a thread in its own view, and one without a view in all', () => {
    const f = file(thread('a1'), thread('b2', { view: 'data' }));
    expect(notesInView(f, undefined).map((t) => t.id)).toEqual(['a1']);
    expect(notesInView(f, 'data').map((t) => t.id)).toEqual(['a1', 'b2']);
  });
});

describe('anchors', () => {
  const g = graph([['web', 'Storefront'], ['db', 'Orders DB']], [['web', 'db', 'SQL'], ['web', 'db', 'reads']], [['shop', 'Web shop']]);

  it('find their element, line, group or point', () => {
    expect(resolveAnchor({ kind: 'node', id: 'web' }, g)).toMatchObject({ state: 'attached', id: 'web', anchor: { label: 'Storefront' } });
    expect(resolveAnchor({ kind: 'group', id: 'shop' }, g)).toMatchObject({ state: 'attached', kind: 'group', id: 'shop' });
    expect(resolveAnchor({ kind: 'edge', from: 'web', to: 'db', label: 'reads' }, g)).toMatchObject({ state: 'attached', id: 'e1' });
    expect(resolveAnchor({ kind: 'point', x: 4, y: 5 }, g)).toEqual({ state: 'point', at: { x: 4, y: 5 } });
    expect(anchorFor(g, 'edge', 'e0')).toEqual({ kind: 'edge', from: 'web', to: 'db', label: 'SQL' });
    expect(anchorFor(g, 'node', 'db')).toEqual({ kind: 'node', id: 'db', label: 'Orders DB' });
  });

  it('follow a rename made by the builder, also on lines', () => {
    const f = file(thread('a1'), thread('b2', { anchor: { kind: 'edge', from: 'web', to: 'db' } }), thread('c3', { anchor: { kind: 'group', id: 'web' } }));
    const next = renameNoteAnchors(f, 'node', 'web', 'shopfront');
    expect(next.threads[0]!.anchor).toEqual({ kind: 'node', id: 'shopfront', label: 'Storefront' });
    expect(next.threads[1]!.anchor).toEqual({ kind: 'edge', from: 'shopfront', to: 'db' });
    // A group with the same id is another entry.
    expect(next.threads[2]!.anchor).toEqual({ kind: 'group', id: 'web' });
    expect(renameNoteAnchors(f, 'node', 'nothing', 'x')).toBe(f);
  });

  it('find an element again by its label when its id was renamed in the YAML by hand', () => {
    const renamed = graph([['front', 'Storefront'], ['db', 'Orders DB']]);
    expect(resolveAnchor({ kind: 'node', id: 'web', label: 'Storefront' }, renamed)).toMatchObject({ state: 'attached', id: 'front' });
    const healed = healNotes(file(thread('a1')), renamed, undefined);
    expect(healed.threads[0]!.anchor).toEqual({ kind: 'node', id: 'front', label: 'Storefront' });
    // Nothing to heal: the same object back.
    expect(healNotes(healed, renamed, undefined)).toBe(healed);
  });

  it('are orphaned, with the label they had, when the element is gone', () => {
    const without = graph([['db', 'Orders DB']]);
    expect(resolveAnchor({ kind: 'node', id: 'web', label: 'Storefront' }, without)).toEqual({ state: 'orphaned', was: 'Storefront' });
    expect(resolveAnchor({ kind: 'edge', from: 'web', to: 'db' }, without)).toMatchObject({ state: 'orphaned' });
    // Two elements with that label: not guessed.
    const twice = graph([['a', 'Storefront'], ['b', 'Storefront']]);
    expect(resolveAnchor({ kind: 'node', id: 'web', label: 'Storefront' }, twice).state).toBe('orphaned');
    const md = notesMarkdown(file(thread('a1')), { graph: without });
    expect(md).toContain('Storefront (orphaned: no longer in the diagram)');
  });
});

describe('text', () => {
  it('reads simple markdown, and links only to the web or mail', () => {
    const [p, item] = noteBlocks('Is **this** *right*? See `x` and [docs](https://example.com) or [evil](javascript:alert)\n- a list item');
    expect(p!.list).toBe(false);
    expect(p!.parts).toEqual([
      { text: 'Is ' },
      { text: 'this', bold: true },
      { text: ' ' },
      { text: 'right', italic: true },
      { text: '? See ' },
      { text: 'x', code: true },
      { text: ' and ' },
      { text: 'docs', href: 'https://example.com' },
      { text: ' or ' },
      { text: 'evil' },
    ]);
    expect(item).toEqual({ list: true, parts: [{ text: 'a list item' }] });
    expect(notePlain('**a**\n- b')).toEqual(['a', '• b']);
  });

  it('lists threads as markdown, open ones unless asked', () => {
    const f = file(thread('a1', { replies: [{ id: 'r', author: 'Bo', created: '2026-11-10T10:00:00Z', text: 'Agreed' }] }), thread('b22', { status: 'resolved', text: 'Done' }));
    const g = graph([['web', 'Storefront']]);
    const open = notesMarkdown(f, { graph: g, title: 'Shop' });
    expect(open).toContain('# Review notes: Shop');
    expect(open).toContain('1 open, 1 resolved');
    expect(open).toContain('## 1. Storefront');
    expect(open).toContain('> **Bo**, 2026-11-10 10:00\n> Agreed');
    expect(open).not.toContain('Done');
    expect(notesMarkdown(f, { graph: g, all: true })).toContain('Storefront — resolved');
    expect(noteLines(f, g, undefined)).toEqual(['1. Storefront — Ann: About a1', '   ↳ Bo: Agreed']);
  });
});

describe('merging', () => {
  const base = file(thread('m1'), thread('t2'));

  it('keeps both sides’ new threads and replies', () => {
    const ours = file(...base.threads, thread('a9'));
    const theirs = file(base.threads[0]!, { ...base.threads[1]!, replies: [{ id: 'r', author: 'Bo', created: '2026-11-10T12:00:00Z', text: 'ok' }] }, thread('z1'));
    const m = mergeNotes(base, ours, theirs);
    expect(m.threads.map((t) => t.id).sort()).toEqual(['a9', 'm1', 't2', 'z1']);
    expect(m.threads.find((t) => t.id === 't2')!.replies).toHaveLength(1);
  });

  it('takes a resolve from one side and an edit from the other', () => {
    const ours = file({ ...base.threads[0]!, status: 'resolved' }, base.threads[1]!);
    const theirs = file({ ...base.threads[0]!, text: 'Better words', edited: '2026-11-10T13:00:00Z' }, base.threads[1]!);
    const m = mergeNotes(base, ours, theirs).threads.find((t) => t.id === 'm1')!;
    expect(m).toMatchObject({ status: 'resolved', text: 'Better words' });
  });

  it('drops a thread deleted on one side unless the other changed it', () => {
    expect(mergeNotes(base, file(base.threads[1]!), base).threads.map((t) => t.id)).toEqual(['t2']);
    const changed = file({ ...base.threads[0]!, status: 'resolved' }, base.threads[1]!);
    expect(mergeNotes(base, file(base.threads[1]!), changed).threads.map((t) => t.id).sort()).toEqual(['m1', 't2']);
  });
});

describe('two people in git', () => {
  const git = (cwd: string, ...args: string[]) => {
    const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' });
    return { code: r.status, out: r.stdout + r.stderr };
  };

  it('each adding a note and replying to another merge without a conflict', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'carto-notes-'));
    try {
      const write = (f: NotesFile) => fs.writeFileSync(path.join(dir, 'shop.notes.json'), printNotes(f)!);
      git(dir, 'init', '-q', '-b', 'main');
      const start = file(thread('d4kq2m1'), thread('k8pz0a2'), thread('s1xw9c3'), thread('w7bn4e4'));
      write(start);
      git(dir, 'add', '.');
      git(dir, 'commit', '-qm', 'notes');
      git(dir, 'checkout', '-qb', 'ann');
      const reply = { id: 'r', author: 'Ann', created: '2026-11-10T12:00:00Z', text: 'Yes' };
      write(file(thread('b2hh7f5', { author: 'Ann' }), ...start.threads.map((t) => (t.id === 's1xw9c3' ? { ...t, replies: [reply] } : t))));
      git(dir, 'commit', '-qam', 'ann');
      git(dir, 'checkout', '-q', 'main');
      write(file(thread('p0ce5g6', { author: 'Bo' }), ...start.threads.map((t) => (t.id === 'd4kq2m1' ? { ...t, status: 'resolved' as const } : t))));
      git(dir, 'commit', '-qam', 'bo');
      const m = git(dir, 'merge', '-q', '--no-edit', 'ann');
      expect(m.code, m.out).toBe(0);
      const merged = parseNotes(fs.readFileSync(path.join(dir, 'shop.notes.json'), 'utf8'));
      expect(merged.problems).toEqual([]);
      expect(merged.notes.threads.map((t) => t.id)).toEqual(['b2hh7f5', 'd4kq2m1', 'k8pz0a2', 'p0ce5g6', 's1xw9c3', 'w7bn4e4']);
      expect(merged.notes.threads.find((t) => t.id === 'd4kq2m1')!.status).toBe('resolved');
      expect(merged.notes.threads.find((t) => t.id === 's1xw9c3')!.replies).toHaveLength(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
