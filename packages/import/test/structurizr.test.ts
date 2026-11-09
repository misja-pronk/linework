import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { render } from '@cartography/engine';
import { importStructurizr, isStructurizr } from '../src/index.ts';

const dsl = fs.readFileSync(path.join(import.meta.dirname, 'structurizr/library.dsl'), 'utf8');

describe('importStructurizr', () => {
  const r = importStructurizr(dsl);
  const doc = parse(r.yaml);

  it('recognises a workspace', () => {
    expect(isStructurizr(dsl)).toBe(true);
    expect(isStructurizr('flowchart LR\n  a --> b\n')).toBe(false);
  });

  it('nests elements by identifier and keeps their kinds, technology and externals', () => {
    expect(r.warnings).toEqual([]);
    expect(doc.title).toBe('City Library');
    expect(doc.elements.reader).toEqual({ kind: 'person', label: 'Reader', description: 'Borrows books and e-books', external: true });
    expect(doc.elements.librarian.external).toBeUndefined();
    expect(doc.elements.mailer).toMatchObject({ kind: 'software-system', external: true });
    const parts = doc.elements.catalogue.elements;
    expect(parts.site).toMatchObject({ kind: 'web-app', technology: 'React' });
    expect(parts.db).toMatchObject({ kind: 'database', technology: 'PostgreSQL' });
    expect(parts.api.elements.loans).toMatchObject({ kind: 'component', technology: 'Ktor' });
  });

  it('turns relationships, inner ones included, into dotted paths', () => {
    expect(doc.relations).toContainEqual({ 'catalogue.api.loans -> catalogue.api.stock': 'Checks availability' });
    expect(doc.relations).toContainEqual({ 'catalogue.site -> catalogue.api': { label: 'Calls', technology: 'JSON/HTTPS' } });
    expect(doc.relations).toContainEqual({ 'reader -> catalogue.site': { label: 'Searches and borrows', technology: 'HTTPS' } });
  });

  it('maps the views, and every one renders cleanly', async () => {
    expect(Object.keys(doc.views)).toEqual(['landscape', 'context', 'containers', 'components', 'borrow', 'live']);
    expect(doc.views.landscape).toMatchObject({ kind: 'landscape', enterprise: 'City Library', direction: 'right' });
    expect(doc.views.components).toMatchObject({ kind: 'component', of: 'catalogue.api' });
    expect(doc.views.borrow.steps).toHaveLength(3);
    expect(doc.views.live.nodes.cloud.nodes['app-server']).toMatchObject({ technology: 'Ubuntu 24.04', count: 2, instances: ['catalogue.api', 'catalogue.site'] });
    expect(doc.views.live.nodes.cloud.nodes['load-balancer']).toMatchObject({ kind: 'infrastructure' });
    for (const view of Object.keys(doc.views)) {
      const out = await render(r.yaml, { fonts: 'none', view });
      expect(out.diagnostics, view).toEqual([]);
    }
  });
});
