import { parseLink, safeHref as coreSafeHref } from '@linework/core';
import { render } from '@linework/engine';
import { describe, expect, it } from 'vitest';
import { describe as describeGraph, diagnosticText, escapeHtml, linkTarget, linkText, safeAttribute, safeHref } from '../src/shared.ts';

const HOSTILE = [
  'javascript:alert(1)',
  'JavaScript:alert(1)',
  '  javascript:alert(1)',
  'java\tscript:alert(1)',
  'java\nscript:alert(1)',
  'java\r\nscript:alert(1)',
  '\u0001javascript:alert(1)',
  'data:text/html,<script>alert(1)</script>',
  'vbscript:msgbox(1)',
  'file:///etc/passwd',
  'blob:https://example.com/1',
  '',
  '   ',
];
const SAFE = [
  'https://example.com/a?b=c#d',
  'http://example.com',
  'mailto:someone@example.com',
  'docs/adr-12.md',
  './other.yaml#view',
  '../up/one.html',
  '#view',
  '/absolute/path',
];

describe('links', () => {
  it('lets through http, https, mailto and relative paths, and nothing else', () => {
    for (const href of HOSTILE) expect(safeHref(href), JSON.stringify(href)).toBeUndefined();
    for (const href of SAFE) expect(safeHref(href)).toBe(href);
  });

  it('is the same rule as the one in core', () => {
    for (const href of [...HOSTILE, ...SAFE]) expect(safeHref(href)).toBe(coreSafeHref(href));
  });

  it('sorts a link into a web address, a view, another diagram or nothing', () => {
    const target = (to: string) => linkTarget(parseLink(to)!);
    expect(target('https://example.com/x')).toEqual({ kind: 'url', href: 'https://example.com/x', external: true });
    expect(target('#containers')).toEqual({ kind: 'view', view: 'containers' });
    expect(target('other.yaml')).toEqual({ kind: 'diagram', file: 'other.yaml' });
    expect(target('sub/other.yml#deployment')).toEqual({ kind: 'diagram', file: 'sub/other.yml', view: 'deployment' });
    expect(target('docs/adr-12.md')).toEqual({ kind: 'url', href: 'docs/adr-12.md', external: false });
    expect(target('javascript:alert(1)')).toEqual({ kind: 'none' });
    expect(target('data:text/html,x')).toEqual({ kind: 'none' });
  });

  it('names a link the way a reader would', () => {
    expect(linkText(parseLink('https://example.com/x')!)).toBe('example.com/x');
    expect(linkText(parseLink('#containers')!)).toBe('containers view');
    expect(linkText(parseLink({ to: 'other.yaml', label: 'Inside the shop' })!)).toBe('Inside the shop');
  });
});

describe('what goes into a page', () => {
  it('escapes text', () => {
    expect(escapeHtml(`<img src=x onerror="alert(1)"> & more`)).toBe('&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; more');
  });

  it('keeps only attributes that cannot run or fetch anything', () => {
    expect(safeAttribute('rect', 'onclick', 'alert(1)')).toBe(false);
    expect(safeAttribute('svg', 'ONLOAD', 'alert(1)')).toBe(false);
    expect(safeAttribute('a', 'href', 'javascript:alert(1)')).toBe(false);
    expect(safeAttribute('a', 'xlink:href', ' javascript:alert(1)')).toBe(false);
    expect(safeAttribute('a', 'href', 'https://example.com')).toBe(true);
    expect(safeAttribute('image', 'href', 'data:image/png;base64,AAAA')).toBe(true);
    expect(safeAttribute('image', 'href', 'data:text/html,<script>')).toBe(false);
    expect(safeAttribute('use', 'href', '#icon')).toBe(true);
    expect(safeAttribute('use', 'href', 'https://example.com/x.svg#icon')).toBe(false);
    expect(safeAttribute('rect', 'style', 'fill: url(https://example.com/x)')).toBe(false);
    expect(safeAttribute('rect', 'style', 'fill: #fff')).toBe(true);
    expect(safeAttribute('rect', 'fill', '#fff')).toBe(true);
  });

  it('says where a problem is', () => {
    expect(diagnosticText({ severity: 'error', message: 'Unknown kind', line: 12, column: 5 }, 'shop.yaml')).toBe('shop.yaml:12:5: Unknown kind');
    expect(diagnosticText({ severity: 'error', message: 'Unknown kind', line: 12, column: 5 })).toBe('12:5: Unknown kind');
    expect(diagnosticText({ severity: 'warning', message: 'No nodes' })).toBe('No nodes');
  });
});

describe('the text alternative', () => {
  it('lists the nodes and what connects them', async () => {
    const yaml = [
      'type: systems',
      'title: Web shop',
      'subtitle: System context',
      'nodes:',
      '  customer: { kind: user, label: Customer }',
      '  shop: { kind: service, label: Web shop, description: Sells things }',
      'edges:',
      '  - customer -> shop: Orders',
    ].join('\n');
    const drawn = await render(yaml, {});
    const text = JSON.stringify(describeGraph(drawn.graph!));
    for (const part of ['Web shop', 'System context', 'Customer', 'Sells things', 'Orders']) expect(text).toContain(part);
  });

  it('says of a process what its outlines show: the decision, the kind of task, the lane, the start and the end', async () => {
    const yaml = [
      'type: process',
      'lanes:',
      '  manager: Manager',
      'nodes:',
      '  Approve: { in: manager, kind: user, caption: in the portal }',
      'flow:',
      '  - start -> Ask for leave -> Enough days? -yes-> Approve -> end',
      '  - Enough days? -no-> Explain -> end',
    ].join('\n');
    const d = describeGraph((await render(yaml, {})).graph!);
    const said = (label: string) => d.elements.find((e) => e.label === label);
    expect(said('Enough days?')!.detail).toBe('decision');
    expect(said('Approve')).toMatchObject({ detail: 'user task, in the portal', in: 'Manager' });
    expect(d.elements.map((e) => e.label)).toEqual(expect.arrayContaining(['start event', 'end event']));
    expect(d.relations).toContainEqual({ from: 'Enough days?', to: 'Approve', label: 'yes' });
    expect(d.relations).toContainEqual({ from: 'start event', to: 'Ask for leave' });
  });

  it('says of a state machine where it starts, what a state does and what moves it on', async () => {
    const yaml = ['type: states', 'states:', '  Closed: { entry: lock }', 'transitions:', '  - start -> Closed -> Open: push', '  - Open -> end: "[worn out]"'].join('\n');
    const d = describeGraph((await render(yaml, {})).graph!);
    expect(d.elements.find((e) => e.label === 'Closed')!.detail).toBe('state, entry / lock');
    expect(d.relations).toEqual([
      { from: 'start', to: 'Closed', label: 'push' },
      { from: 'Closed', to: 'Open' },
      { from: 'Open', to: 'end', label: '[worn out]' },
    ]);
  });
});
