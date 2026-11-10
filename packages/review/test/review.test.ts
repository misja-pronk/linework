// The review around the rules: numbering, severities and packs, findings set aside on the element,
// in the file and in rules.yaml, customer rules, the YAML edit that sets one aside, and the reports.
import { describe, expect, it } from 'vitest';
import { render } from '@cartography/engine';
import { builtInIds, emptyConfig, htmlReport, ignoreFinding, markdownReport, readConfig, review, summaryGraph, type ReviewConfig } from '../src/index.ts';

const shop = `type: azure
title: Shop
subtitle: Production
groups:
  dmz: { kind: subnet, label: DMZ }
  data: { kind: subnet, label: Data }
nodes:
  users: users
  web: { kind: app-service, label: Web, in: dmz }
  db: { kind: sql-database, label: Orders, in: data, tags: [backup] }
  db2: { kind: sql-database, label: Archive, in: dmz }
edges:
  - users -> web: { style: public }
  - web -> db: SQL
  - web -> db2: SQL
`;

async function run(yaml: string, config?: ReviewConfig, packs?: string[]) {
  const r = await render(yaml, { fonts: 'none' });
  expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  return review(yaml, r, { config, packs });
}

describe('review', () => {
  it('numbers findings worst first and places them on a line', async () => {
    const out = await run(shop);
    const live = out.findings.filter((f) => !f.ignored);
    expect(live.map((f) => f.id)).toEqual(live.map((_, i) => `R${i + 1}`));
    const waf = live.find((f) => f.rule.id === 'azure.public-without-waf')!;
    expect(waf.on).toEqual({ kind: 'edge', id: 'e0' });
    expect(waf.ends).toEqual({ from: 'users', to: 'web' });
    expect(waf.line).toBe(13);
    expect(waf.about).toBe('Users → Web');
  });

  it('runs only the packs asked for', async () => {
    const out = await run(shop, undefined, ['systems']);
    expect(out.findings).toEqual([]);
    expect(out.rules.every((r) => r.pack === 'systems')).toBe(true);
  });

  it('sets aside on the element, in the file and with review: off', async () => {
    const inline = shop.replace('web: { kind: app-service, label: Web, in: dmz }', 'web: { kind: app-service, label: Web, in: dmz, review: { ignore: [{ rule: azure.secrets-without-key-vault, reason: Uses managed identity } ] } }');
    const a = (await run(inline)).findings.find((f) => f.rule.id === 'azure.secrets-without-key-vault')!;
    expect(a.ignored).toEqual({ where: 'element', reason: 'Uses managed identity' });
    expect(a.id).toBe('');
    const file = `${shop}review:\n  rules: { azure.no-diagnostics: error }\n  ignore:\n    - { rule: azure.public-without-waf, on: users -> web, reason: Behind the VPN }\n    - azure.prod-single-region\n`;
    const b = await run(file);
    expect(b.findings.find((f) => f.rule.id === 'azure.public-without-waf')!.ignored?.reason).toBe('Behind the VPN');
    expect(b.findings.find((f) => f.rule.id === 'azure.prod-single-region')!.ignored?.where).toBe('file');
    const diag = b.findings.find((f) => f.rule.id === 'azure.no-diagnostics')!;
    expect(diag.severity).toBe('error');
    expect(diag.id).toBe('R1');
    expect((await run(`${shop}review: off\n`)).off).toBe(true);
  });

  it('says a rule id that does not exist, with the one meant', async () => {
    const out = await run(`${shop}review:\n  ignore: [azure.no-diagnostic]\n`);
    expect(out.problems[0]!.message).toContain('did you mean azure.no-diagnostics');
  });
});

describe('rules.yaml', () => {
  const rules = `packs: [azure]
rules:
  azure.no-diagnostics: off
  azure.public-without-waf: { severity: error }
ignore:
  - { rule: azure.prod-single-region, reason: One region by decision (ADR 7) }
custom:
  - id: acme.sql-backup
    title: Every SQL database is backed up
    category: reliability
    every: { kind: sql-database }
    must: { tag: backup }
  - id: acme.dmz-to-data
    title: Nothing in the DMZ talks to the data subnet
    severity: error
    category: security
    no-edge: { from: { in: dmz }, to: { in: data } }
  - id: acme.db-in-data
    title: Databases sit in the data subnet
    every: { kind: sql-database }
    must: { in: { label: Data } }
  - id: acme.firewall
    title: A firewall is drawn
    exists: { kind: firewall }
`;
  it('reads packs, severities, ignores and custom rules', async () => {
    const { config, problems } = readConfig(rules, 'rules.yaml', builtInIds);
    expect(problems).toEqual([]);
    expect(config.custom.map((r) => r.id)).toEqual(['acme.sql-backup', 'acme.dmz-to-data', 'acme.db-in-data', 'acme.firewall']);
    const out = await run(shop, config);
    const by = (id: string) => out.findings.filter((f) => f.rule.id === id);
    expect(by('azure.no-diagnostics')).toEqual([]);
    expect(by('azure.public-without-waf')[0]!.severity).toBe('error');
    expect(by('azure.prod-single-region')[0]!.ignored).toEqual({ where: 'config', reason: 'One region by decision (ADR 7)' });
    expect(by('acme.sql-backup').map((f) => f.about)).toEqual(['Archive']);
    expect(by('acme.dmz-to-data').map((f) => f.about)).toEqual(['Web → Orders']);
    expect(by('acme.db-in-data').map((f) => f.about)).toEqual(['Archive']);
    expect(by('acme.firewall')[0]!.on).toEqual({ kind: 'diagram' });
  });

  it('says what is wrong, on its line, and keeps the rest', () => {
    const { config, problems } = readConfig(
      `rules:
  azure.no-diagnostic: off
custom:
  - id: acme.ok
    title: Fine
    exists: { kind: firewall }
  - id: acme.bad
    title: Broken
    every: { kinds: vm }
    must: { tag: x }
  - id: azure.no-diagnostics
    title: Clash
    exists: { kind: vm }
  - title: No id
    run: rm -rf /
`,
      'rules.yaml',
      builtInIds,
    );
    expect(config.custom.map((r) => r.id)).toEqual(['acme.ok']);
    const said = problems.map((p) => `${p.line}: ${p.message}`);
    expect(said).toContain('2: There is no rule azure.no-diagnostic: did you mean azure.no-diagnostics?');
    expect(said.some((s) => s.startsWith('9:') && s.includes('"kinds" is not something to select on'))).toBe(true);
    expect(said.some((s) => s.includes('is a built-in rule'))).toBe(true);
    expect(said.some((s) => s.includes('"run" is not a rule key'))).toBe(true);
  });
});

describe('ignoreFinding', () => {
  it('writes the reason on the element, keeping the rest of the file as it was', async () => {
    const f = (await run(shop)).findings.find((x) => x.rule.id === 'azure.secrets-without-key-vault')!;
    const next = ignoreFinding(shop, f, 'Managed identity');
    expect(next).toContain('web: { kind: app-service, label: Web, in: dmz, review: { ignore: [{ rule: azure.secrets-without-key-vault, reason: Managed identity }] } }');
    expect(next.replace(/, review: .*\}\] \} \}/, ' }')).toBe(shop);
    expect((await run(next)).findings.find((x) => x.rule.id === f.rule.id)!.ignored?.reason).toBe('Managed identity');
  });
  it('writes a line or the diagram in the file\'s review: list', async () => {
    const found = (await run(shop)).findings;
    const line = found.find((x) => x.rule.id === 'azure.public-without-waf')!;
    const a = ignoreFinding(shop, line, 'VPN only', false);
    expect(a).toContain('review:\n  ignore:\n    - rule: azure.public-without-waf\n      on: users -> web\n      reason: VPN only');
    const whole = found.find((x) => x.rule.id === 'azure.prod-single-region')!;
    const b = ignoreFinding(a, whole, '');
    expect((await run(b)).findings.filter((x) => !x.ignored).map((x) => x.rule.id)).not.toContain('azure.prod-single-region');
  });
});

describe('reports', () => {
  it('summarises per pillar and writes each finding with its fix', async () => {
    const out = await run(`${shop}review:\n  ignore: [{ rule: azure.prod-single-region, reason: One region }]\n`);
    const report = { title: 'Shop review', files: [{ file: 'shop.yaml', title: 'Shop', type: 'azure', findings: out.findings, drawings: [], problems: [] }], rules: out.rules, config: [] };
    const md = markdownReport(report);
    expect(md).toContain('| Security |');
    expect(md).toMatch(/\*\*R1 Warning: /);
    expect(md).toContain('*Fix:*');
    expect(md).toContain('| `azure.prod-single-region` | the diagram | One region |');
    const html = htmlReport(report);
    expect(html).toContain('<h3>Security</h3>');
    expect(html).toContain('One region');
    expect(html).not.toMatch(/<script/);
    const g = summaryGraph(report);
    expect(g.nodes[0]!.shape.kind).toBe('matrix');
  });
  it('escapes what the YAML says', async () => {
    const out = await run(shop.replace('label: Web,', 'label: "<img src=x onerror=alert(1)>",'));
    const html = htmlReport({ title: 'x', files: [{ file: 'a.yaml', findings: out.findings, drawings: [], problems: [] }], rules: [], config: [] });
    expect(html).not.toContain('<img src=x');
  });
  it('an empty config changes nothing', async () => {
    expect((await run(shop, emptyConfig())).findings.length).toBe((await run(shop)).findings.length);
  });
});
