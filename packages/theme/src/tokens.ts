// One set of design tokens for every diagram type (requirement V2). Change the look here.
import type { Tone } from '@cartography/core';

export interface ToneColors {
  /** Icons, strong accents, coloured lines. */
  fg: string;
  /** Icon tiles and table headers. */
  bg: string;
  /** Group fills: barely there. */
  wash: string;
  /** Group borders. */
  line: string;
}

/** A font file carried by the theme, embedded in SVG as @font-face (base64). */
export interface FontFace {
  family: string;
  weight: number;
  style: 'normal' | 'italic';
  format: 'woff2' | 'woff' | 'truetype' | 'opentype';
  data: string;
  /** Where it came from, for renderers that read files (resvg); absent in the browser. */
  file?: string;
}

/** The deliverable frame around a diagram: logo, client, version, footer (brand themes). */
export interface TitleBlock {
  /** An image as a data URI, drawn as-is in the header. */
  logo?: { href: string; width: number; height: number };
  client?: string;
  project?: string;
  version?: string;
  date?: string;
  classification?: string;
  footer?: string;
}

export type LegendPosition = 'bottom' | 'top' | 'right' | 'none';

export interface Theme {
  /** light, dark, a built-in brand theme or the name in a theme file. */
  name: string;
  /** Whether the theme is light or dark: the editor chrome follows it. */
  mode: 'light' | 'dark';
  canvas: string;
  surface: string;
  border: string;
  text: string;
  textMuted: string;
  textFaint: string;
  edge: string;
  shadow: { color: string; opacity: number };
  tones: Record<Tone, ToneColors>;
  font: {
    family: string;
    mono: string;
    faces?: FontFace[];
    /** Width of the font against Inter's metrics, so text measured with Inter fits a wider or narrower face. */
    scale?: number;
  };
  size: {
    title: number;
    subtitle: number;
    label: number;
    caption: number;
    group: number;
    edgeLabel: number;
    cell: number;
  };
  radius: { card: number; group: number; tile: number; chip: number; pill: number; corner: number };
  space: {
    pad: number;
    card: { height: number; padX: number; tile: number; gap: number; minWidth: number; maxWidth: number };
    table: { header: number; row: number; section: number; padX: number; minWidth: number };
    group: { header: number; pad: number };
    nodeGap: number;
    layerGap: number;
  };
  stroke: { card: number; group: number; edge: number; icon: number };
  /** Brand colour for the title rule and other details; absent in the plain themes. */
  accent?: string;
  titleBlock?: TitleBlock;
  legend?: LegendPosition;
  /** Icon tiles: soft tint (default), solid tone with a light icon, or an outline for print. */
  tile?: 'soft' | 'solid' | 'outline';
  /** A tone bar along the left edge of cards. */
  cardBar?: boolean;
}

const shared = {
  font: {
    family: "Inter, 'Inter Variable', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
    mono: "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
  },
  size: { title: 20, subtitle: 13, label: 13.5, caption: 11.5, group: 12, edgeLabel: 11, cell: 12 },
  radius: { card: 12, group: 16, tile: 9, chip: 6, pill: 999, corner: 10 },
  space: {
    pad: 40,
    card: { height: 58, padX: 12, tile: 34, gap: 12, minWidth: 172, maxWidth: 280 },
    table: { header: 44, row: 28, section: 24, padX: 14, minWidth: 200 },
    group: { header: 44, pad: 20 },
    nodeGap: 36,
    layerGap: 72,
  },
  stroke: { card: 1, group: 1, edge: 1.4, icon: 1.75 },
} as const;

export const light: Theme = {
  ...shared,
  name: 'light',
  mode: 'light',
  canvas: '#FFFFFF',
  surface: '#FFFFFF',
  border: '#DDE2E8',
  text: '#0F172A',
  textMuted: '#556070',
  textFaint: '#8A93A2',
  edge: '#8792A4',
  shadow: { color: '#0F172A', opacity: 0.07 },
  tones: {
    blue: { fg: '#2563EB', bg: '#E8F0FE', wash: '#F6F9FF', line: '#CCDBFA' },
    sky: { fg: '#0284C7', bg: '#E2F2FB', wash: '#F4FAFE', line: '#C2E2F4' },
    indigo: { fg: '#4F46E5', bg: '#ECEBFD', wash: '#F8F8FF', line: '#D5D3F8' },
    violet: { fg: '#7C3AED', bg: '#F1EBFE', wash: '#FAF7FF', line: '#DED0FA' },
    teal: { fg: '#0D9488', bg: '#E1F5F2', wash: '#F4FBFA', line: '#BFE5E0' },
    green: { fg: '#15803D', bg: '#E4F5E9', wash: '#F5FBF7', line: '#C4E6CF' },
    amber: { fg: '#B45309', bg: '#FDF1DC', wash: '#FFFAF1', line: '#F2D7A8' },
    orange: { fg: '#C2410C', bg: '#FDECE1', wash: '#FFF8F3', line: '#F4CDB6' },
    rose: { fg: '#E11D48', bg: '#FDE8EC', wash: '#FFF7F8', line: '#F6C7D2' },
    slate: { fg: '#475569', bg: '#EEF1F5', wash: '#F8F9FB', line: '#D7DCE3' },
  },
};

export const dark: Theme = {
  ...shared,
  name: 'dark',
  mode: 'dark',
  canvas: '#0D1117',
  surface: '#161B23',
  border: '#2A313C',
  text: '#E8EBF0',
  textMuted: '#A2AAB8',
  textFaint: '#6F7887',
  edge: '#6E7A8C',
  shadow: { color: '#000000', opacity: 0.35 },
  tones: {
    blue: { fg: '#7AA7FF', bg: '#1B2A47', wash: '#111827', line: '#26385C' },
    sky: { fg: '#5CC2F2', bg: '#132D3D', wash: '#0F1A22', line: '#1F4053' },
    indigo: { fg: '#9B97FF', bg: '#23234A', wash: '#13142A', line: '#30305E' },
    violet: { fg: '#B794FF', bg: '#2A2046', wash: '#16122A', line: '#3A2D5E' },
    teal: { fg: '#4FD1C1', bg: '#11312E', wash: '#0E1B1A', line: '#1C4440' },
    green: { fg: '#6BD58D', bg: '#14301F', wash: '#0F1B14', line: '#1F4330' },
    amber: { fg: '#F2B54A', bg: '#33260F', wash: '#1C160C', line: '#4A3816' },
    orange: { fg: '#FF9461', bg: '#3A2114', wash: '#1F140E', line: '#55301C' },
    rose: { fg: '#FF7A93', bg: '#3A1621', wash: '#1F1015', line: '#55202F' },
    slate: { fg: '#A4AFBF', bg: '#222934', wash: '#12161D', line: '#2E3642' },
  },
};

