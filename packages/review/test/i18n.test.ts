// The review in Dutch: the catalog is whole and in use, every rule has its Dutch, and a drawing with
// `lang: nl` gets its findings, rules and report in Dutch while English stays as it was.
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { render } from '@cartography/engine';
import { badMessages, sourceText, unusedIds } from '@cartography/i18n/lint';
import { builtInIds, builtInRules, emptyConfig, htmlReport, markdownReport, readConfig, review, summaryGraph, type Report } from '../src/index.ts';
import { nl } from '../src/nl.ts';

const src = path.resolve(import.meta.dirname, '../src');

const shop = `type: azure
title: Webwinkel
subtitle: Productie
nodes:
  users: users
  web: { kind: app-service, label: Winkel }
  api: { kind: container-app, label: Orders API }
  db: { kind: sql-database, label: Orders, public: true }
  files: { kind: storage, label: Bestanden, public: true }
groups:
  vnet: { kind: vnet, label: vnet-shop }
  apps: { kind: subnet, label: snet-apps, in: vnet }
edges:
  - users -> web: { style: public }
  - web -> api
  - api -> db: { label: SQL }
  - api -> files
`;

async function reviewed(yaml: string, opts: Parameters<typeof review>[2] = {}) {
  const r = await render(yaml, { fonts: 'none' });
  return { r, out: review(yaml, r, opts) };
}

describe('the review catalog', () => {
  it('has the placeholders and plural forms of its English', () => {
    expect(badMessages(nl)).toEqual([]);
  });
  it('has no ids the review does not say', () => {
    expect(unusedIds(nl, sourceText([src], (f) => f.endsWith('nl.ts')))).toEqual([]);
  });
  it('has Dutch for every rule', () => {
    const missing = builtInRules.flatMap((r) => [r.title, r.why, r.fix, ...(r.docs ? [r.docs] : [])].filter((s) => !(s in nl)).map((s) => `${r.id}: ${s}`));
    expect(missing).toEqual([]);
  });
});

describe('a drawing with lang: nl', () => {
  it('gets Dutch findings and rules, and English stays English', async () => {
    const en = await reviewed(shop);
    const du = await reviewed(`lang: nl\n${shop}`);
    expect(du.r.lang).toBe('nl');
    expect(du.out.findings.map((f) => f.rule.id)).toEqual(en.out.findings.map((f) => f.rule.id));
    const messages = du.out.findings.map((f) => f.message);
    expect(messages).toContain('Winkel wordt vanaf Gebruikers bereikt zonder WAF ervoor');
    expect(messages).toContain('Bestanden staat publieke toegang toe');
    expect(messages).toContain('Orders is publiek, in een ontwerp met een virtueel netwerk');
    const waf = du.out.findings.find((f) => f.rule.id === 'azure.public-without-waf')!;
    expect(waf.rule.title).toBe('Publieke endpoints staan achter een WAF');
    expect(du.out.rules.every((r) => r.title === nl[builtInRules.find((x) => x.id === r.id)!.title as keyof typeof nl])).toBe(true);
    expect(en.out.findings.find((f) => f.rule.id === 'azure.public-without-waf')!.rule.title).toBe('Public endpoints sit behind a WAF');
    // A finding about the whole design.
    expect(du.out.findings.find((f) => f.on.kind === 'diagram')?.about ?? 'het diagram').toBe('het diagram');
  });

  it('can be asked for in the options too', async () => {
    const { out } = await reviewed(shop, { lang: 'nl' });
    expect(out.findings.some((f) => f.message === 'Bestanden staat publieke toegang toe')).toBe(true);
  });

  it("says a customer's rule in Dutch, its own title as written", async () => {
    const config = readConfig(
      `custom:
  - id: acme.db-backup
    title: Elke database heeft een backup
    every: { kind: sql-database }
    must: { tag: backup }
  - id: acme.monitor
    title: Er is monitoring
    exists: { kind: [log-analytics, monitor] }`,
      'rules.yaml',
      builtInIds,
      emptyConfig(),
    ).config;
    const { out } = await reviewed(`lang: nl\n${shop}`, { config });
    const custom = out.findings.filter((f) => f.rule.id.startsWith('acme.')).sort((a, b) => a.rule.id.localeCompare(b.rule.id));
    expect(custom.map((f) => f.message)).toEqual(['Orders hoort tag backup te hebben', 'Niets hier heeft kind log-analytics of monitor']);
    expect(custom[0]!.rule.title).toBe('Elke database heeft een backup');
    expect(custom[0]!.rule.why).toBe('Een regel van deze organisatie.');
  });

  it('writes the report in Dutch', async () => {
    const { out } = await reviewed(`lang: nl\n${shop}`);
    const report: Report = { title: 'Webwinkel', files: [{ file: 'shop.yaml', title: 'Webwinkel', type: 'azure', findings: out.findings, drawings: [], problems: [] }], rules: out.rules, config: [], date: new Date('2026-11-10'), lang: 'nl' };
    const md = markdownReport(report);
    expect(md).toContain('bevindingen in het diagram:');
    expect(md).toContain('| Pijler | Fouten | Waarschuwingen | Info |');
    expect(md).toContain('### Beveiliging');
    expect(md).toContain('*Waarom:*');
    expect(md).toContain('Beoordeeld op 2026-11-10.');
    expect(md).not.toMatch(/\b(Why|Fix|About|Rules|Pillar|Security|Warning)\b/);
    const html = htmlReport(report);
    expect(html).toContain('<html lang="nl">');
    expect(html).toContain('Architectuurreview');
    expect(html).toContain('<dt>Oplossing</dt>');
    expect(html).not.toMatch(/>(Why|Fix|Read|Pillar|Errors|Warnings|Summary)</);
    const g = summaryGraph(report);
    const m = g.nodes[0]!.shape;
    expect(m.kind === 'matrix' && m.corner).toBe('Pijler');
    expect(m.kind === 'matrix' && m.rows.map((r) => r.label)).toContain('Betrouwbaarheid');
  });
});
