// The built-in looks. Survey is the default: a diagram drawn like a map sheet. Transit and Drafting
// are the two optional styles; classic is the look Cartography had before (see docs/style.md).
import { tones as toneSlots, type Tone } from '@cartography/core';
import { classic, classicDark, shared, type Theme, type ToneColors } from './tokens.ts';

type Pairs = Record<Tone, [fg: string, bg: string]>;

/** Tone table from fg/bg pairs; group wash and line are the same for every tone (depth, not colour, tells groups apart). */
const tones = (pairs: Pairs, wash: string, line: string) => Object.fromEntries(toneSlots.map((t) => [t, { fg: pairs[t][0], bg: pairs[t][1], wash, line }])) as Record<Tone, ToneColors>;

const FALLBACK = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif";
const MONO_FALLBACK = "ui-monospace, 'SF Mono', Menlo, Consolas, monospace";

// ---------------------------------------------------------------- Survey

const surveyShape = {
  ...shared,
  font: {
    family: `'Instrument Sans', Inter, ${FALLBACK}`,
    mono: `'Geist Mono', ${MONO_FALLBACK}`,
    sans: 'Instrument Sans',
    monoFace: 'Geist Mono',
    monoFor: ['edgeLabel', 'type'],
  },
  size: { ...shared.size, group: 10.5, edgeLabel: 10 },
  // Line labels in the monospace face run a little wider than Inter did: two pixels more between layers keeps a label on a short hop clear of both cards.
  space: { ...shared.space, layerGap: 74 },
  radius: { card: 6, group: 8, tile: 6, chip: 4, pill: 999, corner: 8 },
  stroke: { card: 1, group: 1, edge: 1.3, icon: 1.6 },
  tile: 'bare',
  iconSize: 22,
  edgeLabel: { style: 'halo', ink: 'muted' },
  line: { bridge: 4, junction: 'ring', junctionSize: 3.4 },
  legendStyle: 'key',
  sheet: { marks: 'corners', inset: 12 },
  tableHead: 'paper',
  number: 'ink',
} satisfies Partial<Theme>;

const surveyGroup = { dash: '4 3', label: 'caps', labelSize: 10.5, tracking: 1, labelColor: 'muted', captionColor: 'muted', icon: 14 } as const;

// The inks differ in lightness as well as hue, so no two of them become one colour for a colour-blind
// reader (test/looks.test.ts simulates protanopia, deuteranopia and tritanopia over these ramps).
const surveyInks: Pairs = {
  blue: ['#2B62A3', '#E6EDF6'],
  sky: ['#1E7495', '#E3F0F5'],
  indigo: ['#40429B', '#EAEAF6'],
  violet: ['#7655C1', '#F0E9F5'],
  teal: ['#2A6B5C', '#E2F1EF'],
  green: ['#3D7938', '#E7F1E5'],
  amber: ['#806514', '#F5EEDD'],
  orange: ['#B5491B', '#F8E9E1'],
  rose: ['#9B2834', '#F8E7EA'],
  // A warm grey: muted cards and neutral chips belong to the paper, not to a cooler sheet laid over it.
  slate: ['#4E5A65', '#EDEBE6'],
};

/** Survey: white page, paper-tinted terrain that deepens as groups nest, hairline contours, bare icons in map inks. */
export const survey: Theme = {
  ...surveyShape,
  name: 'survey',
  mode: 'light',
  canvas: '#FFFFFF',
  surface: '#FFFFFF',
  border: '#CBC7BD',
  text: '#16212C',
  textMuted: '#4F5B66',
  textFaint: '#5D6670',
  edge: '#5E6A75',
  shadow: { color: '#16212C', opacity: 0 },
  accent: '#B5491B',
  tones: tones(surveyInks, '#F8F6F1', '#D3CDBE'),
  group: { ...surveyGroup, tints: ['#F8F6F1', '#F0EDE4', '#E8E4D8'], line: '#D3CDBE' },
};

/** The same sheet with cool grey terrain, for decks whose own palette is cold. */
export const surveyCool: Theme = {
  ...survey,
  name: 'survey-cool',
  border: '#C6CCD3',
  tones: tones({ ...surveyInks, slate: ['#4E5A65', '#ECEEF0'] }, '#F5F7F9', '#CDD4DB'),
  group: { ...surveyGroup, tints: ['#F5F7F9', '#ECEFF3', '#E2E7EC'], line: '#CDD4DB' },
};

/** Survey at night: terrain gets lighter as it nests and cards are the lightest ground. */
export const surveyDark: Theme = {
  ...surveyShape,
  name: 'survey-dark',
  mode: 'dark',
  canvas: '#13171B',
  surface: '#2A3138',
  border: '#48525C',
  text: '#ECE9E2',
  textMuted: '#AEB4BA',
  textFaint: '#949CA4',
  edge: '#949DA6',
  shadow: { color: '#000000', opacity: 0 },
  accent: '#E8875A',
  tones: tones(
    {
      blue: ['#8BADFB', '#243652'],
      sky: ['#5DAABB', '#1E3944'],
      indigo: ['#C4BAFF', '#2D2F56'],
      violet: ['#CD92D9', '#3A2C49'],
      teal: ['#67DBD4', '#1C3B38'],
      green: ['#94D78F', '#253B23'],
      amber: ['#EBB13C', '#40331A'],
      orange: ['#EA8A5E', '#472A1D'],
      rose: ['#D1838D', '#482329'],
      slate: ['#AEB4BA', '#353D45'],
    },
    '#181D21',
    '#39424A',
  ),
  group: { ...surveyGroup, tints: ['#181D21', '#1E2429', '#242B31'], line: '#39424A' },
};

// ---------------------------------------------------------------- Transit

const transitShape = {
  ...shared,
  font: { family: `Barlow, Inter, ${FALLBACK}`, mono: shared.font.mono, sans: 'Barlow' },
  size: { ...shared.size, label: 14.5, caption: 12, subtitle: 13.5, group: 11, edgeLabel: 10.5, cell: 12.5 },
  space: { ...shared.space, layerGap: 76 },
  radius: { card: 14, group: 18, tile: 17, chip: 9, pill: 999, corner: 12 },
  stroke: { card: 1, group: 1, edge: 2.3, icon: 1.75 },
  tile: 'disc',
  iconSize: 17,
  edgeLabel: { style: 'halo', ink: 'line', caps: true },
  line: { junction: 'ring', junctionSize: 5, corner: 'chamfer', arrow: 'slim', arrowScale: 1.25, dashScale: true },
  legendStyle: 'key',
  tableHead: 'paper',
  number: 'ring',
} satisfies Partial<Theme>;

const transitGroup = { line: 'none', label: 'caps', labelSize: 11, tracking: 1.2, labelColor: 'text', captionColor: 'muted', icon: 0 } as const;

/** Transit: the lines are the diagram. Thick routes cut at 45 degrees, round stations, flat grey zones. */
export const transit: Theme = {
  ...transitShape,
  name: 'transit',
  mode: 'light',
  canvas: '#FFFFFF',
  surface: '#FFFFFF',
  border: '#B9BFC6',
  text: '#11181F',
  textMuted: '#48525C',
  textFaint: '#5B636C',
  edge: '#2B333B',
  shadow: { color: '#11181F', opacity: 0 },
  accent: '#DC241F',
  tones: tones(
    {
      blue: ['#0B4EA2', '#E3ECF7'],
      sky: ['#0F70A8', '#DFF0F8'],
      indigo: ['#4A26C1', '#E7E8F6'],
      violet: ['#8E41CC', '#F2E6F5'],
      teal: ['#1A7260', '#DDF1EF'],
      green: ['#086207', '#E0F1E5'],
      amber: ['#8E6400', '#FBEED6'],
      orange: ['#9C3502', '#FCE8D9'],
      rose: ['#BB0046', '#FBE3E8'],
      slate: ['#48525C', '#E9EBED'],
    },
    '#F3F4F6',
    '#DDE0E5',
  ),
  group: { ...transitGroup, tints: ['#F3F4F6', '#E8EAEE', '#DDE0E5'] },
};

export const transitDark: Theme = {
  ...transitShape,
  name: 'transit-dark',
  mode: 'dark',
  canvas: '#0E1114',
  surface: '#2B323A',
  border: '#4A545E',
  text: '#F2F4F6',
  textMuted: '#A9B1BA',
  textFaint: '#929BA4',
  edge: '#C9D0D7',
  shadow: { color: '#000000', opacity: 0 },
  accent: '#FF6B61',
  tones: tones(
    {
      blue: ['#6AA5F5', '#1A2F52'],
      sky: ['#70C3FE', '#113647'],
      indigo: ['#A593DA', '#2A2C58'],
      violet: ['#C883BF', '#3D2447'],
      teal: ['#24DBD3', '#103A37'],
      green: ['#92D184', '#143C23'],
      amber: ['#F4B82D', '#413010'],
      orange: ['#EA9438', '#472511'],
      rose: ['#FC6B80', '#4A1822'],
      slate: ['#A9B1BA', '#363E47'],
    },
    '#151A1E',
    '#252C33',
  ),
  group: { ...transitGroup, tints: ['#151A1E', '#1B2126', '#22282E'] },
};

// ---------------------------------------------------------------- Drafting

const draftingShape = {
  ...shared,
  font: {
    family: `'IBM Plex Sans', Inter, ${FALLBACK}`,
    mono: `'IBM Plex Mono', ${MONO_FALLBACK}`,
    sans: 'IBM Plex Sans',
    monoFace: 'IBM Plex Mono',
    monoFor: ['edgeLabel', 'type', 'title'],
  },
  size: { ...shared.size, title: 16, group: 10.5, edgeLabel: 10 },
  // A plate around a monospace label needs more room on a short hop than a pill did.
  space: { ...shared.space, layerGap: 80 },
  radius: { card: 2, group: 2, tile: 2, chip: 2, pill: 999, corner: 0 },
  stroke: { card: 1.2, group: 1, edge: 1.2, icon: 1.5 },
  tile: 'outline',
  edgeLabel: { style: 'plate', ink: 'text' },
  line: { bridge: 4, corner: 'square', arrow: 'open', arrowScale: 1.1 },
  legendStyle: 'key',
  sheet: { marks: 'frame', inset: 10, zones: true, ticks: true },
  tableHead: 'plain',
  number: 'ring',
  chip: 'outline',
  title: { mono: true, caps: true, size: 16, weight: 500, tracking: 1 },
} satisfies Partial<Theme>;

const draftingGroup = { dash: '8 3 2 3', label: 'caps', labelSize: 10.5, tracking: 1, labelColor: 'text', captionColor: 'muted', icon: 0 } as const;
const ink = (fg: string, bg: string, signal: [string, string]): Pairs => Object.fromEntries(toneSlots.map((t) => [t, t === 'blue' ? signal : [fg, bg]])) as Pairs;

/** Drafting: an engineering drawing. Ink lines, square corners, monospace lettering, one signal colour. */
export const drafting: Theme = {
  ...draftingShape,
  name: 'drafting',
  mode: 'light',
  canvas: '#FFFFFF',
  surface: '#FFFFFF',
  border: '#20262E',
  text: '#0E1116',
  textMuted: '#3F4650',
  textFaint: '#6B7480',
  edge: '#20262E',
  shadow: { color: '#0E1116', opacity: 0 },
  accent: '#1D3FCF',
  tones: tones(ink('#20262E', '#EEF0F2', ['#1D3FCF', '#E8ECFB']), '#FFFFFF', '#8A929C'),
  group: { ...draftingGroup, tints: ['#FFFFFF', '#FFFFFF', '#FFFFFF'], line: '#8A929C' },
  background: { dots: { step: 16, r: 0.6, color: '#CDD3DA' } },
};

export const draftingDark: Theme = {
  ...draftingShape,
  name: 'drafting-dark',
  mode: 'dark',
  canvas: '#0F1317',
  surface: '#0F1317',
  border: '#C3CAD2',
  text: '#E6E9ED',
  textMuted: '#AAB2BC',
  textFaint: '#8B949F',
  edge: '#C3CAD2',
  shadow: { color: '#000000', opacity: 0 },
  accent: '#8FA6FF',
  tones: tones(ink('#D5DAE0', '#232A32', ['#8FA6FF', '#1E2A52']), '#0F1317', '#6B7480'),
  group: { ...draftingGroup, tints: ['#0F1317', '#0F1317', '#0F1317'], line: '#6B7480' },
  background: { dots: { step: 16, r: 0.6, color: '#2A3139' } },
};

/** `light` and `dark` are the default look in its two modes. */
export const light = survey;
export const dark = surveyDark;

/** The built-in themes that are whole token sets (the brand examples slate, ocean and mono are specs on classic). */
export const builtinLooks: Record<string, { theme: Theme; description: string }> = {
  survey: { theme: survey, description: 'The default: a map sheet. White page, paper-tinted zones that deepen as they nest, bare icons, labels set on the lines' },
  'survey-dark': { theme: surveyDark, description: 'Survey at night, for dark slides and screens' },
  'survey-cool': { theme: surveyCool, description: 'Survey with cool grey zones instead of warm paper, for decks with a cold palette' },
  transit: { theme: transit, description: 'A network map: thick routes cut at 45 degrees, round stations, flat grey zones. For flows where the lines are the story' },
  'transit-dark': { theme: transitDark, description: 'Transit on a dark page' },
  drafting: { theme: drafting, description: 'An engineering drawing: ink lines, square corners, monospace lettering, a frame with zones. For specifications and print' },
  'drafting-dark': { theme: draftingDark, description: 'Drafting as a blueprint on a dark page' },
  classic: { theme: classic, description: 'The look before Survey: Inter, soft icon tiles, tone-washed groups, pill labels' },
  'classic-dark': { theme: classicDark, description: 'Classic on a dark page' },
};
