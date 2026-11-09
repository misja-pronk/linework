// Measures every shape before layout, so layout can reserve exactly the space render will draw.
import type { CardShape, Graph, NodeSize, Sized, TableShape } from '@cartography/core';
import { measureText, type Theme } from '@cartography/theme';
import { matrixGeometry } from './matrix.ts';

export const MARK_WIDTH = 18;
const CELL_GAP = 24;

export function size(graph: Graph, theme: Theme): Sized {
  const nodes = new Map<string, NodeSize>();
  for (const n of graph.nodes) {
    const shape = n.shape;
    if (shape.kind === 'card') nodes.set(n.id, cardSize(shape, theme));
    else if (shape.kind === 'table') nodes.set(n.id, tableSize(shape, theme));
    else {
      const m = matrixGeometry(shape, theme);
      nodes.set(n.id, { width: Math.round(m.width), height: Math.round(m.height) });
    }
  }

  const edgeLabels = new Map<string, { width: number; height: number }>();
  for (const e of graph.edges)
    if (e.label) edgeLabels.set(e.id, { width: measureText(e.label, theme.size.edgeLabel, 500) + 16, height: 20 });

  const groupMinWidth = new Map<string, number>();
  for (const g of graph.groups) groupMinWidth.set(g.id, groupLabelWidth(g.label, g.caption, theme) + 2 * theme.space.group.pad + 24);

  return { graph, nodes, edgeLabels, groupHeader: theme.space.group.header, groupMinWidth };
}

export function cardTextWidth(shape: CardShape, theme: Theme): number {
  const caption = cardCaption(shape);
  return Math.max(measureText(shape.label, theme.size.label, 600), caption ? measureText(caption, theme.size.caption, 400) : 0);
}

export function cardCaption(shape: CardShape): string | undefined {
  const parts = [shape.caption, ...(shape.badges ?? [])].filter(Boolean);
  return parts.length ? parts.join(' · ') : undefined;
}

function cardSize(shape: CardShape, theme: Theme): NodeSize {
  const c = theme.space.card;
  const width = 2 * c.padX + c.tile + c.gap + cardTextWidth(shape, theme) + 4;
  return { width: Math.round(Math.min(c.maxWidth, Math.max(c.minWidth, width))), height: c.height };
}

export function tableHeader(shape: TableShape, theme: Theme): number {
  return shape.caption ? theme.space.table.header + 14 : theme.space.table.header;
}

/** Widths of the name and type columns of a table, shared by size and draw. */
export function tableColumns(shape: TableShape, theme: Theme) {
  let name = 0;
  let type = 0;
  for (const r of shape.rows) {
    if (r.kind !== 'row') continue;
    name = Math.max(name, measureText(r.cells[0]?.text ?? '', theme.size.cell, r.cells[0]?.strong ? 600 : 400));
    type = Math.max(type, measureText(r.cells[1]?.text ?? '', theme.size.cell, 400));
  }
  return { name, type };
}

function tableSize(shape: TableShape, theme: Theme): NodeSize {
  const t = theme.space.table;
  const cols = tableColumns(shape, theme);
  const titleWidth = 16 + 8 + measureText(shape.title, theme.size.label, 600);
  const captionWidth = shape.caption ? measureText(shape.caption, theme.size.caption, 400) : 0;
  const rowWidth = MARK_WIDTH + cols.name + (cols.type ? CELL_GAP + cols.type : 0);
  const width = 2 * t.padX + Math.max(titleWidth, captionWidth, rowWidth);

  const rowY: Record<string, number> = {};
  let y = tableHeader(shape, theme);
  for (const r of shape.rows) {
    const h = r.kind === 'row' ? t.row : t.section;
    if (r.kind === 'row') rowY[r.id] = y + h / 2;
    y += h;
  }
  return { width: Math.round(Math.max(t.minWidth, width)), height: y + (shape.rows.length ? 6 : 0), rowY };
}

export function groupLabelWidth(label: string, caption: string | undefined, theme: Theme): number {
  const icon = 16 + 8;
  const cap = caption ? 8 + measureText(caption, theme.size.caption, 400) : 0;
  return icon + measureText(label, theme.size.group, 600) + cap;
}
