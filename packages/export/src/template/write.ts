// A deck built inside a template: the template's masters, layouts, theme, fonts and media stay as
// they are; its sample slides go (unless kept), the diagram slides come in, and the package parts
// that list slides (presentation, its relationships, content types, sections) are edited in place.
import { strFromU8, strToU8, zipSync } from 'fflate';
import * as ox from '../ooxml.ts';
import { child, children, parseXml, type XmlNode } from './xml.ts';
import { relsOf, relsPath, text, type PptxTemplate } from './read.ts';

export interface DeckSlide {
  xml: string;
  /** Its relationships but the notes: the layout one (pointed at `layout` here), icon pictures (../media/…). */
  rels: ox.Rel[];
  /** The template layout, as a part path. */
  layout: string;
  notes: string[];
}

export interface TemplateDeckOptions {
  /** Keep the template's own slides, in front of the diagrams. */
  keepSlides?: boolean;
  title: string;
  date: Date;
}

const PML = 'application/vnd.openxmlformats-officedocument.presentationml';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/** A relative target from one part to another: ppt/slides/slide1.xml → ppt/slideLayouts/x.xml is ../slideLayouts/x.xml. */
export function relative(from: string, to: string): string {
  const a = from.split('/').slice(0, -1);
  const b = to.split('/');
  let i = 0;
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
  return [...a.slice(i).map(() => '..'), ...b.slice(i)].join('/');
}

/** Replaces one element (found in `source`) with `xml`. */
const splice = (source: string, node: XmlNode, xml: string) => source.slice(0, node.start) + xml + source.slice(node.end);

/** A name not taken yet: ppt/slides/slide{n}.xml with the first free n from `from`. */
function free(files: Record<string, unknown>, pattern: (n: number) => string, from = 1): string {
  let n = from;
  while (files[pattern(n)]) n++;
  return pattern(n);
}

/** Every part reachable from the package relationships; the rest is left behind. */
function reachable(files: Record<string, Uint8Array>): Set<string> {
  const seen = new Set<string>();
  const walk = (part: string) => {
    for (const r of relsOf(files, part)) {
      if (!r.part || seen.has(r.part) || !files[r.part]) continue;
      seen.add(r.part);
      walk(r.part);
    }
  };
  walk('');
  return seen;
}

export function writeTemplateDeck(t: PptxTemplate, slides: DeckSlide[], media: Record<string, Uint8Array>, opts: TemplateDeckOptions): Uint8Array {
  const files: Record<string, Uint8Array> = { ...t.files };
  const put = (path: string, xml: string) => (files[path] = strToU8(xml));
  const main = relsOf(files, '').find((r) => r.type.endsWith('/officeDocument'))!.part!;
  const mainRels = relsPath(main);
  let pres = text(files, main);
  let presRels = relsOf(files, main);

  // The template's slides: dropped with their relationships, their notes and their place in any section.
  if (!opts.keepSlides && t.slides.length) {
    const gone = new Set(t.slides);
    const ids = new Set(presRels.filter((r) => r.part && gone.has(r.part)).map((r) => r.id));
    presRels = presRels.filter((r) => !ids.has(r.id));
    const list = child(parseXml(pres), 'p:presentation/p:sldIdLst');
    if (list) pres = splice(pres, list, '<p:sldIdLst/>');
    for (const s of t.slides) {
      // Their notes go with them, so the new notes can take the names.
      for (const r of relsOf(files, s).filter((x) => x.part && x.type.endsWith('/notesSlide'))) {
        delete files[r.part!];
        delete files[relsPath(r.part!)];
      }
      delete files[s];
      delete files[relsPath(s)];
    }
  }
  // Sections and custom shows name slides: with the sample slides gone they would point at nothing.
  if (!opts.keepSlides) pres = pres.replace(/<p:custShowLst>[\s\S]*?<\/p:custShowLst>|<p:custShowLst\/>/, '');
  if (!opts.keepSlides) pres = pres.replace(/<p:ext uri="\{521415D9-36F7-43E2-AB2F-B90AF26B5E84\}">[\s\S]*?<\/p:ext>/, '').replace(/<p:extLst><\/p:extLst>|<p:extLst\/>/, '');

  // Speaker notes need a notes master: the template's, or a plain one with a theme of its own.
  const presDir = main.slice(0, main.lastIndexOf('/') + 1);
  const rid = (() => {
    let n = Math.max(0, ...presRels.map((r) => Number(/^rId(\d+)$/.exec(r.id)?.[1] ?? 0)));
    return () => `rId${++n}`;
  })();
  let notesMaster = t.notesMaster?.path;
  const notesIdx = t.notesMaster?.bodyIdx ?? 1;
  const added: [string, string][] = [];
  if (!notesMaster) {
    notesMaster = free(files, (n) => `${presDir}notesMasters/notesMaster${n}.xml`);
    const themePart = free(files, (n) => `${presDir}theme/theme${n}.xml`);
    const palette: ox.Palette = { canvas: '#FFFFFF', text: '#000000', muted: '#595959', accent: [t.colors.accent1, t.colors.accent2, t.colors.accent3, t.colors.accent4, t.colors.accent5, t.colors.accent6], font: t.fonts.minor };
    put(notesMaster, ox.notesMaster(palette));
    put(relsPath(notesMaster), ox.rels([{ id: 'rId1', type: ox.relType.theme, target: relative(notesMaster, themePart) }]));
    put(themePart, ox.theme('Notes', palette));
    added.push([notesMaster, `${PML}.notesMaster+xml`], [themePart, 'application/vnd.openxmlformats-officedocument.theme+xml']);
    const id = rid();
    presRels.push({ id, type: ox.relType.notesMaster, target: relative(main, notesMaster), part: notesMaster });
    // Schema order: notesMasterIdLst follows sldMasterIdLst.
    const p = child(parseXml(pres), 'p:presentation')!;
    const old = child(p, 'p:notesMasterIdLst');
    const entry = `<p:notesMasterIdLst><p:notesMasterId r:id="${id}"/></p:notesMasterIdLst>`;
    const masters = child(p, 'p:sldMasterIdLst')!;
    pres = old ? splice(pres, old, entry) : pres.slice(0, masters.end) + entry + pres.slice(masters.end);
  }

  // The diagram slides, after any kept ones, each with its notes.
  const kept = opts.keepSlides ? t.slides : [];
  const sldIds: string[] = [];
  const p = child(parseXml(pres), 'p:presentation')!;
  let nextId = Math.max(255, ...children(child(p, 'p:sldIdLst'), 'p:sldId').map((s) => Number(s.attrs.id) || 0));
  let n = 0;
  for (const s of slides) {
    const slide = free(files, (k) => `${presDir}slides/slide${k}.xml`, kept.length + ++n);
    const notes = free(files, (k) => `${presDir}notesSlides/notesSlide${k}.xml`, kept.length + n);
    const rels: ox.Rel[] = s.rels.map((r) => (r.type === ox.relType.layout ? { ...r, target: relative(slide, s.layout) } : r));
    rels.push({ id: `rId${rels.length + 1}`, type: ox.relType.notes, target: relative(slide, notes) });
    put(slide, s.xml);
    put(relsPath(slide), ox.rels(rels));
    put(notes, ox.notesSlide(s.notes, notesIdx));
    put(relsPath(notes), ox.rels([{ id: 'rId1', type: ox.relType.notesMaster, target: relative(notes, notesMaster) }, { id: 'rId2', type: ox.relType.slide, target: relative(notes, slide) }]));
    added.push([slide, `${PML}.slide+xml`], [notes, `${PML}.notesSlide+xml`]);
    const id = rid();
    presRels.push({ id, type: ox.relType.slide, target: relative(main, slide), part: slide });
    sldIds.push(`<p:sldId id="${++nextId}" r:id="${id}"/>`);
  }
  for (const [path, data] of Object.entries(media)) files[path] = data;
  // Kept slides keep their sections; the diagrams join the last one, as every slide must be in one.
  if (opts.keepSlides) pres = pres.replace(/<\/p14:sldIdLst><\/p14:section><\/p14:sectionLst>/, `${sldIds.map((s) => `<p14:sldId id="${/id="(\d+)"/.exec(s)![1]}"/>`).join('')}</p14:sldIdLst></p14:section></p14:sectionLst>`);
  {
    const root = child(parseXml(pres), 'p:presentation')!;
    const list = child(root, 'p:sldIdLst');
    const inner = list ? pres.slice(list.start, list.end).replace(/^<p:sldIdLst\s*\/>$/, '<p:sldIdLst></p:sldIdLst>').replace(/<\/p:sldIdLst>$/, `${sldIds.join('')}</p:sldIdLst>`) : '';
    if (list) pres = splice(pres, list, inner);
    else {
      // Schema order: sldIdLst after the master lists, before sldSz.
      const after = child(root, 'p:handoutMasterIdLst') ?? child(root, 'p:notesMasterIdLst') ?? child(root, 'p:sldMasterIdLst')!;
      pres = pres.slice(0, after.end) + `<p:sldIdLst>${sldIds.join('')}</p:sldIdLst>` + pres.slice(after.end);
    }
  }
  put(main, pres);
  put(mainRels, ox.rels(presRels.map(({ id, type, target }) => ({ id, type, target }))));

  // A thumbnail of the template's first slide would be the deck's preview in Finder and Explorer: dropped.
  const root = relsOf(files, '').filter((r) => !r.type.endsWith('/metadata/thumbnail'));
  for (const r of relsOf(files, '').filter((x) => x.type.endsWith('/metadata/thumbnail'))) if (r.part) delete files[r.part];
  const core = root.find((r) => r.type.endsWith('/core-properties'))?.part ?? 'docProps/core.xml';
  const app = root.find((r) => r.type.endsWith('/extended-properties'))?.part ?? 'docProps/app.xml';
  put(core, ox.coreProps(opts.title, opts.date));
  put(app, ox.appProps(kept.length + slides.length));
  // Nothing refers to the package relationships by id, so they are numbered afresh.
  const rootRels = [
    ...root.filter((r) => !r.type.endsWith('/core-properties') && !r.type.endsWith('/extended-properties')),
    { type: 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties', target: core },
    { type: `${R}/extended-properties`, target: app },
  ];
  put('_rels/.rels', ox.rels(rootRels.map(({ type, target }, i) => ({ id: `rId${i + 1}`, type, target }))));
  if (!root.some((r) => r.type.endsWith('/core-properties'))) added.push([core, 'application/vnd.openxmlformats-package.core-properties+xml']);
  if (!root.some((r) => r.type.endsWith('/extended-properties'))) added.push([app, 'application/vnd.openxmlformats-officedocument.extended-properties+xml']);

  // What no relationship reaches any more (a sample slide's picture, its notes) is not shipped.
  const live = reachable(files);
  for (const path of Object.keys(files)) {
    if (path === '[Content_Types].xml' || path.endsWith('.rels')) continue;
    if (!live.has(path)) delete files[path];
  }
  for (const path of Object.keys(files)) if (path.endsWith('.rels') && path !== '_rels/.rels' && !files[path.replace(/_rels\/([^/]+)\.rels$/, '$1')]) delete files[path];

  files['[Content_Types].xml'] = strToU8(contentTypes(strFromU8(t.files['[Content_Types].xml'] ?? new Uint8Array()), files, added, main));
  const ordered = Object.fromEntries(Object.entries(files).sort(([a], [b]) => (a === '[Content_Types].xml' ? -1 : b === '[Content_Types].xml' ? 1 : 0)));
  return zipSync(ordered, { level: 6 });
}

const MEDIA: Record<string, string> = { png: 'image/png', svg: 'image/svg+xml', jpeg: 'image/jpeg', jpg: 'image/jpeg', gif: 'image/gif', emf: 'image/x-emf', wmf: 'image/x-wmf', tif: 'image/tiff', tiff: 'image/tiff', xml: 'application/xml', rels: 'application/vnd.openxmlformats-package.relationships+xml' };

/** The template's content types for the parts still there, the new ones added, and a .potx main part made a presentation. */
function contentTypes(source: string, files: Record<string, Uint8Array>, added: [string, string][], main: string): string {
  const doc = child(parseXml(source || '<Types/>'), 'Types');
  const defaults = new Map(children(doc, 'Default').map((d) => [d.attrs.Extension!.toLowerCase(), d.attrs.ContentType!]));
  const overrides = new Map(children(doc, 'Override').map((o) => [o.attrs.PartName!.replace(/^\//, ''), o.attrs.ContentType!]));
  for (const [part, type] of added) overrides.set(part, type);
  overrides.set(main, `${PML}.presentation.main+xml`);
  for (const part of [...overrides.keys()]) if (!files[part]) overrides.delete(part);
  for (const part of Object.keys(files)) {
    if (part === '[Content_Types].xml' || overrides.has(part)) continue;
    const ext = part.split('.').pop()!.toLowerCase();
    if (!defaults.has(ext) && MEDIA[ext]) defaults.set(ext, MEDIA[ext]);
  }
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="${ox.NS.ct}">` +
    [...defaults].map(([e, c]) => `<Default Extension="${ox.esc(e)}" ContentType="${ox.esc(c)}"/>`).join('') +
    [...overrides].map(([p, c]) => `<Override PartName="/${ox.esc(p)}" ContentType="${ox.esc(c)}"/>`).join('') +
    '</Types>'
  );
}
