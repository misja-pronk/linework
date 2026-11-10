// "Where is this used": for the element selected, every drawing in the folder that shows it and every
// line of YAML that names it (ref:, of:, instances, relations, views). A click goes there.
import { drawingsOf, type WorkspaceIndex, type WsUse } from '@cartography/core';
import { Icon } from '../icon.tsx';
import { placeName } from './search.tsx';
import type { Place } from './use-workspace.ts';

const HOW: Record<Exclude<WsUse['how'], 'shown'>, string> = {
  defined: 'defined',
  ref: 'ref:',
  of: 'runs it (of:)',
  instance: 'instance',
  'same-id': 'same id',
  relation: 'relation',
  view: 'view of:',
  selector: 'view rule',
  step: 'step',
  edge: 'line',
  name: 'named',
};

export function WhereUsed({ index, element, here, onGo, onRename, extra }: { index: WorkspaceIndex; element: string; here?: Place; onGo(p: Place): void; onRename(): void; extra?: React.ReactNode }) {
  const el = index.elements.get(element)?.[0];
  const drawings = drawingsOf(index, element);
  const named = (index.uses.get(element) ?? []).filter((u) => u.how !== 'shown');
  const incoming = index.relations.filter((r) => r.to === element).length;
  const outgoing = index.relations.filter((r) => r.from === element).length;
  return (
    <section className="where-used" aria-label={`Where ${el?.label ?? element} is used`}>
      <header>
        <Icon name="network" size={14} />
        <span className="where-title" title={element}>
          {el?.label ?? element}
        </span>
        <button className="icon-button small" onClick={onRename} title="Rename everywhere (⇧F2)" aria-label="Rename everywhere">
          <Icon name="tag" size={14} />
        </button>
      </header>
      <p className="where-sub">
        <code>{element}</code>
        {el?.kind ? ` · ${el.kind}` : ''} · {incoming} in, {outgoing} out
      </p>
      <h4>Drawn in {drawings.length}</h4>
      {drawings.length === 0 && <p className="where-none">No drawing shows it yet.</p>}
      {drawings.map((d) => {
        const at = here?.file === d.file && here.view === d.view;
        return (
          <button key={`${d.file}#${d.view ?? ''}`} className={at ? 'where-row active' : 'where-row'} aria-current={at} onClick={() => onGo({ file: d.file, view: d.view, node: d.node })} title={`Open ${placeName(d)} with it selected`}>
            <Icon name={d.view ? 'layers' : 'file-code'} size={13} />
            <span>{placeName(d)}</span>
            {d.node !== element && <span className="where-as">as {d.node}</span>}
          </button>
        );
      })}
      <h4>Named in {named.length}</h4>
      {named.map((u, i) => (
        <button key={i} className="where-row" onClick={() => onGo({ file: u.file, line: u.line })} title={`Show ${u.file}${u.line ? ` line ${u.line}` : ''} in the YAML`}>
          <Icon name="file-code" size={13} />
          <span>
            {u.file}
            {u.line ? `:${u.line}` : ''}
          </span>
          <span className="where-as">{HOW[u.how as Exclude<WsUse['how'], 'shown'>]}</span>
        </button>
      ))}
      {extra}
    </section>
  );
}
