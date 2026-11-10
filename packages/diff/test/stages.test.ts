import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compareStages, stageStory, stagesRoadmap, storyMarkdown, storyText } from '../src/index.ts';
import { render } from '@cartography/engine';

const example = fs.readFileSync(new URL('../../../examples/transitions/datacenter-exit.yaml', import.meta.url), 'utf8');

describe('stage transitions', () => {
  it('compares two stages and tells a replacement as one', async () => {
    const c = (await compareStages(example, 'q2', 'q3'))!;
    expect(c.from.id).toBe('q2');
    expect(c.to.id).toBe('q3');
    expect(c.replaces).toContainEqual({ from: 'web-vm', to: 'web' });
    const told = c.told.map((t) => t.text);
    expect(told).toContain('Replaced Web server by Web shop in rg-orders');
    expect(told).toContain('Replaced Order service (Virtual machine) by Order service (Container App) in rg-orders');
    expect(told.some((t) => /^Removed Web server/.test(t))).toBe(false);
    const pic = c.picture()!;
    expect(pic.svg).toContain('data-replaces="web-vm>web"');
    // What went stands where it stood, not in a row under the drawing.
    expect(pic.svg).not.toContain('No longer in the drawing');
    expect(c.sideBySide()!.svg).toContain('Workloads move');
  }, 30000);

  it('tells the stages as a story', async () => {
    const story = await stageStory(example);
    expect(story.map((s) => s.stage.id)).toEqual(['as-is', 'q2', 'q3', 'to-be']);
    expect(storyMarkdown('Exit', story)).toContain('- Replaced File server and Backup tapes by File shares in rg-orders');
    const text = storyText('Exit', story);
    expect(text).toContain('In Landing zone (2026-Q2): Added subscription Landing zone;');
    expect(text).toContain('replaced Active Directory by Entra ID');
  }, 60000);

  it('makes a roadmap that draws', async () => {
    const yaml = (await stagesRoadmap(example))!;
    expect(yaml).toMatch(/^type: roadmap$/m);
    expect(yaml).toContain('unit: quarter');
    expect(yaml).toContain('File shares replaces 2');
    expect(yaml).toContain('Web server → Web shop');
    expect(yaml).toContain('Order service to Container App');
    const r = await render(yaml, { fonts: 'none' });
    expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(r.svg).toBeTruthy();
  }, 60000);

  it('makes a roadmap of periods when the stages have no dates', async () => {
    const yaml = (await stagesRoadmap(example.replace(/^    when: .*$/gm, '')))!;
    expect(yaml).toContain('periods:');
    expect((await render(yaml, { fonts: 'none' })).diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  }, 60000);
});
