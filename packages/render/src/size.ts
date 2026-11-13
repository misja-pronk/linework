// Measures every shape before layout, so layout can reserve exactly the space render will draw.
import { chips, type CardShape, type Chip, type Graph, type NodeSize, type RowMark, type Sized, type TableRow, type TableShape, type Tone } from '@cartography/core';
import { chipText, fitText, groupLabel, look, measureText, monoCell, type Theme } from '@cartography/theme';
import { matrixGeometry } from './matrix.ts';
import { endsRoom, TAG, tagsWidth } from './tags.ts';
import { sequenceGeometry } from './sequence.ts';
import { gitflowGeometry } from './gitflow.ts';
import { roadmapGeometry } from './roadmap.ts';
import { journeyScene } from './journey.ts';
import { flowSize, laneHeader } from './flow.ts';
import { blockSize } from './block.ts';

const MARK_WIDTH = 18;
const MARK_STEP = 15;

/** Icons a table row shows: its own, or one per key mark (a column can be pk and fk at once). */
export function rowMarks(row: Extract<TableRow, { kind: 'row' }>): { icon: string; tone: Tone }[] {
  if (row.icon) return [{ icon: row.icon, tone: row.tone ?? 'slate' }];
  const icons: [RowMark, string, Tone][] = [['pk', 'key-round', 'amber'], ['fk', 'link', 'blue'], ['unique', 'fingerprint-pattern', 'violet'], ['pii', 'eye', 'rose']];
  return icons.filter(([m]) => row.marks?.includes(m)).map(([, icon, tone]) => ({ icon, tone }));
}

/** Width of the mark column: room for the row with the most marks. A class keeps it only for visibility signs. */
export function markWidth(shape: TableShape): number {
  const most = Math.max(1, ...shape.rows.map((r) => (r.kind === 'row' ? rowMarks(r).length : 0)));
  if (shape.form === 'class' && !shape.rows.some((r) => r.kind === 'row' && (r.sign || rowMarks(r).length))) return 0;
  if (shape.form === 'class' && most <= 1) return SIGN_WIDTH;
  return MARK_WIDTH + (most - 1) * MARK_STEP;
}

const SIGN_WIDTH = 14;

/** Height of a table's row: a class's members stand closer together than a table's columns. */
export const rowHeight = (shape: TableShape, theme: Theme) => (shape.form === 'class' ? Math.round(theme.space.table.row * 0.8) : theme.space.table.row);

/** Height of a section: its label in small capitals, or, without one, a rule between compartments. */
export const sectionHeight = (row: { label: string }, theme: Theme) => (row.label ? theme.space.table.section : DIVIDER);
const DIVIDER = 9;
const CELL_GAP = 24;

export function size(graph: Graph, theme: Theme): Sized {
  const nodes = new Map<string, NodeSize>();
  const badges = chips(graph);
  for (const n of graph.nodes) {
    const shape = n.shape;
    if (shape.kind === 'card') nodes.set(n.id, cardSize(shape, theme, badges.get(n.id), !!n.links?.length));
    else if (shape.kind === 'table') nodes.set(n.id, tableSize(shape, theme));
    else if (shape.kind === 'sequence' || shape.kind === 'gitflow' || shape.kind === 'roadmap') {
      const s = shape.kind === 'sequence' ? sequenceGeometry(shape, theme) : shape.kind === 'gitflow' ? gitflowGeometry(shape, theme) : roadmapGeometry(shape, theme);
      nodes.set(n.id, { width: s.width, height: s.height });
    }
    else if (shape.kind === 'journey') {
      const s = journeyScene(shape, theme);
      nodes.set(n.id, { width: s.width, height: s.height, parts: s.parts });
    }
    // Parts of a journey are placed by the journey's own layout.
    else if (shape.kind === 'journey-part') nodes.set(n.id, { width: 0, height: 0 });
    else if (shape.kind === 'flow') nodes.set(n.id, flowSize(shape, theme));
    else if (shape.kind === 'block') nodes.set(n.id, blockSize(shape, theme));
    else {
      const m = matrixGeometry(shape, theme);
      nodes.set(n.id, { width: Math.round(m.width), height: Math.round(m.height) });
    }
  }

  const edgeLabels = new Map<string, { width: number; height: number; aside?: number }>();
  for (const e of graph.edges)
    if (e.label || e.step || e.marks?.length || e.ends) {
      const aside = 2 * endsRoom(e.ends);
      edgeLabels.set(e.id, { width: (e.label ? edgeLabelWidth(e.label, theme) + labelPad(theme) + (e.icon ? LABEL_ICON : 0) : 4) + (e.step ? STEP_ROOM : 0) + (e.marks?.length ? tagsWidth(e.marks) + TAG.GAP : 0) + aside, height: 20, ...(aside ? { aside } : {}) });
    }

  const groupMinWidth = new Map<string, number>();
  // A lane's name stands in a header at its start: that header's width is what it needs.
  for (const g of graph.groups) groupMinWidth.set(g.id, g.lane ? laneHeader(g.label, theme) : groupLabelWidth(g.label, g.caption, theme) + 2 * theme.space.group.pad + 24 + (g.links?.length ? LINK_ROOM : 0));

  // The smallest words a reader needs (layout's slide sizes go by it): labels on lines, group names, a table's section names (SECTION_PX).
  const small = [
    ...(graph.edges.some((e) => e.label) ? [theme.size.edgeLabel] : []),
    ...(graph.groups.length ? [look(theme).group.size] : []),
    ...(graph.nodes.some((n) => n.shape.kind === 'table' && n.shape.rows.some((r) => r.kind === 'section' && r.label)) ? [SECTION_PX] : []),
  ];
  return { graph, nodes, edgeLabels, groupHeader: theme.space.group.header, groupMinWidth, ...(small.length ? { smallText: Math.min(...small) } : {}) };
}

/** A table's section names (INPUT PORTS, SCHEMA) in small capitals: their size (px). */
export const SECTION_PX = 10;

/** Room around the words of a label on a line: a pill or plate needs its padding, bare words on a halo only a gap in the line. */
export const labelPad = (theme: Theme): number => (look(theme).edgeLabel.style === 'halo' ? 10 : 16);

/** Width of the words of a label on a line, as drawn: in capitals, the monospace face or with tracking where the theme asks. */
export function edgeLabelWidth(label: string, theme: Theme): number {
  const l = look(theme).edgeLabel;
  return measureText(l.caps ? label.toUpperCase() : label, theme.size.edgeLabel, 500, l.mono ? 'mono' : 'sans', l.tracking);
}

export function cardTextWidth(shape: CardShape, theme: Theme): number {
  const caption = cardCaption(shape);
  return Math.max(measureText(shape.label, theme.size.label, 600), caption ? measureText(caption, theme.size.caption, 400) : 0);
}

export function cardCaption(shape: CardShape): string | undefined {
  const parts = [shape.caption, ...(shape.badges ?? [])].filter(Boolean);
  return parts.length ? parts.join(' · ') : undefined;
}

function cardSize(shape: CardShape, theme: Theme, list: Chip[] = [], linked = false): NodeSize {
  const c = theme.space.card;
  const inset = cardInsets(shape, theme, linked);
  const text = inset.left + cardTextWidth(shape, theme) + inset.right + 4;
  if (shape.body && !list.length) {
    // A described card is wider than a plain one, so three short lines hold a real sentence.
    const width = Math.round(Math.min(c.maxWidth, Math.max(BODY.minWidth, text)));
    return { width, height: cardHeight(0, theme) + bodyHeight(bodyLines(shape.body, width, theme)) };
  }
  // Room for all chips in one row if the card may grow that far; past maxWidth they wrap.
  const row = list.reduce((w, ch, i) => w + chipWidth(ch, theme) + (i ? CHIP.gap : 0), 0);
  // A name or caption longer than the usual card widens it by up to a third before it is cut; chips wrap instead.
  const most = text > c.maxWidth ? Math.min(Math.ceil(text), Math.round(c.maxWidth * 1.33)) : c.maxWidth;
  const width = Math.round(Math.min(most, Math.max(c.minWidth, text, inset.left + row + inset.right)));
  const height = list.length ? cardHeight(chipRows(list, width - inset.left - inset.right, theme).rows, theme) : c.height;
  // A stacked pair keeps the card as it is and adds the edge of the one behind it.
  return shape.stack ? { width: width + STACK, height: height + STACK } : { width, height };
}

/** How far the second card of a stacked pair shows below and to the right of the first. */
export const STACK = 6;
/** Room for an icon in an edge label pill (a lock on a tunnel). */
export const LABEL_ICON = 15;

/** The description in a C4 card: under the header, across the card, at most three lines. */
export const BODY = { minWidth: 232, line: 15, lines: 3, bottom: 12, top: -3 } as const;

export function bodyLines(text: string, width: number, theme: Theme): string[] {
  return wrapText(text, theme.size.caption, 400, width - 2 * theme.space.card.padX - 2, BODY.lines);
}

export const bodyHeight = (lines: string[]) => (lines.length ? BODY.top + lines.length * BODY.line + BODY.bottom : 0);

/** Words in lines of at most `width`; the last line ends in an ellipsis when the text goes on. */
export function wrapText(text: string, size: number, weight: 400 | 500 | 600, width: number, max: number): string[] {
  const lines: string[] = [];
  let line = '';
  const words = text.trim().split(/\s+/);
  for (const [i, w] of words.entries()) {
    const next = line ? `${line} ${w}` : w;
    if (!line || measureText(next, size, weight) <= width) {
      line = next;
      continue;
    }
    if (lines.length === max - 1) {
      lines.push(fitText(`${line} ${words.slice(i).join(' ')}`, size, weight, width));
      return lines;
    }
    lines.push(line);
    line = w;
  }
  if (line) lines.push(fitText(line, size, weight, width));
  return lines;
}

/** Room for a step number in front of an edge label. */
export const STEP_ROOM = 20;

/** How deep a decision's pointed ends reach in from its box. */
export const DECISION_TIP = 14;

/**
 * Where the text starts and how much room is kept on the right, per card outline: a decision's
 * pointed ends and diamond tile, a pill's round end, a plain step without a tile (text centred).
 */
export function cardInsets(shape: CardShape, theme: Theme, linked = false): { left: number; right: number; centred: boolean } {
  const c = theme.space.card;
  // A linked card keeps the top-right corner free for its link icon.
  const link = linked ? LINK_ROOM : 0;
  if (shape.form === 'decision') return { left: DECISION_TIP + 52, right: DECISION_TIP + 12 + link, centred: false };
  if (!shape.icon) return { left: 20 + link, right: 20 + link, centred: true };
  if (shape.form === 'terminal') return { left: chipLeft(theme), right: 24 + link, centred: false };
  return { left: chipLeft(theme), right: c.padX + link, centred: false };
}

/** Room for the link icon in a card's or group header's top-right corner. */
export const LINK_ROOM = 14;

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
  return Math.ceil(2 * CHIP.padX + (chip.icon ? CHIP.icon + CHIP.iconGap : 0) + measureText(chip.label, chipText(theme), 500));
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
  // The type column is set in the monospace face where the theme asks, a step smaller.
  const mono = look(theme).mono.type;
  for (const r of shape.rows) {
    if (r.kind !== 'row') continue;
    name = Math.max(name, measureText(r.cells[0]?.text ?? '', theme.size.cell, r.cells[0]?.strong ? 600 : 400));
    type = Math.max(type, mono ? measureText(r.cells[1]?.text ?? '', monoCell(theme), 400, 'mono') : measureText(r.cells[1]?.text ?? '', theme.size.cell, 400));
  }
  return { name, type };
}

/** Where a table's rows stand: each row's column (x and width from the table's left edge) and top, and the table's size. */
export interface TableGrid {
  width: number;
  height: number;
  columns: { x: number; width: number }[];
  rows: { column: number; y: number; height: number }[];
}

/** A table's rows in one column, or in two (shape.split): the first column's rows, then the second's beside them. */
export function tableGrid(shape: TableShape, theme: Theme): TableGrid {
  const t = theme.space.table;
  const titleWidth = 16 + 8 + measureText(shape.title, theme.size.label, 600) + (shape.italic ? 4 : 0);
  const captionWidth = shape.caption ? measureText(shape.caption, theme.size.caption, 400) : 0;
  const at = shape.split != null && shape.split > 0 && shape.split < shape.rows.length ? shape.split : shape.rows.length;
  const parts = at < shape.rows.length ? [shape.rows.slice(0, at), shape.rows.slice(at)] : [shape.rows];
  const marks = markWidth(shape);
  const widths = parts.map((rows) => {
    const cols = tableColumns({ ...shape, rows }, theme);
    return 2 * t.padX + marks + cols.name + (cols.type ? CELL_GAP + cols.type : 0);
  });
  // The header spans the columns: a title wider than they are widens the last one.
  const need = Math.max(t.minWidth, 2 * t.padX + Math.max(titleWidth, captionWidth));
  const sum = widths.reduce((a, b) => a + b, 0);
  if (sum < need) widths[widths.length - 1]! += need - sum;
  const columns = widths.map((w, i) => ({ x: Math.round(widths.slice(0, i).reduce((a, b) => a + b, 0)), width: Math.round(w) }));
  const rows: TableGrid['rows'] = [];
  let bottom = tableHeader(shape, theme);
  for (const [column, part] of parts.entries()) {
    let y = tableHeader(shape, theme);
    for (const r of part) {
      const h = r.kind === 'row' ? rowHeight(shape, theme) : sectionHeight(r, theme);
      rows.push({ column, y, height: h });
      y += h;
    }
    bottom = Math.max(bottom, y);
  }
  const last = columns[columns.length - 1]!;
  return { width: last.x + last.width, height: bottom + (shape.rows.length ? 6 : 0), columns, rows };
}

function tableSize(shape: TableShape, theme: Theme): NodeSize {
  const grid = tableGrid(shape, theme);
  const rowY: Record<string, number> = {};
  for (const [i, r] of shape.rows.entries()) if (r.kind === 'row') rowY[r.id] = grid.rows[i]!.y + grid.rows[i]!.height / 2;
  return { width: grid.width, height: grid.height, rowY };
}

/** Room in front of a group's label: its icon and a gap, kept whether or not this group has one so labels line up; nothing where the theme shows no group icons. */
export function groupIconRoom(theme: Theme, image = false): number {
  const icon = look(theme).group.icon;
  return image ? Math.max(24, icon + 8) : icon ? icon + 8 : 0;
}

export function groupLabelWidth(label: string, caption: string | undefined, theme: Theme): number {
  const cap = caption ? 8 + measureText(caption, theme.size.caption, 400) : 0;
  const lab = groupLabel(theme, label);
  return Math.max(24, groupIconRoom(theme)) + measureText(lab.text, lab.size, 600, 'sans', lab.tracking) + cap;
}
