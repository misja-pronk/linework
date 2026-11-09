// The fixed parts of a .pptx: content types, relationships, one master with a title-only and a
// title-slide layout, a theme, a notes master. Kept as small as PowerPoint, Keynote and
// LibreOffice accept; everything a slide shows is written by slide.ts.

export const NS = {
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  p: 'http://schemas.openxmlformats.org/presentationml/2006/main',
  rel: 'http://schemas.openxmlformats.org/package/2006/relationships',
  ct: 'http://schemas.openxmlformats.org/package/2006/content-types',
  doc: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
};
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PML = `xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}"`;
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

export const esc = (s: string) =>
  s
    // Control characters are not allowed in XML 1.0 at all.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export interface Rel {
  id: string;
  type: string;
  target: string;
}

export const relType = {
  slide: `${R}/slide`,
  layout: `${R}/slideLayout`,
  master: `${R}/slideMaster`,
  theme: `${R}/theme`,
  notes: `${R}/notesSlide`,
  notesMaster: `${R}/notesMaster`,
  image: `${R}/image`,
  presProps: `${R}/presProps`,
  viewProps: `${R}/viewProps`,
  tableStyles: `${R}/tableStyles`,
};

export function rels(list: Rel[]): string {
  return `${HEAD}<Relationships xmlns="${NS.rel}">${list.map((r) => `<Relationship Id="${r.id}" Type="${r.type}" Target="${esc(r.target)}"/>`).join('')}</Relationships>`;
}

export function contentTypes(slides: number, media: string[]): string {
  const ext = new Set(media.map((m) => m.split('.').pop()!));
  const types: Record<string, string> = { png: 'image/png', svg: 'image/svg+xml' };
  const pml = 'application/vnd.openxmlformats-officedocument.presentationml';
  const over = (part: string, type: string) => `<Override PartName="/${part}" ContentType="${type}"/>`;
  const parts = [
    over('ppt/presentation.xml', `${pml}.presentation.main+xml`),
    over('ppt/slideMasters/slideMaster1.xml', `${pml}.slideMaster+xml`),
    over('ppt/slideLayouts/slideLayout1.xml', `${pml}.slideLayout+xml`),
    over('ppt/slideLayouts/slideLayout2.xml', `${pml}.slideLayout+xml`),
    over('ppt/notesMasters/notesMaster1.xml', `${pml}.notesMaster+xml`),
    over('ppt/theme/theme1.xml', 'application/vnd.openxmlformats-officedocument.theme+xml'),
    over('ppt/theme/theme2.xml', 'application/vnd.openxmlformats-officedocument.theme+xml'),
    over('ppt/presProps.xml', `${pml}.presProps+xml`),
    over('ppt/viewProps.xml', `${pml}.viewProps+xml`),
    over('ppt/tableStyles.xml', `${pml}.tableStyles+xml`),
    over('docProps/core.xml', 'application/vnd.openxmlformats-package.core-properties+xml'),
    over('docProps/app.xml', 'application/vnd.openxmlformats-officedocument.extended-properties+xml'),
  ];
  for (let i = 1; i <= slides; i++) parts.push(over(`ppt/slides/slide${i}.xml`, `${pml}.slide+xml`), over(`ppt/notesSlides/notesSlide${i}.xml`, `${pml}.notesSlide+xml`));
  return (
    `${HEAD}<Types xmlns="${NS.ct}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>` +
    [...ext].map((e) => `<Default Extension="${e}" ContentType="${types[e]}"/>`).join('') +
    parts.join('') +
    '</Types>'
  );
}

export function rootRels(): string {
  return rels([
    { id: 'rId1', type: `${R}/officeDocument`, target: 'ppt/presentation.xml' },
    { id: 'rId2', type: 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties', target: 'docProps/core.xml' },
    { id: 'rId3', type: `${R}/extended-properties`, target: 'docProps/app.xml' },
  ]);
}

export function coreProps(title: string, date: Date): string {
  const iso = date.toISOString().replace(/\.\d+Z$/, 'Z');
  return (
    `${HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
    `<dc:title>${esc(title)}</dc:title><dc:creator>Cartography</dc:creator><cp:lastModifiedBy>Cartography</cp:lastModifiedBy>` +
    `<dcterms:created xsi:type="dcterms:W3CDTF">${iso}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${iso}</dcterms:modified></cp:coreProperties>`
  );
}

export function appProps(slides: number): string {
  return `${HEAD}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Cartography</Application><Slides>${slides}</Slides><Notes>${slides}</Notes><PresentationFormat>On-screen Show</PresentationFormat></Properties>`;
}

export function presentation(slides: number, width: number, height: number): string {
  const ids = Array.from({ length: slides }, (_, i) => `<p:sldId id="${256 + i}" r:id="rId${10 + i}"/>`).join('');
  return (
    `${HEAD}<p:presentation ${PML} saveSubsetFonts="1">` +
    '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>' +
    '<p:notesMasterIdLst><p:notesMasterId r:id="rId2"/></p:notesMasterIdLst>' +
    `<p:sldIdLst>${ids}</p:sldIdLst>` +
    `<p:sldSz cx="${width}" cy="${height}"/><p:notesSz cx="6858000" cy="9144000"/>` +
    '</p:presentation>'
  );
}

export function presentationRels(slides: number): string {
  const list: Rel[] = [
    { id: 'rId1', type: relType.master, target: 'slideMasters/slideMaster1.xml' },
    { id: 'rId2', type: relType.notesMaster, target: 'notesMasters/notesMaster1.xml' },
    { id: 'rId3', type: relType.theme, target: 'theme/theme1.xml' },
    { id: 'rId4', type: relType.presProps, target: 'presProps.xml' },
    { id: 'rId5', type: relType.viewProps, target: 'viewProps.xml' },
    { id: 'rId6', type: relType.tableStyles, target: 'tableStyles.xml' },
  ];
  for (let i = 0; i < slides; i++) list.push({ id: `rId${10 + i}`, type: relType.slide, target: `slides/slide${i + 1}.xml` });
  return rels(list);
}

export const presProps = () => `${HEAD}<p:presentationPr ${PML}/>`;
export const viewProps = () => `${HEAD}<p:viewPr ${PML}><p:normalViewPr><p:restoredLeft sz="15620"/><p:restoredTop sz="94660"/></p:normalViewPr><p:gridSpacing cx="76200" cy="76200"/></p:viewPr>`;
export const tableStyles = () => `${HEAD}<a:tblStyleLst xmlns:a="${NS.a}" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>`;

export interface Palette {
  canvas: string;
  text: string;
  muted: string;
  accent: string[];
  font: string;
}

const hex = (c: string) => c.replace('#', '').toUpperCase();
const clr = (c: string) => `<a:srgbClr val="${hex(c)}"/>`;

export function theme(name: string, p: Palette): string {
  const acc = [...p.accent, ...p.accent].slice(0, 6);
  const font = esc(p.font);
  const solid = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>';
  const line = (w: number) => `<a:ln w="${w}" cap="flat" cmpd="sng" algn="ctr">${solid}<a:prstDash val="solid"/><a:miter lim="800000"/></a:ln>`;
  return (
    `${HEAD}<a:theme xmlns:a="${NS.a}" name="${esc(name)}"><a:themeElements>` +
    `<a:clrScheme name="${esc(name)}"><a:dk1>${clr(p.text)}</a:dk1><a:lt1>${clr(p.canvas)}</a:lt1><a:dk2>${clr(p.muted)}</a:dk2><a:lt2><a:srgbClr val="F1F4F8"/></a:lt2>` +
    acc.map((c, i) => `<a:accent${i + 1}>${clr(c)}</a:accent${i + 1}>`).join('') +
    `<a:hlink>${clr(acc[0]!)}</a:hlink><a:folHlink>${clr(acc[3]!)}</a:folHlink></a:clrScheme>` +
    `<a:fontScheme name="${esc(name)}"><a:majorFont><a:latin typeface="${font}" pitchFamily="34" charset="0"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="${font}" pitchFamily="34" charset="0"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>` +
    `<a:fmtScheme name="${esc(name)}"><a:fillStyleLst>${solid}${solid}${solid}</a:fillStyleLst>` +
    `<a:lnStyleLst>${line(6350)}${line(12700)}${line(19050)}</a:lnStyleLst>` +
    '<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>' +
    `<a:bgFillStyleLst>${solid}${solid}${solid}</a:bgFillStyleLst></a:fmtScheme>` +
    '</a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>'
  );
}

const CLRMAP = 'bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"';
const GRP = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';

function placeholder(id: number, name: string, type: string, x: number, y: number, w: number, h: number, idx?: number, body = '<a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p>') {
  return (
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="${type}"${idx !== undefined ? ` idx="${idx}"` : ''}/></p:nvPr></p:nvSpPr>` +
    `<p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody>${body}</p:txBody></p:sp>`
  );
}

const lvl = (size: number, bold: boolean, color: string) =>
  `<a:lvl1pPr marL="0" indent="0" algn="l"><a:lnSpc><a:spcPct val="100000"/></a:lnSpc><a:spcBef><a:spcPts val="0"/></a:spcBef><a:buNone/><a:defRPr sz="${size}" b="${bold ? 1 : 0}"><a:solidFill>${clr(color)}</a:solidFill><a:latin typeface="+mn-lt"/></a:defRPr></a:lvl1pPr>`;

/** Master: canvas colour as background, a title placeholder at the top, no decoration. */
export function master(w: number, h: number, margin: number, p: Palette): string {
  return (
    `${HEAD}<p:sldMaster ${PML}><p:cSld><p:bg><p:bgPr><a:solidFill>${clr(p.canvas)}</a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree>${GRP}` +
    placeholder(2, 'Title Placeholder 1', 'title', margin, margin, w - 2 * margin, 520000) +
    placeholder(3, 'Text Placeholder 2', 'body', margin, margin + 700000, w - 2 * margin, h - 2 * margin - 700000, 1) +
    `</p:spTree></p:cSld><p:clrMap ${CLRMAP}/>` +
    '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/><p:sldLayoutId id="2147483650" r:id="rId2"/></p:sldLayoutIdLst>' +
    `<p:txStyles><p:titleStyle>${lvl(2400, true, p.text)}</p:titleStyle><p:bodyStyle>${lvl(1600, false, p.text)}</p:bodyStyle><p:otherStyle>${lvl(1200, false, p.text)}</p:otherStyle></p:txStyles></p:sldMaster>`
  );
}

export function masterRels(): string {
  return rels([
    { id: 'rId1', type: relType.layout, target: '../slideLayouts/slideLayout1.xml' },
    { id: 'rId2', type: relType.layout, target: '../slideLayouts/slideLayout2.xml' },
    { id: 'rId3', type: relType.theme, target: '../theme/theme1.xml' },
  ]);
}

/** Layout 1 "Title Only" carries the diagram slides; layout 2 "Title Slide" the optional deck title. */
export function layout(kind: 'titleOnly' | 'title', w: number, h: number, margin: number): string {
  const tree =
    kind === 'titleOnly'
      ? placeholder(2, 'Title 1', 'title', margin, margin, w - 2 * margin, 520000)
      : placeholder(2, 'Title 1', 'ctrTitle', margin, Math.round(h * 0.36), w - 2 * margin, 900000) + placeholder(3, 'Subtitle 2', 'subTitle', margin, Math.round(h * 0.36) + 1000000, w - 2 * margin, 600000, 1);
  const type = kind === 'titleOnly' ? 'titleOnly' : 'title';
  const name = kind === 'titleOnly' ? 'Title Only' : 'Title Slide';
  return `${HEAD}<p:sldLayout ${PML} type="${type}" preserve="1"><p:cSld name="${name}"><p:spTree>${GRP}${tree}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;
}

export const layoutRels = () => rels([{ id: 'rId1', type: relType.master, target: '../slideMasters/slideMaster1.xml' }]);

export function notesMaster(p: Palette): string {
  return (
    `${HEAD}<p:notesMaster ${PML}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>${GRP}` +
    placeholder(2, 'Slide Image Placeholder 1', 'sldImg', 381000, 685800, 6096000, 3429000, undefined, '').replace('<p:txBody></p:txBody>', '') +
    placeholder(3, 'Notes Placeholder 2', 'body', 685800, 4400550, 5486400, 3600450, 1) +
    `</p:spTree></p:cSld><p:clrMap ${CLRMAP}/><p:notesStyle>${lvl(1200, false, p.text)}</p:notesStyle></p:notesMaster>`
  );
}

export const notesMasterRels = () => rels([{ id: 'rId1', type: relType.theme, target: '../theme/theme2.xml' }]);

/** Speaker notes: one paragraph per line. */
export function notesSlide(lines: string[]): string {
  const paras = lines.map((l) => (l ? `<a:p><a:r><a:rPr lang="en-US" dirty="0"/><a:t>${esc(l)}</a:t></a:r></a:p>` : '<a:p><a:endParaRPr lang="en-US"/></a:p>')).join('');
  return (
    `${HEAD}<p:notes ${PML}><p:cSld><p:spTree>${GRP}` +
    '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp>' +
    `<p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>${paras || '<a:p><a:endParaRPr lang="en-US"/></a:p>'}</p:txBody></p:sp>` +
    `</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>`
  );
}

export function notesRels(slide: number): string {
  return rels([
    { id: 'rId1', type: relType.notesMaster, target: '../notesMasters/notesMaster1.xml' },
    { id: 'rId2', type: relType.slide, target: `../slides/slide${slide}.xml` },
  ]);
}

export function slideXml(tree: string): string {
  return `${HEAD}<p:sld ${PML}><p:cSld><p:spTree>${GRP}${tree}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
}
