// carto notes, validate's orphaned-note warning, render --notes and the git merge driver.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parseNotes, printNotes, type NoteThread } from '@cartography/core';

const root = path.resolve(import.meta.dirname, '../../..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'carto-notes-cli-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

function carto(...args: string[]) {
  const r = spawnSync(path.join(root, 'node_modules/.bin/tsx'), [path.join(root, 'packages/cli/src/main.ts'), ...args], { cwd: tmp, encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
}
const write = (name: string, text: string) => fs.writeFileSync(path.join(tmp, name), text);
const read = (name: string) => fs.readFileSync(path.join(tmp, name), 'utf8');

const shop = `type: systems
title: Shop
nodes:
  web: { kind: client, label: Storefront }
  api: { kind: service, label: Orders }
edges:
  - web -> api: { label: REST }
`;
const t = (id: string, over: Partial<NoteThread> = {}): NoteThread => ({ id, anchor: { kind: 'node', id: 'api', label: 'Orders' }, status: 'open', author: 'Ann', created: '2026-11-10T09:00:00Z', text: `Note ${id}`, ...over });
const notes = printNotes({
  version: 1,
  threads: [
    t('a1', { text: 'Is **Orders** one service?' }),
    t('b2', { anchor: { kind: 'edge', from: 'web', to: 'api', label: 'REST' }, created: '2026-11-10T09:10:00Z', status: 'resolved', text: 'gRPC?' }),
    t('c3', { anchor: { kind: 'node', id: 'cache', label: 'Redis cache' }, created: '2026-11-10T09:20:00Z', text: 'Removed?' }),
  ],
})!;

describe('carto notes', () => {
  write('shop.yaml', shop);
  write('shop.notes.json', notes);

  it('lists open threads as markdown, all with --all', () => {
    const r = carto('notes', 'shop.yaml');
    expect(r.code).toBe(0);
    expect(r.out).toContain('# Review notes: Shop');
    expect(r.out).toContain('## 1. Orders');
    expect(r.out).toContain('## 3. Redis cache (orphaned: no longer in the diagram)');
    expect(r.out).not.toContain('gRPC');
    expect(carto('notes', 'shop.yaml', '--all').out).toContain('## 2. Storefront → Orders — resolved');
    expect(carto('notes', 'shop.yaml', '-o', 'notes.md').code).toBe(0);
    expect(read('notes.md')).toContain('Is **Orders** one service?');
  }, 60_000);

  it('says when there are no notes', () => {
    write('bare.yaml', shop);
    expect(carto('notes', 'bare.yaml').err).toMatch(/no review notes/);
  }, 60_000);

  it('validate warns about notes whose element is gone, without failing', () => {
    const r = carto('validate', 'shop.yaml');
    expect(r.code).toBe(0);
    expect(r.err).toMatch(/shop\.notes\.json {2}warning {2}note c3 \(open\) is about "Redis cache", which is no longer in the diagram/);
  }, 60_000);

  it('render --notes adds markers and the notes; a plain render has none', () => {
    expect(carto('render', 'shop.yaml', '-o', 'plain.svg').code).toBe(0);
    expect(read('plain.svg')).not.toContain('data-note');
    const r = carto('render', 'shop.yaml', '--notes', '-o', 'noted.svg');
    expect(r.code).toBe(0);
    const svg = read('noted.svg');
    expect(svg).toContain('data-note="1"');
    expect(svg).not.toContain('data-note="2"'); // resolved: not on paper
    expect(svg).toContain('Review notes');
    expect(svg).toContain('Redis cache (no longer in the diagram)');
    expect(Number(/height="(\d+)"/.exec(svg)![1])).toBeGreaterThan(Number(/height="(\d+)"/.exec(read('plain.svg'))![1]));
    expect(carto('render', 'shop.yaml', '--notes', '-o', 'noted.pptx').code).toBe(0);
    expect(carto('render', 'shop.yaml', '--notes', '-o', 'noted.pdf').code).toBe(0);
  }, 60_000);

  it('merges as git merge driver', () => {
    write('base.json', notes);
    const parsed = parseNotes(notes).notes;
    write('ours.json', printNotes({ version: 1, threads: [...parsed.threads, t('a0', { author: 'Bo' })] })!);
    write('theirs.json', printNotes({ version: 1, threads: [...parsed.threads.map((x) => (x.id === 'a1' ? { ...x, status: 'resolved' as const } : x)), t('a05', { author: 'Cy' })] })!);
    const r = carto('notes', '--merge-driver', 'base.json', 'ours.json', 'theirs.json');
    expect(r.code, r.err).toBe(0);
    const merged = parseNotes(read('ours.json')).notes;
    expect(merged.threads.map((x) => x.id)).toEqual(['a0', 'a05', 'a1', 'b2', 'c3']);
    expect(merged.threads.find((x) => x.id === 'a1')!.status).toBe('resolved');
    write('broken.json', '<<<<<<< HEAD\n');
    expect(carto('notes', '--merge-driver', 'base.json', 'broken.json', 'theirs.json').code).toBe(1);
  }, 60_000);
});
