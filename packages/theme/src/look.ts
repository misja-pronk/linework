// The look of a theme with every optional token filled in, so renderers (SVG, slides) read one
// resolved value instead of repeating the defaults. The defaults are the classic look.
import type { LineLook, MonoRole, SketchLook, Theme, TileStyle, ToneColors } from './tokens.ts';

export interface Look {
  group: {
    /** Fill per nesting depth; absent means each tone's wash. */
    tints?: string[];
    /** One outline colour; absent means each tone's line, 'none' no outline. */
    line?: string;
    dash: string;
    caps: boolean;
    size: number;
    tracking: number;
    color: 'tone' | 'muted' | 'text';
    caption: 'faint' | 'muted';
    icon: number;
  };
  tile: TileStyle;
  /** Icon size in a card's 34 px slot. */
  iconSize: number;
  edgeLabel: { style: 'pill' | 'halo' | 'plate'; ink: 'muted' | 'text' | 'line'; caps: boolean; mono: boolean; tracking: number };
  line: Required<LineLook>;
  legend: 'row' | 'key';
  sheet: { marks: 'none' | 'corners' | 'frame'; inset: number; zones: boolean; ticks: boolean; /** Width of the zone band inside a frame. */ band: number };
  tableHead: 'tone' | 'paper' | 'plain';
  number: 'solid' | 'ring' | 'ink';
  chip: 'fill' | 'outline';
  cardLine: 'border' | 'tone';
  title: { mono: boolean; caps: boolean; size: number; weight: 400 | 500 | 600; tracking: number };
  /** Text set in the monospace face. */
  mono: Record<MonoRole, boolean>;
  /** Drawn by hand; absent for every ruled look. */
  sketch?: Required<SketchLook>;
}

const ICON: Record<TileStyle, number> = { soft: 18, solid: 18, outline: 18, bare: 22, disc: 17, ring: 17 };
const cache = new WeakMap<Theme, Look>();

export function look(theme: Theme): Look {
  const hit = cache.get(theme);
  if (hit) return hit;
  const g = theme.group ?? {};
  const caps = g.label === 'caps';
  const tile = theme.tile ?? 'soft';
  const mono = (role: MonoRole) => !!theme.font.monoFor?.includes(role);
  const sheet = theme.sheet ?? { marks: 'none' as const };
  const zones = sheet.marks === 'frame' && !!sheet.zones;
  const made: Look = {
    group: {
      tints: g.tints?.length ? g.tints : undefined,
      line: g.line,
      dash: g.dash ?? '5 4',
      caps,
      size: g.labelSize ?? theme.size.group,
      tracking: g.tracking ?? (caps ? 1 : 0),
      color: g.labelColor ?? 'text',
      caption: g.captionColor ?? 'faint',
      icon: g.icon ?? 16,
    },
    tile,
    iconSize: theme.iconSize ?? ICON[tile],
    edgeLabel: { style: theme.edgeLabel?.style ?? 'pill', ink: theme.edgeLabel?.ink ?? 'muted', caps: !!theme.edgeLabel?.caps, mono: mono('edgeLabel'), tracking: theme.edgeLabel?.caps ? 0.5 : 0 },
    line: {
      bridge: theme.line?.bridge ?? 0,
      junction: theme.line?.junction ?? 'dot',
      junctionSize: theme.line?.junctionSize ?? (theme.line?.junction === 'ring' ? 3.4 : 3),
      corner: theme.line?.corner ?? 'round',
      arrow: theme.line?.arrow ?? 'filled',
      arrowScale: theme.line?.arrowScale ?? 1,
      dashScale: !!theme.line?.dashScale,
    },
    legend: theme.legendStyle ?? 'row',
    sheet: { marks: sheet.marks, inset: sheet.inset ?? (sheet.marks === 'frame' ? 10 : 12), zones, ticks: sheet.marks === 'frame' && !!sheet.ticks, band: zones ? 13 : 0 },
    tableHead: theme.tableHead ?? 'tone',
    number: theme.number ?? 'solid',
    chip: theme.chip ?? 'fill',
    cardLine: theme.cardLine ?? 'border',
    title: { mono: !!theme.title?.mono || mono('title'), caps: !!theme.title?.caps, size: theme.title?.size ?? theme.size.title, weight: theme.title?.weight ?? 600, tracking: theme.title?.tracking ?? 0 },
    mono: { edgeLabel: mono('edgeLabel'), type: mono('type'), title: mono('title') },
    ...(theme.sketch ? { sketch: { roughness: Math.max(0, Math.min(3, theme.sketch.roughness ?? 1)), fill: theme.sketch.fill ?? 'hachure', double: theme.sketch.double ?? true } } : {}),
  };
  cache.set(theme, made);
  return made;
}

/** Fill of a group at a nesting depth (0 = outermost): the depth tint, or the tone's own wash. */
export function groupFill(theme: Theme, depth: number, tone: ToneColors): string {
  const t = look(theme).group.tints;
  return t ? t[Math.min(Math.max(0, depth), t.length - 1)]! : tone.wash;
}

/** Outline of a group; undefined when the theme draws none. */
export function groupLine(theme: Theme, tone: ToneColors): string | undefined {
  const l = look(theme).group.line;
  return l === 'none' ? undefined : (l ?? tone.line);
}

/** The paper tint at a level (0 lightest), for headers and bands that are not groups; undefined on a theme without tints. */
export function paperTint(theme: Theme, level = 1): string | undefined {
  const t = look(theme).group.tints;
  return t ? t[Math.min(level, t.length - 1)] : undefined;
}

/** The deepest ground text can end up on: the last group tint, or the canvas. */
export const deepestGround = (theme: Theme): string => look(theme).group.tints?.at(-1) ?? theme.canvas;

/** A group label as it is drawn: capitals where the theme asks, with its size and letter-spacing. */
export function groupLabel(theme: Theme, label: string): { text: string; size: number; tracking: number } {
  const g = look(theme).group;
  return { text: g.caps ? label.toUpperCase() : label, size: g.size, tracking: g.tracking };
}

export const groupLabelInk = (theme: Theme, tone: ToneColors): string => {
  const c = look(theme).group.color;
  return c === 'tone' ? tone.fg : c === 'muted' ? theme.textMuted : theme.text;
};

export const groupCaptionInk = (theme: Theme): string => (look(theme).group.caption === 'muted' ? theme.textMuted : theme.textFaint);

/** Text size of chips and other small tags: the line label's, a step up where that is set in the (wider, taller) monospace face. */
export const chipText = (theme: Theme): number => theme.size.edgeLabel + (look(theme).edgeLabel.mono ? 1 : 0);

/** Size of the monospace type column next to cell text: a step smaller, so the two x-heights agree. */
export const monoCell = (theme: Theme): number => theme.size.cell - 1;
