// What the drawing shows on top for precise work: smart guides and equal gaps while dragging, the handles of
// a selected line's segments, small locks on locked elements, and the minimap. All in stage (SVG) coordinates.
import { useRef } from 'react';
import type { Box, Placed, Point } from '@cartography/core';
import type { Snap } from './craft.ts';
import { Icon } from './icon.tsx';

/** Alignment lines and equal-gap marks; `at` maps pin space to the stage. */
export function Guides({ snap, at, scale }: { snap: Snap; at(p: Point): Point; scale: number }) {
  const w = 1 / scale;
  const ext = 10 / scale;
  return (
    <svg className="guides" aria-hidden="true">
      {snap.guides.map((g, i) => {
        const a = at(g.axis === 'x' ? { x: g.at, y: g.from - ext } : { x: g.from - ext, y: g.at });
        const b = at(g.axis === 'x' ? { x: g.at, y: g.to + ext } : { x: g.to + ext, y: g.at });
        return <line key={`g${i}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} strokeWidth={w} />;
      })}
      {snap.gaps.flatMap((g, i) =>
        g.spans.map(([s0, s1], j) => {
          const a = at(g.axis === 'x' ? { x: s0, y: g.at } : { x: g.at, y: s0 });
          const b = at(g.axis === 'x' ? { x: s1, y: g.at } : { x: g.at, y: s1 });
          const t = 4 / scale;
          const tick = (p: Point) => (g.axis === 'x' ? <line x1={p.x} y1={p.y - t} x2={p.x} y2={p.y + t} strokeWidth={w} /> : <line x1={p.x - t} y1={p.y} x2={p.x + t} y2={p.y} strokeWidth={w} />);
          return (
            <g key={`s${i}:${j}`} className="gap">
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} strokeWidth={w} />
              {tick(a)}
              {tick(b)}
              <text x={(a.x + b.x) / 2 + (g.axis === 'y' ? 6 / scale : 0)} y={(a.y + b.y) / 2 - (g.axis === 'x' ? 6 / scale : 0)} fontSize={10 / scale} textAnchor={g.axis === 'x' ? 'middle' : 'start'}>
                {Math.round(s1 - s0)}
              </text>
            </g>
          );
        }),
      )}
    </svg>
  );
}

/** A grip in the middle of each segment of the selected line: drag one to move that segment. */
export function BendHandles({ points, scale, bent }: { points: Point[]; scale: number; bent: boolean }) {
  return (
    <>
      {points.slice(1).map((b, i) => {
        const a = points[i]!;
        const len = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
        // Too short on screen to grab without hitting its neighbour: no grip (the line itself still drags).
        if (len * scale < 24) return null;
        const h = a.y === b.y;
        return (
          <div
            key={i}
            className={bent ? 'bend-handle bent' : 'bend-handle'}
            data-bend={i}
            title="Drag to move this part of the line (⌥ for no snapping)"
            style={{ left: (a.x + b.x) / 2, top: (a.y + b.y) / 2, transform: `translate(-50%, -50%) scale(${1 / scale})`, cursor: h ? 'ns-resize' : 'ew-resize' }}
            data-horizontal={h || undefined}
          />
        );
      })}
    </>
  );
}

/** A tiny lock on the top-right corner of each locked element. */
export function LockBadges({ boxes, scale }: { boxes: Box[]; scale: number }) {
  return (
    <>
      {boxes.map((b, i) => (
        <span key={i} className="lock-badge" style={{ left: b.x + b.width, top: b.y, transform: `translate(-50%, -50%) scale(${1 / scale})` }} aria-hidden="true">
          <Icon name="lock" size={11} stroke={2.25} />
        </span>
      ))}
    </>
  );
}

const MINI_W = 180;
const MINI_H = 120;

/** The whole drawing small, with the part in view; click or drag in it to look elsewhere. */
export function Minimap(p: { placed: Placed; origin: Point; width: number; height: number; view: { x: number; y: number; scale: number }; pane: { w: number; h: number }; onCentre(x: number, y: number): void }) {
  const k = Math.min(MINI_W / p.width, MINI_H / p.height);
  const w = p.width * k;
  const h = p.height * k;
  const o = p.origin;
  const ref = useRef<SVGSVGElement>(null);
  const centre = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    p.onCentre((e.clientX - r.left) / k, (e.clientY - r.top) / k);
  };
  const vx = -p.view.x / p.view.scale;
  const vy = -p.view.y / p.view.scale;
  const clip = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  const x0 = clip(vx, 0, p.width);
  const y0 = clip(vy, 0, p.height);
  const x1 = clip(vx + p.pane.w / p.view.scale, 0, p.width);
  const y1 = clip(vy + p.pane.h / p.view.scale, 0, p.height);
  return (
    <div className="minimap" onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      <svg
        ref={ref}
        width={w}
        height={h}
        role="img"
        aria-label="Overview of the drawing: click to look there"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          centre(e);
        }}
        onPointerMove={(e) => e.buttons && centre(e)}
      >
        <g transform={`scale(${k})`}>
          {[...p.placed.groups.values()].map((b, i) => (
            <rect key={`g${i}`} className="mini-group" x={b.x + o.x} y={b.y + o.y} width={b.width} height={b.height} rx={6} strokeWidth={1 / k} />
          ))}
          {[...p.placed.edges.values()].map((e, i) => (
            <polyline key={`e${i}`} className="mini-edge" points={e.points.map((q) => `${q.x + o.x},${q.y + o.y}`).join(' ')} strokeWidth={1 / k} />
          ))}
          {[...p.placed.nodes.values()].map((b, i) => (
            <rect key={`n${i}`} className="mini-node" x={b.x + o.x} y={b.y + o.y} width={b.width} height={b.height} rx={4} />
          ))}
          <rect className="mini-view" x={x0} y={y0} width={Math.max(0, x1 - x0)} height={Math.max(0, y1 - y0)} strokeWidth={1.5 / k} />
        </g>
      </svg>
    </div>
  );
}
