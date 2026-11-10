// Two made-up PowerPoint templates, written the way PowerPoint writes its own: a corporate .potx
// (16:9, a dark title bar with a logo, footers, a notes master, sample slides in sections) and a
// Dutch 4:3 .pptx whose layouts have only names ("Alleen titel", "Titel en object"), no types.
// Both brands are fictional; a real company's template never goes into the repository.
import { Resvg } from '@resvg/resvg-js';
import { strToU8, zipSync } from 'fflate';

const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n';
const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PML = 'application/vnd.openxmlformats-officedocument.presentationml';
const IN = 914400;

interface Brand {
  name: string;
  width: number;
  height: number;
  colors: Record<string, string>;
  major: string;
  minor: string;
  /** Layout names and types (undefined: a name only). */
  layouts: { name: string; type?: string; xml: (b: Brand) => string; showMasterSp?: boolean; bg?: string; logo?: boolean }[];
  master: (b: Brand) => string;
  masterLogo: boolean;
  logo: string;
  potx: boolean;
  notesMaster: boolean;
  sections: boolean;
  slides: { layout: number; tree: string; picture?: boolean; notes?: string }[];
}

const rels = (list: [string, string, string][]) => `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list.map(([id, type, target]) => `<Relationship Id="${id}" Type="${type.startsWith('http') ? type : `${R}/${type}`}" Target="${target}"/>`).join('')}</Relationships>`;
const xfrm = (x: number, y: number, w: number, h: number) => `<a:xfrm><a:off x="${Math.round(x)}" y="${Math.round(y)}"/><a:ext cx="${Math.round(w)}" cy="${Math.round(h)}"/></a:xfrm>`;
const GRP = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';
const EMPTY = '<a:p><a:endParaRPr lang="nl-NL"/></a:p>';

/** A placeholder; `frame` left out inherits the master's, as PowerPoint writes most layout placeholders. */
function ph(id: number, name: string, type: string | undefined, idx: number | undefined, frame?: [number, number, number, number], body = `<a:bodyPr/><a:lstStyle/>${EMPTY}`, extra = '') {
  const attrs = `${type ? ` type="${type}"` : ''}${idx !== undefined ? ` idx="${idx}"` : ''}${type === 'dt' || type === 'ftr' || type === 'sldNum' ? ' sz="quarter"' : ''}`;
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph${attrs}/></p:nvPr></p:nvSpPr><p:spPr>${frame ? xfrm(...frame) : ''}${extra}</p:spPr><p:txBody>${body}</p:txBody></p:sp>`;
}
const rect = (id: number, name: string, frame: [number, number, number, number], fill: string) =>
  `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr/><p:nvPr userDrawn="1"/></p:nvSpPr><p:spPr>${xfrm(...frame)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill>${fill}</a:solidFill><a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr rtlCol="0" anchor="ctr"/><a:lstStyle/>${EMPTY}</p:txBody></p:sp>`;
const pic = (id: number, name: string, rid: string, frame: [number, number, number, number]) =>
  `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="${name}" descr="Logo"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr userDrawn="1"/></p:nvPicPr><p:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xfrm(...frame)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
const scheme = (v: string) => `<a:schemeClr val="${v}"/>`;
const lvl = (n: number, size: number, color: string, font: string, extra = '') =>
  `<a:lvl${n}pPr marL="${n > 1 ? 228600 * n : 228600}" indent="-228600" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1">${extra}<a:lnSpc><a:spcPct val="90000"/></a:lnSpc><a:spcBef><a:spcPts val="1000"/></a:spcBef><a:buFont typeface="Arial" panose="020B0604020202020204" pitchFamily="34" charset="0"/><a:buChar char="•"/><a:defRPr sz="${size}" kern="1200"><a:solidFill>${color}</a:solidFill><a:latin typeface="${font}"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl${n}pPr>`;
const sldNumBody = (align: string, size: number, color: string) => `<a:bodyPr vert="horz" lIns="91440" tIns="45720" rIns="91440" bIns="45720" rtlCol="0" anchor="ctr"/><a:lstStyle><a:lvl1pPr algn="${align}"><a:defRPr sz="${size}"><a:solidFill>${color}</a:solidFill></a:defRPr></a:lvl1pPr></a:lstStyle><a:p><a:fld id="{B6F15528-21DE-4FAA-801E-634DDDAF4B2B}" type="slidenum"><a:rPr lang="nl-NL"/><a:t>‹#›</a:t></a:fld><a:endParaRPr lang="nl-NL"/></a:p>`;
const footBody = (align: string, size: number, color: string, words: string) => `<a:bodyPr vert="horz" lIns="91440" tIns="45720" rIns="91440" bIns="45720" rtlCol="0" anchor="ctr"/><a:lstStyle><a:lvl1pPr algn="${align}"><a:defRPr sz="${size}"><a:solidFill>${color}</a:solidFill></a:defRPr></a:lvl1pPr></a:lstStyle><a:p><a:r><a:rPr lang="nl-NL"/><a:t>${words}</a:t></a:r></a:p>`;
const dateBody = `<a:bodyPr/><a:lstStyle/><a:p><a:fld id="{A1B2C3D4-0000-4000-8000-000000000001}" type="datetimeFigureOut"><a:rPr lang="nl-NL"/><a:t>10-11-2026</a:t></a:fld><a:endParaRPr lang="nl-NL"/></a:p>`;

function theme(b: Brand): string {
  const c = (k: string) => (k === 'dk1' || k === 'lt1' ? `<a:sysClr val="${k === 'dk1' ? 'windowText' : 'window'}" lastClr="${b.colors[k]}"/>` : `<a:srgbClr val="${b.colors[k]}"/>`);
  const keys = ['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'];
  const solid = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>';
  return (
    `${HEAD}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="${b.name}"><a:themeElements><a:clrScheme name="${b.name}">${keys.map((k) => `<a:${k}>${c(k)}</a:${k}>`).join('')}</a:clrScheme>` +
    `<a:fontScheme name="${b.name}"><a:majorFont><a:latin typeface="${b.major}" panose="020F0302020204030204"/><a:ea typeface=""/><a:cs typeface=""/><a:font script="Jpan" typeface="游ゴシック Light"/></a:majorFont><a:minorFont><a:latin typeface="${b.minor}" panose="020F0502020204030204"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>` +
    `<a:fmtScheme name="Office"><a:fillStyleLst>${solid}<a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"><a:lumMod val="110000"/><a:satMod val="105000"/><a:tint val="67000"/></a:schemeClr></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"><a:lumMod val="105000"/><a:satMod val="109000"/><a:tint val="81000"/></a:schemeClr></a:gs></a:gsLst><a:lin ang="5400000" scaled="0"/></a:gradFill>${solid}</a:fillStyleLst>` +
    '<a:lnStyleLst><a:ln w="6350" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/><a:miter lim="800000"/></a:ln><a:ln w="12700" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/><a:miter lim="800000"/></a:ln><a:ln w="19050" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/><a:miter lim="800000"/></a:ln></a:lnStyleLst>' +
    `<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst><a:outerShdw blurRad="57150" dist="19050" dir="5400000" algn="ctr" rotWithShape="0"><a:srgbClr val="000000"><a:alpha val="63000"/></a:srgbClr></a:outerShdw></a:effectLst></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst>${solid}${solid}${solid}</a:bgFillStyleLst></a:fmtScheme>` +
    '</a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>'
  );
}

function logoPng(svg: string): Uint8Array {
  return new Resvg(svg, { fitTo: { mode: 'width', value: 360 } }).render().asPng();
}

function build(b: Brand): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  const put = (p: string, s: string) => (files[p] = strToU8(s));
  const n = b.layouts.length;
  const overrides: string[] = [];
  const over = (part: string, type: string) => overrides.push(`<Override PartName="/${part}" ContentType="${type}"/>`);

  // Master, its layouts and theme.
  put('ppt/theme/theme1.xml', theme(b));
  over('ppt/theme/theme1.xml', 'application/vnd.openxmlformats-officedocument.theme+xml');
  files['ppt/media/image1.png'] = logoPng(b.logo);
  const layoutIds = b.layouts.map((_, i) => `<p:sldLayoutId id="${2147483649 + i}" r:id="rId${i + 1}"/>`).join('');
  put('ppt/slideMasters/slideMaster1.xml', b.master(b).replace('<!--LAYOUTS-->', `<p:sldLayoutIdLst>${layoutIds}</p:sldLayoutIdLst>`));
  put('ppt/slideMasters/_rels/slideMaster1.xml.rels', rels([...b.layouts.map((_, i) => [`rId${i + 1}`, 'slideLayout', `../slideLayouts/slideLayout${i + 1}.xml`] as [string, string, string]), [`rId${n + 1}`, 'theme', '../theme/theme1.xml'], [`rId${n + 2}`, 'image', '../media/image1.png']]));
  over('ppt/slideMasters/slideMaster1.xml', `${PML}.slideMaster+xml`);
  for (const [i, l] of b.layouts.entries()) {
    const bg = l.bg ? `<p:bg><p:bgPr><a:solidFill>${l.bg}</a:solidFill><a:effectLst/></p:bgPr></p:bg>` : '';
    put(`ppt/slideLayouts/slideLayout${i + 1}.xml`, `${HEAD}<p:sldLayout ${NS}${l.type ? ` type="${l.type}"` : ''}${l.showMasterSp === false ? ' showMasterSp="0"' : ''} preserve="1"><p:cSld name="${l.name}">${bg}<p:spTree>${GRP}${l.xml(b)}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`);
    put(`ppt/slideLayouts/_rels/slideLayout${i + 1}.xml.rels`, rels([['rId1', 'slideMaster', '../slideMasters/slideMaster1.xml'], ...(l.logo ? [['rId2', 'image', '../media/image1.png'] as [string, string, string]] : [])]));
    over(`ppt/slideLayouts/slideLayout${i + 1}.xml`, `${PML}.slideLayout+xml`);
  }

  // Sample slides; one has a picture only it uses, one has speaker notes.
  const presRels: [string, string, string][] = [['rId1', 'slideMaster', 'slideMasters/slideMaster1.xml']];
  if (b.notesMaster) {
    presRels.push(['rId2', 'notesMaster', 'notesMasters/notesMaster1.xml']);
    put('ppt/theme/theme2.xml', theme({ ...b, name: 'Office Theme' }));
    over('ppt/theme/theme2.xml', 'application/vnd.openxmlformats-officedocument.theme+xml');
    put(
      'ppt/notesMasters/notesMaster1.xml',
      `${HEAD}<p:notesMaster ${NS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>${GRP}` +
        ph(2, 'Header Placeholder 1', 'hdr', undefined, [0, 0, 2971800, 458788]) +
        `<p:sp><p:nvSpPr><p:cNvPr id="3" name="Slide Image Placeholder 2"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg" idx="2"/></p:nvPr></p:nvSpPr><p:spPr>${xfrm(685800, 1143000, 5486400, 3086100)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln w="12700"><a:solidFill><a:prstClr val="black"/></a:solidFill></a:ln></p:spPr></p:sp>` +
        ph(4, 'Notes Placeholder 3', 'body', 3, [685800, 4400550, 5486400, 3600450]) +
        `</p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:notesStyle>${lvl(1, 1200, scheme('tx1'), '+mn-lt')}</p:notesStyle></p:notesMaster>`,
    );
    put('ppt/notesMasters/_rels/notesMaster1.xml.rels', rels([['rId1', 'theme', '../theme/theme2.xml']]));
    over('ppt/notesMasters/notesMaster1.xml', `${PML}.notesMaster+xml`);
  }
  const ids: string[] = [];
  for (const [i, s] of b.slides.entries()) {
    const k = i + 1;
    const rid = `rId${10 + i}`;
    presRels.push([rid, 'slide', `slides/slide${k}.xml`]);
    ids.push(`<p:sldId id="${256 + i}" r:id="${rid}"/>`);
    put(`ppt/slides/slide${k}.xml`, `${HEAD}<p:sld ${NS}><p:cSld><p:spTree>${GRP}${s.tree}${s.picture ? pic(9, 'Picture 8', 'rId2', [IN, 2 * IN, 3 * IN, 2 * IN]) : ''}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`);
    const sr: [string, string, string][] = [['rId1', 'slideLayout', `../slideLayouts/slideLayout${s.layout}.xml`]];
    if (s.picture) {
      sr.push(['rId2', 'image', '../media/image2.png']);
      files['ppt/media/image2.png'] = logoPng('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><rect width="300" height="200" fill="#c33"/></svg>');
    }
    if (s.notes && b.notesMaster) {
      sr.push(['rId3', 'notesSlide', `../notesSlides/notesSlide${k}.xml`]);
      put(`ppt/notesSlides/notesSlide${k}.xml`, `${HEAD}<p:notes ${NS}><p:cSld><p:spTree>${GRP}${ph(2, 'Notes Placeholder 1', 'body', 3, undefined, `<a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"/><a:t>${s.notes}</a:t></a:r></a:p>`)}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>`);
      put(`ppt/notesSlides/_rels/notesSlide${k}.xml.rels`, rels([['rId1', 'notesMaster', '../notesMasters/notesMaster1.xml'], ['rId2', 'slide', `../slides/slide${k}.xml`]]));
      over(`ppt/notesSlides/notesSlide${k}.xml`, `${PML}.notesSlide+xml`);
    }
    put(`ppt/slides/_rels/slide${k}.xml.rels`, rels(sr));
    over(`ppt/slides/slide${k}.xml`, `${PML}.slide+xml`);
  }
  presRels.push(['rId3', 'presProps', 'presProps.xml'], ['rId4', 'viewProps', 'viewProps.xml'], ['rId5', 'theme', 'theme/theme1.xml'], ['rId6', 'tableStyles', 'tableStyles.xml']);
  const sections = b.sections
    ? `<p:extLst><p:ext uri="{521415D9-36F7-43E2-AB2F-B90AF26B5E84}"><p14:sectionLst xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main"><p14:section name="Introduction" id="{1E1C0C5B-7A5C-4C4B-9F44-5C3A3C7E9A01}"><p14:sldIdLst><p14:sldId id="256"/></p14:sldIdLst></p14:section><p14:section name="Examples" id="{1E1C0C5B-7A5C-4C4B-9F44-5C3A3C7E9A02}"><p14:sldIdLst>${b.slides.slice(1).map((_, i) => `<p14:sldId id="${257 + i}"/>`).join('')}</p14:sldIdLst></p14:section></p14:sectionLst></p:ext></p:extLst>`
    : '';
  put(
    'ppt/presentation.xml',
    `${HEAD}<p:presentation ${NS} saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>${b.notesMaster ? '<p:notesMasterIdLst><p:notesMasterId r:id="rId2"/></p:notesMasterIdLst>' : ''}<p:sldIdLst>${ids.join('')}</p:sldIdLst><p:sldSz cx="${b.width}" cy="${b.height}"${b.height / b.width > 0.7 ? ' type="screen4x3"' : ''}/><p:notesSz cx="6858000" cy="9144000"/>` +
      `<p:defaultTextStyle><a:defPPr><a:defRPr lang="nl-NL"/></a:defPPr>${lvl(1, 1800, scheme('tx1'), '+mn-lt').replace(/<a:buFont[^>]*\/><a:buChar[^>]*\/>/, '')}</p:defaultTextStyle>${sections}</p:presentation>`,
  );
  over('ppt/presentation.xml', `${PML}.${b.potx ? 'template.main' : 'presentation.main'}+xml`);
  put('ppt/_rels/presentation.xml.rels', rels(presRels));
  put('ppt/presProps.xml', `${HEAD}<p:presentationPr ${NS}/>`);
  put('ppt/viewProps.xml', `${HEAD}<p:viewPr ${NS}><p:normalViewPr><p:restoredLeft sz="15620"/><p:restoredTop sz="94660"/></p:normalViewPr><p:gridSpacing cx="72008" cy="72008"/></p:viewPr>`);
  put('ppt/tableStyles.xml', `${HEAD}<a:tblStyleLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>`);
  over('ppt/presProps.xml', `${PML}.presProps+xml`);
  over('ppt/viewProps.xml', `${PML}.viewProps+xml`);
  over('ppt/tableStyles.xml', `${PML}.tableStyles+xml`);
  put('docProps/core.xml', `${HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${b.name} template</dc:title><dc:creator>Brand team</dc:creator></cp:coreProperties>`);
  put('docProps/app.xml', `${HEAD}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Microsoft Office PowerPoint</Application><Slides>${b.slides.length}</Slides><Company>${b.name}</Company></Properties>`);
  put('docProps/thumbnail.jpeg', 'not really a jpeg');
  over('docProps/core.xml', 'application/vnd.openxmlformats-package.core-properties+xml');
  over('docProps/app.xml', 'application/vnd.openxmlformats-officedocument.extended-properties+xml');
  put('_rels/.rels', rels([['rId1', 'officeDocument', 'ppt/presentation.xml'], ['rId2', 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties', 'docProps/core.xml'], ['rId3', 'extended-properties', 'docProps/app.xml'], ['rId4', 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/thumbnail', 'docProps/thumbnail.jpeg']]));
  put(
    '[Content_Types].xml',
    `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${overrides.join('')}</Types>`,
  );
  const ordered = Object.fromEntries(Object.entries(files).sort(([a], [b]) => (a === '[Content_Types].xml' ? -1 : b === '[Content_Types].xml' ? 1 : 0)));
  return zipSync(ordered);
}

const CLRMAP = '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>';

/** "Exemplar Group": 16:9, a navy title bar with the logo in it, an orange rule over the footer. */
export function corporateTemplate(): Uint8Array {
  const W = 12192000;
  const H = 6858000;
  const bar = 1.05 * IN;
  const footY = H - 0.5 * IN;
  const titleBody = '<a:bodyPr vert="horz" lIns="91440" tIns="45720" rIns="91440" bIns="45720" rtlCol="0" anchor="ctr"><a:normAutofit/></a:bodyPr><a:lstStyle/><a:p><a:r><a:rPr lang="en-GB"/><a:t>Click to edit Master title style</a:t></a:r></a:p>';
  const footers = (id: number) =>
    ph(id, 'Date Placeholder 3', 'dt', 10, undefined, dateBody) + ph(id + 1, 'Footer Placeholder 4', 'ftr', 11, undefined, footBody('l', 1000, scheme('tx2'), 'Exemplar Group · Internal')) + ph(id + 2, 'Slide Number Placeholder 5', 'sldNum', 12, undefined, sldNumBody('r', 1000, scheme('tx2')));
  const master = (b: Brand) =>
    `${HEAD}<p:sldMaster ${NS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>${GRP}` +
    rect(7, 'Title bar', [0, 0, W, bar], scheme('tx2')) +
    rect(8, 'Footer rule', [0.5 * IN, footY - 0.06 * IN, W - IN, 0.035 * IN], scheme('accent2')) +
    pic(9, 'Logo', 'rId7', [W - 2.05 * IN, 0.27 * IN, 1.55 * IN, 0.52 * IN]).replace('rId7', `rId${b.layouts.length + 2}`) +
    ph(2, 'Title Placeholder 1', 'title', undefined, [0.5 * IN, 0.12 * IN, W - 3 * IN, bar - 0.24 * IN], titleBody) +
    ph(3, 'Text Placeholder 2', 'body', 1, [0.5 * IN, 1.4 * IN, W - IN, H - 2.15 * IN], `<a:bodyPr vert="horz" lIns="91440" tIns="45720" rIns="91440" bIns="45720" rtlCol="0"><a:normAutofit/></a:bodyPr><a:lstStyle/><a:p><a:pPr lvl="0"/><a:r><a:rPr lang="en-GB"/><a:t>Click to edit Master text styles</a:t></a:r></a:p>`) +
    ph(4, 'Date Placeholder 3', 'dt', 2, [0.5 * IN, footY, 2.5 * IN, 0.4 * IN], dateBody) +
    ph(5, 'Footer Placeholder 4', 'ftr', 3, [3.2 * IN, footY, W - 6.4 * IN, 0.4 * IN], footBody('ctr', 1000, scheme('tx2'), '')) +
    ph(6, 'Slide Number Placeholder 5', 'sldNum', 4, [W - 3 * IN, footY, 2.5 * IN, 0.4 * IN], sldNumBody('r', 1000, scheme('tx2'))) +
    `</p:spTree></p:cSld>${CLRMAP}<!--LAYOUTS--><p:hf hdr="0" dt="0"/>` +
    `<p:txStyles><p:titleStyle><a:lvl1pPr algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:lnSpc><a:spcPct val="90000"/></a:lnSpc><a:spcBef><a:spcPct val="0"/></a:spcBef><a:buNone/><a:defRPr sz="2800" b="0" kern="1200"><a:solidFill><a:schemeClr val="bg1"/></a:solidFill><a:latin typeface="+mj-lt"/><a:ea typeface="+mj-ea"/><a:cs typeface="+mj-cs"/></a:defRPr></a:lvl1pPr></p:titleStyle>` +
    `<p:bodyStyle>${lvl(1, 2000, scheme('tx1'), '+mn-lt')}${lvl(2, 1800, scheme('tx1'), '+mn-lt')}</p:bodyStyle><p:otherStyle><a:defPPr><a:defRPr lang="en-GB"/></a:defPPr>${lvl(1, 1800, scheme('tx1'), '+mn-lt').replace(/<a:buFont[^>]*\/><a:buChar[^>]*\/>/, '')}</p:otherStyle></p:txStyles></p:sldMaster>`;
  const title = (id: number) => ph(id, 'Title 1', 'title', undefined, undefined, '<a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-GB"/><a:t>Click to edit Master title style</a:t></a:r></a:p>');
  const body = (id: number, idx: number, frame?: [number, number, number, number]) => ph(id, `Content Placeholder ${id}`, undefined, idx, frame, '<a:bodyPr/><a:lstStyle/><a:p><a:pPr lvl="0"/><a:r><a:rPr lang="en-GB"/><a:t>Click to edit Master text styles</a:t></a:r></a:p>');
  return build({
    name: 'Exemplar Group',
    width: W,
    height: H,
    colors: { dk1: '1B1B1F', lt1: 'FFFFFF', dk2: '0B2545', lt2: 'EEF1F5', accent1: '1F5FAD', accent2: 'F28C28', accent3: '13A89E', accent4: '7B4FA0', accent5: 'D7263D', accent6: 'E7E9EE', hlink: '1F5FAD', folHlink: '7B4FA0' },
    major: 'Georgia',
    minor: 'Arial',
    logo: '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="100" viewBox="0 0 300 100"><rect x="4" y="14" width="72" height="72" rx="10" fill="#F28C28"/><path d="M24 34h32M24 50h24M24 66h32" stroke="#0B2545" stroke-width="9" stroke-linecap="round"/><text x="92" y="62" font-family="Arial" font-weight="bold" font-size="40" fill="#FFFFFF">EXEMPLAR</text></svg>',
    masterLogo: true,
    potx: true,
    notesMaster: true,
    sections: true,
    master,
    layouts: [
      { name: 'Title Slide', type: 'title', showMasterSp: false, bg: scheme('tx2'), logo: true, xml: () => ph(2, 'Title 1', 'ctrTitle', undefined, [IN, 2.3 * IN, W - 2 * IN, 1.4 * IN], '<a:bodyPr anchor="b"/><a:lstStyle><a:lvl1pPr><a:defRPr sz="4400"/></a:lvl1pPr></a:lstStyle><a:p><a:r><a:rPr lang="en-GB"/><a:t>Click to edit Master title style</a:t></a:r></a:p>') + ph(3, 'Subtitle 2', 'subTitle', 1, [IN, 3.85 * IN, W - 2 * IN, 0.9 * IN], `<a:bodyPr/><a:lstStyle><a:lvl1pPr marL="0" indent="0"><a:buNone/><a:defRPr sz="2000"><a:solidFill>${scheme('accent2')}</a:solidFill></a:defRPr></a:lvl1pPr></a:lstStyle><a:p><a:r><a:rPr lang="en-GB"/><a:t>Click to edit Master subtitle style</a:t></a:r></a:p>`) + pic(4, 'Logo', 'rId2', [IN, 0.9 * IN, 2.4 * IN, 0.8 * IN]) },
      { name: 'Title and Content', type: 'obj', xml: () => title(2) + body(3, 1) + footers(4) },
      { name: 'Section Header', type: 'secHead', xml: () => ph(2, 'Title 1', 'title', undefined, [IN, 2.5 * IN, W - 2 * IN, 1.2 * IN]) + footers(3) },
      { name: 'Two Content', type: 'twoObj', xml: () => title(2) + body(3, 1, [0.5 * IN, 1.4 * IN, W / 2 - 0.6 * IN, H - 2.15 * IN]) + body(4, 2, [W / 2 + 0.1 * IN, 1.4 * IN, W / 2 - 0.6 * IN, H - 2.15 * IN]) + footers(5) },
      { name: 'Title Only', type: 'titleOnly', xml: () => title(2) + footers(3) },
      { name: 'Blank', type: 'blank', xml: () => footers(2) },
    ],
    slides: [
      { layout: 1, tree: ph(2, 'Title 1', 'ctrTitle', undefined, undefined, '<a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-GB"/><a:t>Quarterly review</a:t></a:r></a:p>') },
      { layout: 2, tree: ph(2, 'Title 1', 'title', undefined, undefined, '<a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-GB"/><a:t>Delete this sample slide</a:t></a:r></a:p>'), picture: true, notes: 'A sample note' },
    ],
  });
}

/** "Polder Advies": 4:3, a green stripe down the left, the logo bottom right, Dutch layout names and no layout types. */
export function dutchTemplate(): Uint8Array {
  const W = 9144000;
  const H = 6858000;
  const footY = H - 0.55 * IN;
  const master = (b: Brand) =>
    `${HEAD}<p:sldMaster ${NS}><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FBF8F2"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree>${GRP}` +
    rect(7, 'Streep', [0, 0, 0.28 * IN, H], scheme('accent2')) +
    pic(8, 'Logo', 'rIdX', [W - 1.75 * IN, footY + 0.02 * IN, 1.35 * IN, 0.45 * IN]).replace('rIdX', `rId${b.layouts.length + 2}`) +
    ph(2, 'Tijdelijke aanduiding voor titel 1', 'title', undefined, [0.7 * IN, 0.4 * IN, W - 1.2 * IN, 0.95 * IN], `<a:bodyPr vert="horz" lIns="91440" tIns="45720" rIns="91440" bIns="45720" rtlCol="0" anchor="b"><a:normAutofit/></a:bodyPr><a:lstStyle/><a:p><a:r><a:rPr lang="nl-NL"/><a:t>Klik om de stijl te bewerken</a:t></a:r></a:p>`) +
    ph(3, 'Tijdelijke aanduiding voor tekst 2', 'body', 1, [0.7 * IN, 1.6 * IN, W - 1.2 * IN, H - 2.4 * IN], `<a:bodyPr vert="horz" lIns="91440" tIns="45720" rIns="91440" bIns="45720" rtlCol="0"><a:normAutofit/></a:bodyPr><a:lstStyle/><a:p><a:pPr lvl="0"/><a:r><a:rPr lang="nl-NL"/><a:t>Klik om de modelstijlen te bewerken</a:t></a:r></a:p>`) +
    ph(4, 'Tijdelijke aanduiding voor voettekst 3', 'ftr', 3, [0.7 * IN, footY, 4.2 * IN, 0.45 * IN], footBody('l', 900, scheme('tx2'), '')) +
    ph(5, 'Tijdelijke aanduiding voor dianummer 4', 'sldNum', 4, [W - 2.9 * IN, footY, 1 * IN, 0.45 * IN], sldNumBody('r', 900, scheme('tx2'))) +
    `</p:spTree></p:cSld>${CLRMAP}<!--LAYOUTS-->` +
    `<p:txStyles><p:titleStyle><a:lvl1pPr algn="l" rtl="0"><a:lnSpc><a:spcPct val="90000"/></a:lnSpc><a:spcBef><a:spcPct val="0"/></a:spcBef><a:buNone/><a:defRPr sz="3200" b="1" kern="1200"><a:solidFill><a:schemeClr val="accent2"/></a:solidFill><a:latin typeface="+mj-lt"/><a:ea typeface="+mj-ea"/><a:cs typeface="+mj-cs"/></a:defRPr></a:lvl1pPr></p:titleStyle>` +
    `<p:bodyStyle>${lvl(1, 2000, scheme('tx1'), '+mn-lt')}</p:bodyStyle><p:otherStyle><a:defPPr><a:defRPr lang="nl-NL"/></a:defPPr></p:otherStyle></p:txStyles></p:sldMaster>`;
  const footers = (id: number) => ph(id, 'Tijdelijke aanduiding voor voettekst 3', 'ftr', 11, undefined, footBody('l', 900, scheme('tx2'), 'Polder Advies — vertrouwelijk')) + ph(id + 1, 'Tijdelijke aanduiding voor dianummer 4', 'sldNum', 12, undefined, sldNumBody('r', 900, scheme('tx2')));
  const title = (id: number) => ph(id, 'Titel 1', 'title', undefined);
  return build({
    name: 'Polder Advies',
    width: W,
    height: H,
    colors: { dk1: '222222', lt1: 'FFFFFF', dk2: '3A4A3F', lt2: 'EDE8DD', accent1: 'E06C00', accent2: '2F6B3C', accent3: 'FFD100', accent4: '8C8C8C', accent5: 'A3C9E2', accent6: '7A1F5C', hlink: '2F6B3C', folHlink: '7A1F5C' },
    major: 'Trebuchet MS',
    minor: 'Verdana',
    logo: '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="100" viewBox="0 0 300 100"><path d="M8 78 L40 22 L72 78 Z" fill="#2F6B3C"/><path d="M34 78 L58 40 L82 78 Z" fill="#E06C00"/><text x="96" y="64" font-family="Verdana" font-size="34" fill="#2F6B3C">polder</text></svg>',
    masterLogo: true,
    potx: false,
    notesMaster: false,
    sections: false,
    master,
    layouts: [
      { name: 'Titeldia', xml: () => ph(2, 'Titel 1', 'ctrTitle', undefined, [0.9 * IN, 2.2 * IN, W - 1.8 * IN, 1.5 * IN]) + ph(3, 'Ondertitel 2', 'subTitle', 1, [0.9 * IN, 3.8 * IN, W - 1.8 * IN, 1 * IN], '<a:bodyPr/><a:lstStyle><a:lvl1pPr marL="0" indent="0"><a:buNone/><a:defRPr sz="2000"/></a:lvl1pPr></a:lstStyle>' + EMPTY) },
      { name: 'Titel en object', xml: () => title(2) + ph(3, 'Tijdelijke aanduiding voor inhoud 2', undefined, 1) + footers(4) },
      { name: 'Sectiekop', xml: () => ph(2, 'Titel 1', 'title', undefined, [0.9 * IN, 2.6 * IN, W - 1.8 * IN, 1.4 * IN]) + footers(3) },
      { name: 'Twee objecten', xml: () => title(2) + ph(3, 'Inhoud 2', undefined, 1, [0.7 * IN, 1.6 * IN, W / 2 - 0.8 * IN, H - 2.4 * IN]) + ph(4, 'Inhoud 3', undefined, 2, [W / 2 + 0.1 * IN, 1.6 * IN, W / 2 - 0.8 * IN, H - 2.4 * IN]) + footers(5) },
      { name: 'Alleen titel', xml: () => title(2) + footers(3) },
      { name: 'Leeg', xml: () => footers(2) },
      { name: 'Afbeelding met bijschrift', xml: () => ph(2, 'Titel 1', 'title', undefined, [0.7 * IN, 0.4 * IN, W - 1.2 * IN, 0.95 * IN]) + ph(3, 'Afbeelding 2', 'pic', 1, [0.7 * IN, 1.5 * IN, W - 1.2 * IN, H - 3.1 * IN]) + ph(4, 'Bijschrift 3', 'body', 2, [0.7 * IN, H - 1.5 * IN, W - 1.2 * IN, 0.8 * IN], '<a:bodyPr/><a:lstStyle><a:lvl1pPr marL="0" indent="0"><a:buNone/><a:defRPr sz="1400"/></a:lvl1pPr></a:lstStyle>' + EMPTY) + footers(5) },
    ],
    slides: [{ layout: 2, tree: ph(2, 'Titel 1', 'title', undefined, undefined, '<a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="nl-NL"/><a:t>Voorbeelddia</a:t></a:r></a:p>') }],
  });
}
