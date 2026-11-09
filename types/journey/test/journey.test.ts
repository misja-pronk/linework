import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { icon } from '@cartography/icons';
import { render } from '@cartography/engine';
import { measureText, themes, themeTextFonts, withTextFonts } from '@cartography/theme';
import { JOURNEY_ROWS, journeyAvatarNames, journeyScene, type JourneyMark, type JourneyScene } from '@cartography/render';
import { journeyAvatars, journeyBeats, journeyMood, type JourneyShape } from '@cartography/core';
import { journey, journeyReferences, journeyScale, journeyViewsOf, parseFeel, stepShorthand, touchpointIcon } from '../src/index.ts';

// Text is measured in the faces of the look the drawing is made in, as the engine does.
const inLook = <T,>(fn: () => T): T => withTextFonts(themeTextFonts(themes.light), fn);

const examples = path.resolve(import.meta.dirname, '../../../examples/journey');
const example = (name: string) => fs.readFileSync(path.join(examples, `${name}.yaml`), 'utf8');
const names = fs.readdirSync(examples).filter((f) => f.endsWith('.yaml')).map((f) => f.replace(/\.yaml$/, '')).sort();

async function draw(yaml: string, opts: { view?: string; step?: number } = {}) {
  const r = await render(yaml, { fonts: 'none', ...opts });
  const shape = r.graph?.nodes[0]?.shape as JourneyShape;
  return { r, shape, scene: shape ? inLook(() => journeyScene(shape, themes.light, opts.step)) : undefined };
}

const day = `type: journey
persona: Dana, new backend developer
phases:
  start: First day
  commit: First commit
steps:
  Collect laptop: 4
  Find the repository: 2 lost
  wiki: Read the wiki
  Run it locally: { in: commit, feel: 3, touchpoint: Terminal }
  Open a pull request:
    feel: 5 proud
    says: That was quick!
    with: [Reviewer, Buddy]
    pains: No preview environment
    metrics: { Review time: 1 hour }
`;

type TextMark = Extract<JourneyMark, { t: 'text' }>;
const texts = (scene: JourneyScene) => scene.marks.filter((m): m is TextMark => m.t === 'text');
const said = (scene: JourneyScene) => texts(scene).flatMap((m) => m.lines).join(' ');

/** Where a text mark's ink is: its lines as wide as they measure, placed by its alignment. */
function ink(m: TextMark) {
  const w = inLook(() => Math.max(...m.lines.map((l) => measureText(l, m.size, m.weight))));
  const x = m.align === 'l' ? m.x : m.align === 'c' ? m.x + (m.w - w) / 2 : m.x + m.w - w;
  return { x, y: m.y, w, h: m.lines.length * m.lh };
}

describe('journey', () => {
  it('has icons for the type, the palette, the rows and every touchpoint word', () => {
    expect(icon(journey.icon!)).toBeDefined();
    for (const p of journey.palette) expect(icon(p.icon), p.kind).toBeDefined();
    for (const [row, r] of Object.entries(JOURNEY_ROWS)) expect(icon(r.icon), row).toBeDefined();
    const words = ['Email', 'Slack', 'Phone', 'Pull request', 'GitHub', 'Pipeline', 'Terminal', 'VS Code', 'Wiki', 'Data catalogue', 'Search', 'Developer portal', 'Ticket', 'Approval', 'Access', 'Alerts', 'Grafana', 'API', 'Database', 'Azure', 'Laptop', 'SMS', 'Meeting', 'Team', 'Manager', 'Template', 'Something else'];
    for (const w of words) expect(icon(touchpointIcon(w)), w).toBeDefined();
    expect(touchpointIcon('Slack')).toBe('message-square');
    expect(touchpointIcon('Something else')).toBe('circle-dot');
    expect([...journeyAvatars].sort()).toEqual([...journeyAvatarNames].sort());
  });

  it('reads how it feels: a score, a score with a word, or a word', () => {
    expect(parseFeel(4)).toEqual({ score: 4 });
    expect(parseFeel('2 lost')).toEqual({ score: 2, feeling: 'lost' });
    expect(parseFeel('-1: fed up')).toEqual({ score: -1, feeling: 'fed up' });
    expect(parseFeel('+2')).toEqual({ score: 2 });
    expect(parseFeel('lost')).toEqual({ feeling: 'lost' });
    expect(parseFeel('3rd time lucky')).toEqual({ feeling: '3rd time lucky' });
    expect(parseFeel(undefined)).toEqual({});
    expect(stepShorthand(4)).toEqual({ feel: 4 });
    expect(stepShorthand('2 lost')).toEqual({ feel: '2 lost' });
    expect(stepShorthand('Find the repository')).toEqual({ label: 'Find the repository' });
    expect(stepShorthand(null)).toEqual({});
  });

  it('picks the scale the scores fit in, or takes the one written', () => {
    expect(journeyScale(undefined, [])).toEqual({ min: 1, max: 5 });
    expect(journeyScale(undefined, [1, 4, 5])).toEqual({ min: 1, max: 5 });
    expect(journeyScale(undefined, [0, 3])).toEqual({ min: 0, max: 5 });
    expect(journeyScale(undefined, [-2, 1])).toEqual({ min: -2, max: 2 });
    expect(journeyScale(undefined, [-1, 3])).toEqual({ min: -3, max: 3 });
    expect(journeyScale(undefined, [2, 8])).toEqual({ min: 1, max: 10 });
    expect(journeyScale('0..10', [3])).toEqual({ min: 0, max: 10 });
    expect(journeyScale([-2, 2], [])).toEqual({ min: -2, max: 2 });
    expect(journeyMood(1, { min: 1, max: 5 })).toBe(-1);
    expect(journeyMood(3, { min: 1, max: 5 })).toBe(0);
    expect(journeyMood(2, { min: -2, max: 2 })).toBe(1);
  });

  it('reads short steps: the key is the step, a number how it feels, the phase follows the step above', async () => {
    const { r, shape } = await draw(day);
    expect(r.diagnostics).toEqual([]);
    expect(shape.persona).toMatchObject({ name: 'Dana', role: 'new backend developer' });
    expect(shape.phases.map((p) => p.label)).toEqual(['First day', 'First commit']);
    expect(shape.steps.map((s) => [s.label, s.phase, s.score, s.feeling])).toEqual([
      ['Collect laptop', 'start', 4, undefined],
      ['Find the repository', 'start', 2, 'lost'],
      ['Read the wiki', 'start', undefined, undefined],
      ['Run it locally', 'commit', 3, undefined],
      ['Open a pull request', 'commit', 5, 'proud'],
    ]);
    const last = shape.steps.at(-1)!;
    expect(last).toMatchObject({ says: 'That was quick!', actors: ['Reviewer', 'Buddy'], pains: ['No preview environment'], metrics: ['Review time: 1 hour'] });
    expect(shape.steps[3]!.touchpoints).toEqual([{ label: 'Terminal', icon: 'terminal' }]);
    expect(shape.scale).toEqual({ min: 1, max: 5 });
    // Only rows that something fills are drawn.
    expect(shape.rows).toEqual(['steps', 'touchpoints', 'feeling', 'thoughts', 'pains', 'metrics']);
  });

  it('tells steps phase by phase, whatever order they are written in', async () => {
    const { shape } = await draw('type: journey\nphases: { a: A, b: B }\nsteps:\n  one: { in: b, feel: 1 }\n  two: { in: a, feel: 2 }\n  three: { in: b, feel: 3 }\n');
    expect(shape.steps.map((s) => s.id)).toEqual(['two', 'one', 'three']);
  });

  it('makes phases from the steps when none are declared', async () => {
    const { r, shape } = await draw('type: journey\nsteps:\n  one: { in: Find, feel: 1 }\n  two: 2\n  three: { in: Use, feel: 3 }\n');
    expect(r.diagnostics).toEqual([]);
    expect(shape.phases.map((p) => p.label)).toEqual(['Find', 'Use']);
    expect(shape.steps.map((s) => s.phase)).toEqual(['Find', 'Find', 'Use']);
  });

  it('orders, hides and renames rows', async () => {
    const { r, shape, scene } = await draw(`${day}rows: [feeling, steps, { pains: Friction }, thoughts, metrics]\nhide: [metrics]\n`);
    expect(r.diagnostics).toEqual([]);
    expect(shape.rows).toEqual(['feeling', 'steps', 'pains', 'thoughts']);
    expect(shape.rowLabels).toEqual({ pains: 'Friction' });
    const labels = texts(scene!).filter((m) => ['Feeling', 'Doing', 'Friction', 'Thinking'].includes(m.lines[0]!));
    expect(labels.sort((a, b) => a.y - b.y).map((m) => m.lines[0])).toEqual(['Feeling', 'Doing', 'Friction', 'Thinking']);
    expect(said(scene!)).not.toContain('Review time');
  });

  it('says what is wrong where it is wrong', async () => {
    const bad = await draw('type: journey\nscale: best\nphases: { a: A }\nsteps:\n  one: { in: b, feel: 9 }\n  two: { feel: 2, touchpoint: { icon: mail } }\n');
    expect(bad.r.diagnostics.map((d) => `${d.severity} ${d.path?.join('.')}: ${d.message}`)).toEqual([
      'error steps.one.in: There is no phase "b"; phases: a',
      'error steps.two.touchpoint: A touchpoint needs a label or a ref',
      'error scale: A scale is its worst and best score: 1..5, -2..2 or [0, 10]',
    ]);
    const edge = await draw('type: journey\nscale: 1..5\nsteps:\n  one: 9\n  two: 2\n');
    expect(edge.r.diagnostics.map((d) => `${d.severity} ${d.path?.join('.')}: ${d.message}`)).toEqual(['warning steps.one: 9 is outside the scale 1..5: drawn at the edge (set scale: to change it)']);
    expect(edge.shape.steps[0]!.score).toBe(5);
    const unknown = await render('type: journey\nsteps:\n  one: { mood: 3 }\n', { fonts: 'none' });
    expect(unknown.diagnostics.some((d) => d.severity === 'error')).toBe(true);
  });

  it('names the phases steps point at, so renames follow', () => {
    expect(journeyReferences({ type: 'journey', phases: { a: 'A' }, steps: { one: { in: 'a' }, two: 3, three: { in: 'elsewhere' } }, future: { steps: { one: { in: 'a' } } } })).toEqual([
      { path: ['steps', 'one', 'in'], id: 'a', start: 0, collection: 'phases', onDelete: 'key' },
      { path: ['future', 'steps', 'one', 'in'], id: 'a', start: 0, collection: 'phases', onDelete: 'key' },
    ]);
  });

  it('offers the views the source can be drawn as', async () => {
    const plain = { type: 'journey' as const, steps: { one: 3 } };
    expect(journeyViewsOf(plain).map((v) => v.name)).toEqual(['map', 'storyboard']);
    expect(journeyViewsOf({ ...plain, steps: { one: { feel: 3, backstage: 'Batch job' } } }).map((v) => v.name)).toEqual(['map', 'storyboard', 'blueprint']);
    expect(journeyViewsOf({ ...plain, future: { steps: { one: 5 } } }).map((v) => v.name)).toEqual(['map', 'storyboard', 'compare']);

    const access = example('access-request');
    const byDefault = await draw(access);
    expect(byDefault.shape.view).toBe('compare');
    expect(byDefault.r.views?.map((v) => v.name)).toEqual(['map', 'storyboard', 'compare']);
    const board = await draw(access, { view: 'storyboard' });
    expect(board.r.diagnostics).toEqual([]);
    expect(board.shape.view).toBe('storyboard');
    expect(board.r.view).toBe('storyboard');
    // The same steps, drawn differently: a storyboard is cards, a map has row labels.
    expect(said(board.scene!)).not.toContain('Touchpoints');
    expect(said((await draw(access, { view: 'map' })).scene!)).toContain('Touchpoints');

    const blueprint = await draw(example('first-deploy'), { view: 'blueprint' });
    expect(blueprint.r.diagnostics).toEqual([]);
    for (const label of ['Line of interaction', 'Line of visibility', 'Line of internal interaction', 'Frontstage', 'Backstage', 'Support']) expect(said(blueprint.scene!)).toContain(label);
  });

  it('warns when a view has nothing to show', async () => {
    const noFuture = await draw('type: journey\nview: compare\nsteps: { one: 3 }\n');
    expect(noFuture.r.diagnostics.map((d) => d.message)).toEqual(['Comparing needs a second journey: add future: { label: …, steps: … } (drawn as a map)']);
    expect(noFuture.shape.view).toBe('map');
    const noStages = await draw('type: journey\nview: blueprint\nsteps: { one: 3 }\n');
    expect(noStages.r.diagnostics.map((d) => d.message)).toEqual(['A blueprint shows what the organisation does: give steps frontstage:, backstage: or support:']);
  });

  it('compares today with the future: both curves, and the numbers side by side', async () => {
    const { shape, scene } = await draw(example('access-request'));
    expect(shape.label).toBe('Today');
    expect(shape.future).toMatchObject({ label: 'With access packages' });
    expect(shape.future!.steps.map((s) => s.id).every((id) => id.startsWith('future:'))).toBe(true);
    const all = said(scene!);
    for (const t of ['Today', 'With access packages', '5 days', '15 minutes', 'Lead time']) expect(all).toContain(t);
    // Two curves: one dashed (today), one solid (future).
    const curves = scene!.marks.filter((m) => m.t === 'path' && m.name?.startsWith('Feeling'));
    expect(curves.map((c) => (c.t === 'path' ? !!c.dash : undefined)).sort()).toEqual([false, true]);
  });

  it('is told step by step when presenting: one step in focus, the curve drawn up to it', async () => {
    const yaml = example('developer-onboarding');
    const whole = await draw(yaml);
    expect(whole.r.stepsImplied).toBe(true);
    expect(whole.r.steps).toHaveLength(whole.shape.steps.length);
    expect(whole.r.steps![2]).toMatchObject({ title: `First commit: ${whole.shape.steps[2]!.label}` });
    expect(journeyBeats(whole.shape)[2]!.caption).toContain(whole.shape.steps[2]!.thought ?? whole.shape.steps[2]!.says ?? '');

    const faces = (s: JourneyScene) => s.marks.filter((m) => m.t === 'circle').length;
    const third = await draw(yaml, { step: 3 });
    expect(third.r.step).toBe(3);
    expect(third.scene!.marks.some((m) => m.t === 'rect' && m.name === 'In focus')).toBe(true);
    expect(whole.scene!.marks.some((m) => m.t === 'rect' && m.name === 'In focus')).toBe(false);
    expect(faces(third.scene!)).toBeLessThan(faces(whole.scene!));
    // The picture keeps its size from step to step, so slides do not jump.
    const first = await draw(yaml, { step: 1 });
    expect([third.r.width, third.r.height]).toEqual([first.r.width, first.r.height]);
    expect(third.r.width).toBe(whole.r.width);
    expect([third.scene!.width, third.scene!.height]).toEqual([whole.scene!.width, whole.scene!.height]);

    // A comparison is told phase by phase.
    const compare = await draw(example('access-request'));
    expect(compare.r.steps).toHaveLength(compare.shape.phases.length);
    expect(compare.r.steps![2]!.caption).toContain('Today: ');
  });

  for (const name of names)
    describe(name, () => {
      const yaml = example(name);
      const views = journeyViewsOf(parse(yaml)).map((v) => v.name);

      for (const view of views)
        it(`${view}: fits a slide, cuts no text, and keeps text apart`, async () => {
          const { r, scene } = await draw(yaml, { view });
          expect(r.diagnostics).toEqual([]);
          // With the title and the margins the drawing is close to 16:9.
          const ratio = r.width! / r.height!;
          expect(ratio, `${r.width}x${r.height}`).toBeGreaterThan(1.45);
          expect(ratio, `${r.width}x${r.height}`).toBeLessThan(2.1);
          const cut = texts(scene!).flatMap((m) => m.lines).filter((l) => l.endsWith('…'));
          expect(cut).toEqual([]);
          // No two pieces of text run into each other, and none leaves the drawing.
          const boxes = texts(scene!).map((m) => ({ m, b: ink(m) }));
          for (const { m, b } of boxes) {
            expect(b.x, m.lines[0]).toBeGreaterThanOrEqual(-1);
            expect(b.x + b.w, m.lines[0]).toBeLessThanOrEqual(scene!.width + 1);
            expect(b.y + b.h, m.lines[0]).toBeLessThanOrEqual(scene!.height + 1);
          }
          const hits: string[] = [];
          for (let i = 0; i < boxes.length; i++)
            for (let j = i + 1; j < boxes.length; j++) {
              const [a, b] = [boxes[i]!.b, boxes[j]!.b];
              if (a.x < b.x + b.w - 1 && b.x < a.x + a.w - 1 && a.y < b.y + b.h - 2 && b.y < a.y + a.h - 2) hits.push(`${boxes[i]!.m.lines[0]} / ${boxes[j]!.m.lines[0]}`);
            }
          expect(hits).toEqual([]);
        });

      it('places every step, phase and linked touchpoint where it is drawn', async () => {
        const { r } = await draw(yaml);
        const parts = r.graph!.nodes.filter((n) => n.shape.kind === 'journey-part');
        expect(parts.length).toBeGreaterThan(4);
        for (const n of parts) {
          const box = r.placed!.nodes.get(n.id);
          expect(box, n.id).toBeDefined();
          expect(box!.width, n.id).toBeGreaterThan(8);
          expect(box!.x + box!.width, n.id).toBeLessThanOrEqual(r.placed!.width + 1);
        }
      });

      it('draws in every theme without a colour of its own', async () => {
        for (const theme of ['dark', 'mono']) {
          const r = await render(yaml, { fonts: 'none', theme });
          expect(r.diagnostics).toEqual([]);
          expect(r.svg).not.toContain('NaN');
          expect(r.svg).not.toContain('undefined');
        }
      });
    });

  it('draws the template and a journey with nothing in it yet', async () => {
    const t = await draw(journey.template);
    expect(t.r.diagnostics).toEqual([]);
    expect(t.shape.steps).toHaveLength(5);
    const empty = await render('type: journey\n', { fonts: 'none' });
    expect(empty.diagnostics).toEqual([]);
    expect(empty.svg).toContain('Add steps');
  });
});
