// The diagram's views, in the canvas tools: one drawing per view of the same file (context, containers…).
// viewChoices is what every list of views offers (the picker, the read-only viewer); viewsOf names them.
import './view-picker.css';
import type { RenderResult } from '@linework/engine';
import { Icon } from './icon.tsx';
import { t, uiLang } from './i18n/index.ts';

export interface ViewChoice {
  name: string;
  title?: string;
}

type Viewed = Pick<RenderResult, 'views' | 'view' | 'asWritten' | 'onlyViews' | 'canvas' | 'viewTitles' | 'lang'>;

/**
 * The diagram's views as the editor's chrome names them: a title the type gives its own view in the
 * editor's language (the drawing keeps the diagram's `lang:`), one the author wrote as written.
 * `written` is the type's own view the diagram as written is (data products: the one in `view:`).
 */
export function viewsOf(r: Viewed | undefined): { views?: ViewChoice[]; written?: ViewChoice } {
  const ui = uiLang();
  const own = r?.viewTitles && ui !== (r.lang ?? 'en') ? r.viewTitles(ui) : undefined;
  const named = (v: ViewChoice | undefined) => (v && own?.[v.name] ? { ...v, title: own[v.name] } : v);
  return { views: r?.views?.map((v) => named(v)!), written: named(r?.asWritten) };
}

/**
 * What a list of views offers: "As written" (value '') next to the views where there is such a drawing,
 * except where the diagram as written is one of the type's own views: then that view is named instead,
 * and listed even when the type does not offer it (a hidden one). `value` is the one drawn now.
 */
export function viewChoices(r: Viewed | undefined): { asWritten: boolean; views: ViewChoice[]; value: string; written?: ViewChoice; canvas?: boolean } | undefined {
  const { views: offered, written } = viewsOf(r);
  if (!offered?.length) return undefined;
  const views = written && !offered.some((v) => v.name === written.name) ? [...offered, written] : offered;
  return { asWritten: !r!.onlyViews && !written, views, value: r!.view ?? written?.name ?? '', written, ...(r!.canvas ? { canvas: true } : {}) };
}

/**
 * The view a choice asks for: none for the diagram as written, which a named view as written is too.
 * A canvas (present: views) draws its first view when none is asked for: its whole drawing is asked for as ''.
 */
export const pickedView = (value: string, written?: ViewChoice, canvas?: boolean) => (value === written?.name ? undefined : value || (canvas ? '' : undefined));

export interface ViewPickerProps {
  drawn?: Viewed;
  onChange(view: string | undefined): void;
}

export function ViewPicker({ drawn, onChange }: ViewPickerProps) {
  const c = viewChoices(drawn);
  if (!c) return null;
  return (
    <label className="tool view-picker" title={t('Views of this diagram (V: next view; pins are kept per view)')}>
      <Icon name="eye" />
      <select value={c.value} onChange={(e) => onChange(pickedView(e.target.value, c.written, c.canvas))} aria-label={t('View')}>
        {c.asWritten && <option value="">{t('Whole diagram')}</option>}
        {c.views.map((v) => (
          <option key={v.name} value={v.name}>
            {/* The view's name in brackets only where two views share a title, to tell them apart. */}
            {v.title ? (c.views.some((o) => o !== v && o.title === v.title) ? `${v.title} (${v.name})` : v.title) : v.name}
          </option>
        ))}
      </select>
    </label>
  );
}
