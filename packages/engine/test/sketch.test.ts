// The sketch look: drawn by hand, the same on every redraw, plain paths only.
import { describe, expect, it } from 'vitest';
import { themes } from '@linework/theme';
import { render } from '../src/index.ts';

const shop = `type: systems
title: Shop
groups:
  backend: { kind: zone, label: Backend }
nodes:
  web: { kind: client, label: Web shop }
  api: { kind: service, label: Orders API, in: backend }
  db: { kind: database, label: Orders, in: backend }
edges:
  - web -> api: REST
  - api -> db
`;

describe('sketch look', () => {
  it('draws outlines and lines as wobbly paths, with no filters and nothing but the page as a rect', async () => {
    const r = await render(shop, { theme: 'sketch', fonts: 'none' });
    expect(r.diagnostics).toEqual([]);
    expect(r.theme).toBe(themes.sketch);
    const svg = r.svg!;
    expect(svg).not.toMatch(/filter=|<filter/);
    // Only the page stays a rect (and the rects inside line icons); cards, zones and rules are paths drawn by hand.
    const big = (svg.match(/<rect [^>]*>/g) ?? []).filter((t) => Number(/width="([\d.]+)"/.exec(t)![1]) > 24);
    expect(big).toHaveLength(1);
    expect(svg).toMatch(/<path d="M[^"]*C/);
    expect(svg).toContain("font-family=\"Kalam,");
    // Hachure over the zone's tint.
    expect(svg).toMatch(/stroke-width="1" stroke-linecap="round"/);
  });

  it('comes out the same every time', async () => {
    const a = await render(shop, { theme: 'sketch', fonts: 'none' });
    const b = await render(shop, { theme: 'sketch', fonts: 'none' });
    expect(a.svg).toBe(b.svg);
  });

  it('keeps a card its own wobble when it moves (editor drawings seed by id)', async () => {
    const card = (svg: string, id: string) => {
      const m = new RegExp(`data-node="${id}"[^>]*>(.*?)<text`).exec(svg)![1]!;
      const d = [...m.split('<g')[0]!.matchAll(/ d="([^"]*)"/g)].map((x) => x[1]).join(' ');
      const nums = [...d.matchAll(/-?\d+(?:\.\d+)?/g)].map((x) => Number(x[0]));
      // Relative to the first point: the shape without where it stands.
      return nums.map((n, i) => n - nums[i % 2]!);
    };
    const a = await render(shop, { theme: 'sketch', fonts: 'none', interactive: true });
    const b = await render(shop.replace('  - api -> db\n', '  - api -> db\n  - web -> db\n'), { theme: 'sketch', fonts: 'none', interactive: true });
    const [x, y] = [card(a.svg!, 'web'), card(b.svg!, 'web')];
    expect(x.length).toBe(y.length);
    // Equal up to rounding to tenths of a pixel.
    expect(Math.max(...x.map((v, i) => Math.abs(v - y[i]!)))).toBeLessThan(0.25);
  });

  it('a theme file can turn it on and off', async () => {
    const on = await render(shop.replace('type: systems', 'type: systems\ntheme: { extends: survey, sketch: { roughness: 2 } }'), { fonts: 'none' });
    expect(on.theme!.sketch).toEqual({ roughness: 2 });
    expect(on.svg).toMatch(/<path d="M[^"]*C/);
    const off = await render(shop.replace('type: systems', 'type: systems\ntheme: { extends: sketch, sketch: false }'), { fonts: 'none' });
    expect(off.theme!.sketch).toBeUndefined();
    expect(off.svg!.match(/<rect /g)!.length).toBeGreaterThan(1);
  });
});
