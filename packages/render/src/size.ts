// Measures every shape before layout, so layout can reserve exactly the space render will draw.
import { chips, type CardShape, type Chip, type Graph, type NodeSize, type Sized, type TableShape } from '@cartography/core';
import { measureText, type Theme } from '@cartography/theme';
import { matrixGeometry } from './matrix.ts';

export const MARK_WIDTH = 18;
const CELL_GAP = 24;

export function size(graph: Graph, theme: Theme): Sized {
  const nodes = new Map<string, NodeSize>();
  const badges = chips(graph);
  for (const n of graph.nodes) {
    const shape = n.shape;
    if (shape.kind === 'card') nodes.set(n.id, cardSize(shape, theme, badges.get(n.id)));
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

function cardSize(shape: CardShape, theme: Theme, list: Chip[] = []): NodeSize {
  const c = theme.space.card;
  const text = 2 * c.padX + c.tile + c.gap + cardTextWidth(shape, theme) + 4;
  // Room for all chips in one row if the card may grow that far; past maxWidth they wrap.
  const row = list.reduce((w, ch, i) => w + chipWidth(ch, theme) + (i ? CHIP.gap : 0), 0);
  const width = Math.round(Math.min(c.maxWidth, Math.max(c.minWidth, text, chipLeft(theme) + row + c.padX)));
  return { width, height: list.length ? cardHeight(chipRows(list, width - chipLeft(theme) - c.padX, theme).rows, theme) : c.height };
}

// Badge chips sit in rows under the label, aligned with it, so the card reads top to bottom:
// what it is, then what it uses. One quiet size for all, a step below the caption.
export const CHIP = { height: 20, gap: 5, padX: 7, icon: 12, iconGap: 4, top: 52, bottom: 11 } as const;

export function chipLeft(theme: Theme): number {
  const c = theme.space.card;
  return c.padX + c.tile + c.gap;
}

export function cardHeight(rows: number, theme: Theme): number {
  return rows ? CHIP.top + rows * CHIP.height + (rows - 1) * CHIP.gap + CHIP.bottom : theme.space.card.height;
}

export function chipWidth(chip: Chip, theme: Theme): number {
  return Math.ceil(2 * CHIP.padX + (chip.icon ? CHIP.icon + CHIP.iconGap : 0) + measureText(chip.label, theme.size.edgeLabel, 500));
}

/** Chips wrapped into rows of at most `room` wide; x and y relative to the chip area, widths cut to fit. */
export function chipRows(list: Chip[], room: number, theme: Theme) {
  const placed: { chip: Chip; x: number; y: number; width: number }[] = [];
  let x = 0;
  let row = 0;
  for (const chip of list) {
    const width = Math.min(room, chipWidth(chip, theme));
    if (x > 0 && x + width > room) {
      x = 0;
      row++;
    }
    placed.push({ chip, x, y: row * (CHIP.height + CHIP.gap), width });
    x += width + CHIP.gap;
  }
  return { placed, rows: list.length ? row + 1 : 0 };
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
