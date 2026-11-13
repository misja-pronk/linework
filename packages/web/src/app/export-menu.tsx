// The Export menu in the top bar: images, documents on the page, sharing, and saving the YAML.
import { useState } from 'react';
import { t } from '../i18n/index.ts';
import { Icon } from '../icon.tsx';
import { Menu } from '../menu.tsx';
import { keyHint } from '../keys.ts';
import { TemplateItems } from '../pptx-template.tsx';
import type { Exports } from './exports.ts';

export interface ExportMenuProps {
  exports: Exports;
  safeSvg: boolean;
  /** Steps somebody wrote: a slide or page for each. */
  written: boolean;
  onDescribe(): void;
}

/**
 * Pictures, the deck and pages, and ways to share: what goes out. Saving the YAML is under ⋯ (and ⌘S);
 * copying as SVG and the SVG for Office switch are in ⌘K.
 */
export function ExportMenu({ exports: x, safeSvg, written, onDescribe }: ExportMenuProps) {
  const [menu, setMenu] = useState(false);
  const tpl = x.pptxTemplate;
  const slide = x.pageName.endsWith('slide');
  return (
    <div className="menu-anchor">
      {tpl.picker}
      <button className="button primary" onClick={() => setMenu((m) => !m)} aria-expanded={menu} aria-haspopup="menu">
        <Icon name="download" /> {t('Export')} <Icon name="chevron-down" size={14} />
      </button>
      {menu && (
        <Menu onClose={() => setMenu(false)}>
          <div className="menu-heading">{t('Picture')}</div>
          <button role="menuitem" onClick={x.savePng}>
            <Icon name="image" /> PNG <kbd>{keyHint('export-png')}</kbd>
          </button>
          <button role="menuitem" onClick={x.saveSvg} title={safeSvg ? t('SVG without what PowerPoint, Word and Keynote drop: no CSS or effects, system fonts, one group per node') : undefined}>
            <Icon name="download" /> {safeSvg ? t('SVG for PowerPoint / Word') : 'SVG'} <kbd>{keyHint('export-svg')}</kbd>
          </button>
          <button role="menuitem" onClick={x.copyPng}>
            <Icon name="copy" /> {t('Copy the picture')}
          </button>
          <div className="menu-heading">{slide ? t('On a {page}', { page: x.pageName }) : t('On paper ({page})', { page: x.pageName })}</div>
          <button role="menuitem" onClick={x.savePptx}>
            <Icon name="layout-template" /> {tpl.chosen ? `${t('PowerPoint in {template}', { template: tpl.chosen.name.split('/').pop()! })}${written ? t(', a slide per step') : ''}` : written ? t('PowerPoint, a slide per step (.pptx)') : 'PowerPoint (.pptx)'}
          </button>
          <TemplateItems t={tpl} />
          <button role="menuitem" onClick={x.savePdf}>
            <Icon name="file-text" /> {written ? t('PDF, a page per step') : 'PDF'}
          </button>
          <button role="menuitem" onClick={x.saveSlide}>
            <Icon name="monitor" /> {slide ? t('The slide as PNG') : t('The page as PNG')}
          </button>
          <button role="menuitem" onClick={x.savePageSvg}>
            <Icon name="monitor" /> {slide ? t('The slide as SVG') : t('The page as SVG')}
          </button>
          <div className="menu-heading">{t('Share')}</div>
          <button role="menuitem" onClick={x.copyShare} title={t('The diagram goes in the link itself: nothing is uploaded')}>
            <Icon name="link" /> {t('Copy share link')}
          </button>
          <button role="menuitem" onClick={() => x.saveHtml()} title={t('One file to send: every view and step, zoom, search, drill-down')}>
            <Icon name="globe" /> {t('Interactive HTML (.html)')}
          </button>
          <button role="menuitem" onClick={x.copyForWiki} title={t('The picture and the description in one paste, for Confluence, Notion or Google Docs')}>
            <Icon name="book-open" /> {t('Copy for Confluence / Notion')}
          </button>
          <button role="menuitem" onClick={onDescribe} title={t('What the diagram shows, in words: for a screen reader, a handout or a wiki')}>
            <Icon name="scroll-text" /> {t('Describe in words…')}
          </button>
        </Menu>
      )}
    </div>
  );
}
