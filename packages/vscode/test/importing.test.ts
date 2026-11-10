import { describe, expect, it } from 'vitest';
import { importText } from '../src/importing.ts';

describe('import from other tools', () => {
  it('reads Mermaid', () => {
    const [r] = importText('/x/flow.mmd', 'flowchart LR\n  a[Web] --> b[(DB)]\n');
    expect(r!.name).toBe('flow.yaml');
    expect(r!.yaml).toMatch(/^type: /m);
    expect(r!.yaml).toContain('->');
  });

  it('reads each mermaid block of a Markdown file', () => {
    const md = '# One\n\n```mermaid\nflowchart LR\n  a --> b\n```\n\n# Two\n\n```mermaid\nflowchart LR\n  c --> d\n```\n';
    const r = importText('/x/notes.md', md);
    expect(r.map((x) => x.name)).toEqual(['notes-1.yaml', 'notes-2.yaml']);
    expect(importText('/x/empty.md', '# nothing\n')[0]!.yaml).toBe('');
  });

  it('reads a draw.io page', () => {
    const xml = `<mxfile><diagram name="Overview"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>
<mxCell id="a" value="Web" style="rounded=1;" vertex="1" parent="1"><mxGeometry x="0" y="0" width="120" height="60" as="geometry"/></mxCell>
<mxCell id="b" value="API" style="rounded=1;" vertex="1" parent="1"><mxGeometry x="200" y="0" width="120" height="60" as="geometry"/></mxCell>
<mxCell id="e" edge="1" source="a" target="b" parent="1"><mxGeometry relative="1" as="geometry"/></mxCell>
</root></mxGraphModel></diagram></mxfile>`;
    const [r] = importText('/x/arch.drawio', xml, { keepPositions: true });
    expect(r!.name).toBe('arch.yaml');
    expect(r!.yaml).toMatch(/Web/);
    expect(r!.sidecar?.nodes).toBeTruthy();
  });

  it('says so when a JSON file is not a drawing', () => {
    const [r] = importText('/x/data.json', '{"a":1}');
    expect(r!.yaml).toBe('');
    expect(r!.notes[0]).toMatch(/neither/);
  });
});
