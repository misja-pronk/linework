// Everything the command palette (⌘K) offers, built from what is open and selected now.
import type { LayoutSidecar } from '@linework/core';
import { t, say } from '../i18n/index.ts';
import type { Command } from '../palette.tsx';
import { keyHint } from '../keys.ts';
import { arrangeCommands, type useCraftPrefs } from '../craft-actions.tsx';
import { starters, typeName } from '../library.ts';
import { canUseFolders, diagrams, type Workspace } from '../files.ts';
import type { PreviewControl, Selection } from '../preview.tsx';
import type { View } from '../start.tsx';
import type { Doc } from './document.ts';
import type { Drawing } from './drawing.ts';
import type { Edits } from './edits.ts';
import type { Exports } from './exports.ts';
import type { FileIO } from './file-io.ts';
import type { Modals } from './modals.ts';
import type { Navigation } from './navigation.ts';
import type { Pins } from './pins.ts';
import type { ThemePref } from './prefs.ts';
import { count, iconOf, label } from './names.ts';

export interface CommandsContext {
  drawing: Drawing;
  selection: Selection[];
  selected: Selection | undefined;
  select(s: Selection): void;
  ws: Workspace | undefined;
  doc: Doc;
  pins: LayoutSidecar | undefined;
  view: View;
  setView(v: View): void;
  setPref(p: ThemePref): void;
  safeSvg: boolean;
  toggleSafeSvg(): void;
  asking: boolean;
  toggleAsk(): void;
  copyForAi(): Promise<void>;
  viewName: string | undefined;
  files: FileIO;
  exports: Exports;
  edits: Edits;
  pinning: Pins;
  nav: Navigation;
  modals: Modals;
  craft: ReturnType<typeof useCraftPrefs>;
  previewControl: React.RefObject<PreviewControl | null>;
  undo(): void;
  redo(): void;
  /** What compare and layers add. */
  more: { compare: Command[]; layers: Command[] };
}

export function buildCommands(c: CommandsContext): Command[] {
  const { drawing, selection, selected, ws, doc, files, exports: x, edits, pinning, nav, modals, craft } = c;
  const { type, drawn, result, vpins, drawnLayout, locked, bent } = drawing;
  const { stepList, written, viewList, viewTitle } = nav;
  /** An element picked: selected, and the keyboard on the drawing with it (not back on the button that opened ⌘K). */
  const goTo = (s: Selection) => {
    c.select(s);
    (document.querySelector('.preview') as HTMLElement | null)?.focus({ preventScroll: true });
  };
  return [
    { id: 'ask', group: t('Your AI'), label: c.asking ? t('Close Your AI') : t('Your AI…'), hint: t('proposals from your own AI agent, through the MCP server'), icon: 'sparkles', shortcut: keyHint('ask'), run: c.toggleAsk },
    ...(type ? [{ id: 'copy-for-ai', group: t('Your AI'), label: t('Copy for your AI'), hint: t('the YAML, its schema and instructions, to paste into any chat'), icon: 'copy', run: () => void c.copyForAi() }] : []),
    { id: 'new', group: t('File'), label: t('New diagram…'), hint: t('a ready drawing or a blank sheet'), icon: 'file-plus', run: () => modals.setModal('templates') },
    c.view === 'visual'
      ? { id: 'view-code', group: t('View'), label: t('Show the YAML'), icon: 'code', shortcut: keyHint('switch-view'), run: () => c.setView('code') }
      : { id: 'view-visual', group: t('View'), label: t('Drawing (hide the YAML)'), icon: 'mouse-pointer-2', shortcut: keyHint('switch-view'), run: () => c.setView('visual') },
    { id: 'open', group: t('File'), label: t('Open file…'), icon: 'folder-open', shortcut: keyHint('open'), run: files.openFile },
    { id: 'save', group: t('File'), label: ws && doc.path ? t('Save {path}', { path: doc.path }) : t('Save'), icon: 'save', shortcut: keyHint('save'), run: files.saveYaml },
    { id: 'download', group: t('File'), label: t('Download YAML'), icon: 'download', run: files.downloadYaml },
    ...(canUseFolders ? [{ id: 'folder', group: t('File'), label: t('Open folder…'), icon: 'folder-open', run: () => void files.openFolder() }] : []),
    ...(ws ? diagrams(ws).map((p) => ({ id: `file:${p}`, group: t('Files in {folder}', { folder: ws.name }), label: p, icon: 'file-code', run: () => void files.openInFolder(ws, p) })) : []),
    ...(c.pins ? [{ id: 'save-layout', group: t('File'), label: t('Save layout (.layout.json)'), icon: 'save', run: x.saveLayout }] : []),
    { id: 'svg', group: t('Export'), label: t('Export SVG'), icon: 'download', shortcut: keyHint('export-svg'), run: x.saveSvg },
    { id: 'png', group: t('Export'), label: t('Export PNG (2×)'), icon: 'image', shortcut: keyHint('export-png'), run: x.savePng },
    { id: 'slide', group: t('Export'), label: t('PNG on the page ({page})', { page: x.pageName }), icon: 'monitor', run: x.saveSlide },
    { id: 'page-svg', group: t('Export'), label: t('SVG on the page ({page})', { page: x.pageName }), icon: 'monitor', run: x.savePageSvg },
    { id: 'pptx', group: t('Export'), label: written ? t('PowerPoint slides, one per step (.pptx)') : t('PowerPoint slide (.pptx)'), icon: 'layout-template', run: x.savePptx },
    { id: 'pdf', group: t('Export'), label: written ? t('Export PDF, a page per step') : t('Export PDF'), icon: 'file-text', run: x.savePdf },
    { id: 'html', group: t('Export'), label: t('Interactive HTML (.html)'), hint: t('one file to send: every view and step, zoom, search, drill-down'), icon: 'globe', run: () => x.saveHtml() },
    ...(ws ? [{ id: 'html-folder', group: t('Export'), label: t('Interactive HTML of {folder}', { folder: ws.name }), hint: t('every diagram in the folder, with a contents page'), icon: 'globe', run: () => x.saveHtml(true) }] : []),
    { id: 'copy-png', group: t('Export'), label: t('Copy as PNG'), icon: 'copy', run: x.copyPng },
    { id: 'describe', group: t('Export'), label: t('Describe in words…'), hint: t('what the diagram shows, for a screen reader or a handout; copy as text or Markdown'), icon: 'scroll-text', run: () => setTimeout(() => modals.setDescribing(true)) },
    { id: 'copy-wiki', group: t('Export'), label: t('Copy for Confluence / Notion'), hint: t('the picture and the description in one paste'), icon: 'book-open', run: x.copyForWiki },
    { id: 'copy-svg', group: t('Export'), label: t('Copy as SVG'), icon: 'copy', run: x.copySvg },
    { id: 'svg-safe', group: t('Export'), label: c.safeSvg ? t('SVG as drawn (SVG for PowerPoint / Word off)') : t('SVG for PowerPoint / Word on'), hint: t('an SVG that PowerPoint, Word and Keynote take whole'), icon: 'monitor', run: c.toggleSafeSvg },
    { id: 'share', group: t('Export'), label: t('Copy share link'), hint: t('read-only, the diagram travels in the link'), icon: 'link', run: x.copyShare },
    { id: 'present', group: t('Present'), label: t('Present full screen'), hint: stepList.length ? count(stepList.length, '{count} step|{count} steps') : drawn?.views?.length ? t('its views in order') : t('step by step'), icon: 'play', shortcut: keyHint('present'), run: nav.present },
    ...(type && !drawn?.stepsImplied
      ? [{ id: 'step-add', group: t('Present'), label: selection.length ? t('Add a step from the selection') : t('Add a step'), hint: t('what is selected stands out in it'), icon: 'plus', shortcut: keyHint('step'), run: nav.addStepFromSelection }]
      : []),
    ...(stepList.length
      ? [
          { id: 'step-next', group: t('Present'), label: t('Next step'), icon: 'layers', shortcut: ']', run: () => nav.stepBy(1) },
          { id: 'step-previous', group: t('Present'), label: t('Previous step'), icon: 'layers', shortcut: '[', run: () => nav.stepBy(-1) },
          ...(drawn?.step ? [{ id: 'step-none', group: t('Present'), label: t('Show the whole drawing'), hint: t('no step'), icon: 'layers', run: () => nav.pickStep(undefined) }] : []),
          ...stepList.map((s, i) => ({ id: `step:${i + 1}`, group: t('Steps'), label: `${i + 1}. ${s.title ?? s.caption ?? t('Step')}`, hint: s.title ? s.caption : undefined, icon: 'layers', run: () => nav.pickStep(i + 1) })),
        ]
      : []),
    ...c.more.compare,
    ...c.more.layers,
    { id: 'undo', group: t('Edit'), label: t('Undo'), icon: 'undo-2', shortcut: keyHint('undo'), run: c.undo },
    { id: 'redo', group: t('Edit'), label: t('Redo'), icon: 'redo-2', shortcut: keyHint('redo'), run: c.redo },
    { id: 'tidy', group: t('Arrange'), label: t('Tidy'), hint: t('lay out again what is not pinned; pins stay'), icon: 'layout-grid', shortcut: keyHint('tidy'), run: pinning.tidyLayout },
    ...(vpins || drawnLayout?.held ? [{ id: 'reset', group: t('Arrange'), label: t('Tidy all (unpin everything)'), hint: t('unpin everything and lay it all out afresh; Undo in the message'), icon: 'pin-off', run: pinning.tidyAll }] : []),
    { id: 'pin', group: t('Arrange'), label: selection.length && selection.every((s) => (s.kind === 'node' ? vpins?.nodes?.[s.id] : vpins?.groups?.[s.id])) ? t('Unpin the selection') : t('Pin the selection where it is'), icon: 'pin', shortcut: keyHint('pin'), run: pinning.togglePin },
    ...arrangeCommands(pinning.arrangeSelection),
    { id: 'lock', group: t('Arrange'), label: selection.length && selection.every((s) => locked.has(s.id)) ? t('Unlock the selection') : t('Lock the selection in place'), icon: 'lock', shortcut: keyHint('lock'), run: pinning.toggleLock },
    ...(selected?.kind === 'edge' && bent.has(selected.id) ? [{ id: 'reset-line', group: t('Arrange'), label: t('Reset line (route it automatically)'), icon: 'route', run: () => pinning.pinTo(pinning.withEdge(selected.id, undefined)) }] : []),
    { id: 'zoom-fit', group: t('View'), label: t('Zoom to fit'), icon: 'maximize', shortcut: keyHint('fit'), run: () => c.previewControl.current?.fit() },
    ...viewList()
      .filter((v) => v !== c.viewName)
      .map((v) => ({ id: `view-${v ?? 'as-written'}`, group: t('View'), label: v === undefined ? t('Show the diagram as written') : t('Show the {view} view', { view: viewTitle(v) }), hint: t('the YAML stays as it is'), icon: 'layers', run: () => nav.showView(v) })),
    ...(viewList().length > 1 ? [{ id: 'view-next', group: t('View'), label: t('Next view'), hint: t('now {what}', { what: viewTitle(c.viewName) }), icon: 'layers', shortcut: keyHint('next-view'), run: nav.nextView }] : []),
    ...(nav.ownView ? [{ id: 'view-keep', group: t('View'), label: t('Write view: {view} into the YAML', { view: c.viewName! }), hint: t('so it opens like this'), icon: 'save', run: nav.keepView }] : []),
    { id: 'zoom-selection', group: t('View'), label: t('Zoom to selection'), icon: 'focus', shortcut: keyHint('zoom-selection'), run: () => c.previewControl.current?.zoomToSelection() },
    { id: 'focus', group: t('Focus'), label: selection.length === 1 && selected && selected.kind !== 'edge' ? t('Focus on {name}', { name: selected.kind === 'node' ? edits.nodeName(selected.id) : (drawn?.graph?.groups.find((g) => g.id === selected.id)?.label ?? selected.id) }) : t('Focus on the selection'), hint: t('only it and what is around it'), icon: 'focus', shortcut: keyHint('focus'), run: nav.focusOnSelection },
    ...(drawn?.focus
      ? [
          { id: 'focus-more', group: t('Focus'), label: t('Focus: one hop more'), hint: drawn.focus.hops === Infinity ? t('everything connected is shown') : t('now {what}', { what: drawn.focus.hops }), icon: 'plus', shortcut: '+', run: () => nav.focusHops(1) },
          { id: 'focus-fewer', group: t('Focus'), label: t('Focus: one hop fewer'), icon: 'minus', shortcut: '−', run: () => nav.focusHops(-1) },
          { id: 'focus-direction', group: t('Focus'), label: t('Focus: both ways, upstream or downstream'), hint: t('now {what}', { what: say(drawn.focus.direction) }), icon: 'arrow-left-right', shortcut: keyHint('focus-direction'), run: nav.focusDirection },
        ]
      : []),
    ...(nav.focusOn ? [{ id: 'focus-leave', group: t('Focus'), label: drawn?.focus ? (drawn.focus.written ? t('Show everything (the YAML has a focus)') : t('Leave the focus')) : t('Back to the focus of the YAML'), icon: drawn?.focus ? 'x' : 'focus', shortcut: keyHint('escape'), run: nav.leaveFocus }] : []),
    { id: 'grid', group: t('View'), label: craft.grid ? t('Stop snapping to the grid') : t('Snap to the 8px grid'), icon: 'grid-3x3', shortcut: keyHint('grid'), run: () => craft.toggle('grid') },
    { id: 'minimap', group: t('View'), label: craft.minimap ? t('Hide the minimap') : t('Show the minimap'), icon: 'map', shortcut: keyHint('minimap'), run: () => craft.toggle('minimap') },
    { id: 'page', group: t('View'), label: craft.page ? t('Hide the page') : t('Show the page ({page})', { page: x.pageName }), hint: t('and text too small on it'), icon: 'monitor', shortcut: keyHint('page'), run: () => craft.toggle('page') },
    { id: 'theme-light', group: t('View'), label: t('Light theme'), icon: 'sun', run: () => c.setPref('light') },
    { id: 'theme-dark', group: t('View'), label: t('Dark theme'), icon: 'moon', run: () => c.setPref('dark') },
    { id: 'theme-system', group: t('View'), label: t('Theme follows system'), icon: 'monitor', run: () => c.setPref('system') },
    { id: 'shortcuts', group: t('View'), label: t('Keyboard shortcuts'), icon: 'keyboard', shortcut: keyHint('sheet'), run: () => setTimeout(() => modals.setModal('shortcuts')) },
    { id: 'problems', group: t('View'), label: t('Show problems'), icon: 'circle-exclamation-point', run: () => modals.setModal('problems') },
    ...(type?.palette ?? []).map((item, i) => ({ id: `add:${i}`, group: t('Add'), label: item.label, hint: item.collection, icon: item.icon, run: () => edits.add(item) })),
    ...(selected?.kind === 'node'
      ? [{ id: 'connect', group: t('Edit'), label: t('Connect {name} to…', { name: edits.nodeName(selected.id) }), icon: 'arrow-right-from-line', shortcut: keyHint('connect'), run: () => setTimeout(() => modals.setModal('connect')) }]
      : []),
    ...(result?.graph?.groups ?? []).map((g) => ({ id: `group:${g.id}`, group: t('Go to'), label: g.label, hint: g.caption ?? g.id, icon: g.icon ?? 'square-dashed', ...(g.tags ? { tags: g.tags } : {}), run: () => goTo({ kind: 'group', id: g.id }) })),
    ...(result?.graph?.nodes ?? []).map((n) => ({ id: `node:${n.id}`, group: t('Go to'), label: label(n), hint: n.id, icon: iconOf(n) ?? 'box', ...(n.tags ? { tags: n.tags } : {}), run: () => goTo({ kind: 'node', id: n.id }) })),
    ...starters.map((s) => ({
      id: `starter:${s.id}`,
      group: t('Start from'),
      label: s.title,
      hint: `${s.kind === 'template' ? t('Template') : t('Example')} · ${typeName(s.type)}`,
      icon: 'layout-template',
      run: () => void files.pick(s),
    })),
    ...[...new Set(starters.map((s) => s.type))].map((ty) => ({
      id: `blank:${ty}`,
      group: t('Start from'),
      label: t('Blank {type}', { type: typeName(ty).toLowerCase() }),
      hint: t('empty diagram'),
      icon: 'file-plus',
      run: () => files.blank(ty),
    })),
  ];
}
