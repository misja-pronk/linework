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
  toggleSafeSvg(): void;
  /** Steps somebody wrote: a slide or page for each. */
  written: boolean;
  hasPins: boolean;
  onDescribe(): void;
  saveYaml(): void;
  downloadYaml(): void;
}

export function ExportMenu({ exports: x, safeSvg, toggleSafeSvg, written, hasPins, onDescribe, saveYaml, downloadYaml }: ExportMenuProps) {
  const [menu, setMenu] = useState(false);
  const tpl = x.pptxTemplate;
  return (
    <div className="menu-anchor">
      {tpl.picker}
      <button className="button primary" onClick={() => setMenu((m) => !m)} aria-expanded={menu} aria-haspopup="menu">
        <Icon name="download" /> {t('Export')} <Icon name="chevron-down" size={14} />
      </button>
      {menu && (
        <Menu onClose={() => setMenu(false)}>
          <div className="menu-heading">{t('Image')}</div>
          <button role="menuitem" onClick={x.saveSvg}>
            <Icon name="download" /> {safeSvg ? t('SVG for PowerPoint / Word') : 'SVG'} <kbd>{keyHint('export-svg')}</kbd>
          </button>
          <button role="menuitem" onClick={x.savePng}>
            <Icon name="image" /> PNG 2× <kbd>{keyHint('export-png')}</kbd>
          </button>
          <button role="menuitem" onClick={x.copyPng}>
            <Icon name="copy" /> {t('Copy as PNG')}
          </button>
          <button role="menuitem" onClick={x.copySvg}>
            <Icon name="copy" /> {t('Copy as SVG')}
          </button>
          <button
            role="menuitemcheckbox"
            aria-checked={safeSvg}
            title={t('SVG without what PowerPoint, Word and Keynote drop: no CSS or effects, system fonts, one group per node')}
            onClick={(e) => {
              // A switch: the menu stays open, the SVG rows above follow it.
              e.stopPropagation();
              toggleSafeSvg();
            }}
          >
            <Icon name={safeSvg ? 'check' : 'square'} /> {t('SVG for PowerPoint / Word')}
          </button>
          <div className="menu-heading">{t('Document, on the page ({page})', { page: x.pageName })}</div>
          <button role="menuitem" onClick={x.savePptx}>
            <Icon name="layout-template" /> {tpl.chosen ? `${t('PowerPoint in {template}', { template: tpl.chosen.name.split('/').pop()! })}${written ? t(', a slide per step') : ''}` : written ? t('PowerPoint, a slide per step (.pptx)') : 'PowerPoint (.pptx)'}
          </button>
          <TemplateItems t={tpl} />
          <button role="menuitem" onClick={x.savePdf}>
            <Icon name="file-text" /> {written ? t('PDF, a page per step') : 'PDF'}
          </button>
          <button role="menuitem" onClick={x.saveSlide}>
            <Icon name="monitor" /> {t('PNG of the page')}
          </button>
          <button role="menuitem" onClick={x.savePageSvg}>
            <Icon name="monitor" /> {t('SVG of the page')}
          </button>
          <button role="menuitem" onClick={onDescribe} title={t('What the diagram shows, in words: for a screen reader, a handout or a wiki')}>
            <Icon name="scroll-text" /> {t('Describe in words…')}
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
          <hr />
          <button role="menuitem" onClick={saveYaml}>
            <Icon name="save" /> {t('Save')} <kbd>{keyHint('save')}</kbd>
          </button>
          <button role="menuitem" onClick={downloadYaml}>
            <Icon name="download" /> {t('Download YAML')}
          </button>
          {hasPins && (
            <button role="menuitem" onClick={x.saveLayout}>
              <Icon name="pin" /> {t('Save layout')}
            </button>
          )}
        </Menu>
      )}
    </div>
  );
}
