// A deck of pictures: a slide each with a title and one picture (SVG, with a PNG for apps that cannot
// show SVG) fitted under it, speaker notes per slide. For what native shapes cannot carry, such as a
// comparison's marks: "Before" and "After" of a change, each with its own marks.
import { zipSync, strToU8 } from 'fflate';
import { themes, type Theme } from '@cartography/theme';
import * as ox from './ooxml.ts';
import { picture, shape } from './shapes.ts';

export interface PictureSlide {
  title: string;
  /** Under the title, smaller. */
  subtitle?: string;
  svg: string;
  /** The same picture as PNG bytes. */
  png?: Uint8Array;
  width: number;
  height: number;
  notes?: string[];
}

const INCH = 914400;
const MARGIN = Math.round(0.45 * INCH);
const PX = 9525;

export function toPictureDeck(list: PictureSlide[], opts: { theme?: 'light' | 'dark' | Theme; title?: string; date?: Date } = {}): Uint8Array {
  const theme = typeof opts.theme === 'object' ? opts.theme : themes[opts.theme ?? 'light'];
  const font = theme.font.sans ?? 'Inter';
  const [W, H] = [12192000, 6858000];
  const files: Record<string, Uint8Array> = {};
  const put = (path: string, xml: string) => (files[path] = strToU8(xml));
  const media: string[] = [];
  for (const [i, s] of list.entries()) {
    const n = i + 1;
    let id = 1;
    let top = MARGIN;
    let tree = shape({ id: ++id, name: 'Title', ph: 'title', frame: { x: MARGIN, y: top, w: W - 2 * MARGIN, h: 0.5 * INCH }, geom: { prst: 'rect' }, text: { anchor: 'ctr', paras: [{ runs: [{ text: s.title, size: 24, bold: true, color: theme.text }] }] } }, font);
    top += 0.5 * INCH;
    if (s.subtitle) {
      tree += shape({ id: ++id, name: 'Subtitle', textBox: true, frame: { x: MARGIN, y: top, w: W - 2 * MARGIN, h: 0.32 * INCH }, geom: { prst: 'rect' }, text: { anchor: 't', paras: [{ runs: [{ text: s.subtitle, size: 13, color: theme.textMuted }] }] } }, font);
      top += 0.32 * INCH;
    }
    top += 0.18 * INCH;
    // Fitted into what is left, never enlarged beyond 1.6 times its size, centred.
    const [bw, bh] = [W - 2 * MARGIN, H - top - MARGIN];
    const k = Math.min(bw / (s.width * PX), bh / (s.height * PX), 1.6);
    const [w, h] = [Math.round(s.width * PX * k), Math.round(s.height * PX * k)];
    const rels: ox.Rel[] = [{ id: 'rId1', type: ox.relType.layout, target: '../slideLayouts/slideLayout1.xml' }];
    rels.push({ id: 'rId2', type: ox.relType.image, target: `../media/picture${n}.svg` });
    files[`ppt/media/picture${n}.svg`] = strToU8(s.svg);
    media.push(`picture${n}.svg`);
    if (s.png) {
      rels.push({ id: 'rId3', type: ox.relType.image, target: `../media/picture${n}.png` });
      files[`ppt/media/picture${n}.png`] = s.png;
      media.push(`picture${n}.png`);
    }
    tree += picture({ id: ++id, name: s.title, descr: s.notes?.join(' ') || s.title, frame: { x: MARGIN + Math.round((bw - w) / 2), y: top + Math.round((bh - h) / 2), w, h }, svg: 'rId2', ...(s.png ? { png: 'rId3' } : {}) });
    put(`ppt/slides/slide${n}.xml`, ox.slideXml(tree));
    put(`ppt/slides/_rels/slide${n}.xml.rels`, ox.rels([...rels, { id: `rId${rels.length + 1}`, type: ox.relType.notes, target: `../notesSlides/notesSlide${n}.xml` }]));
    put(`ppt/notesSlides/notesSlide${n}.xml`, ox.notesSlide(s.notes ?? [s.title]));
    put(`ppt/notesSlides/_rels/notesSlide${n}.xml.rels`, ox.notesRels(n));
  }
  const palette: ox.Palette = { canvas: theme.canvas, text: theme.text, muted: theme.textMuted, accent: ['blue', 'teal', 'violet', 'amber', 'rose', 'green'].map((t) => theme.tones[t as 'blue'].fg), font };
  put('[Content_Types].xml', ox.contentTypes(list.length, media));
  put('_rels/.rels', ox.rootRels());
  put('docProps/core.xml', ox.coreProps(opts.title ?? list[0]?.title ?? 'Comparison', opts.date ?? new Date()));
  put('docProps/app.xml', ox.appProps(list.length));
  put('ppt/presentation.xml', ox.presentation(list.length, W, H));
  put('ppt/_rels/presentation.xml.rels', ox.presentationRels(list.length));
  put('ppt/presProps.xml', ox.presProps());
  put('ppt/viewProps.xml', ox.viewProps());
  put('ppt/tableStyles.xml', ox.tableStyles());
  put('ppt/theme/theme1.xml', ox.theme('Cartography', palette));
  put('ppt/theme/theme2.xml', ox.theme('Cartography Notes', { ...palette, canvas: '#FFFFFF', text: '#000000' }));
  put('ppt/slideMasters/slideMaster1.xml', ox.master(W, H, MARGIN, palette));
  put('ppt/slideMasters/_rels/slideMaster1.xml.rels', ox.masterRels());
  put('ppt/slideLayouts/slideLayout1.xml', ox.layout('titleOnly', W, H, MARGIN));
  put('ppt/slideLayouts/slideLayout2.xml', ox.layout('title', W, H, MARGIN));
  put('ppt/slideLayouts/_rels/slideLayout1.xml.rels', ox.layoutRels());
  put('ppt/slideLayouts/_rels/slideLayout2.xml.rels', ox.layoutRels());
  put('ppt/notesMasters/notesMaster1.xml', ox.notesMaster(palette));
  put('ppt/notesMasters/_rels/notesMaster1.xml.rels', ox.notesMasterRels());
  const ordered = Object.fromEntries(Object.entries(files).sort(([a], [b]) => (a === '[Content_Types].xml' ? -1 : b === '[Content_Types].xml' ? 1 : 0)));
  return zipSync(ordered, { level: 6 });
}
