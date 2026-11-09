// The editor app: YAML on the left, the drawing on the right, both selecting the same element.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Editor, type EditorHandle } from './editor.tsx';
import { Preview, type Selection } from './preview.tsx';
import { Palette, type Command } from './palette.tsx';
import { Templates } from './templates.tsx';
import { Icon } from './icon.tsx';
import { useRender } from './use-render.ts';
import { entryAt, entryRanges } from './ranges.ts';
import { exampleLoader, starters, typeName, type Starter } from './library.ts';
import { baseName, download, exportPng, exportSvg } from './export.ts';
import { store } from './store.ts';

type ThemePref = 'system' | 'light' | 'dark';

interface Doc {
  name: string;
  /** Where it came from, so bundled examples can read their contract files. */
  starter?: string;
}

function useSystemDark() {
  const q = useMemo(() => window.matchMedia('(prefers-color-scheme: dark)'), []);
  const [dark, setDark] = useState(q.matches);
  useEffect(() => {
    const on = () => setDark(q.matches);
    q.addEventListener('change', on);
    return () => q.removeEventListener('change', on);
  }, [q]);
  return dark;
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

const firstStarter = starters.find((s) => s.id === 'example:data-products/customer-detailed.yaml') ?? starters[0]!;

export function App() {
  const saved = store.get<{ text: string; doc: Doc }>('doc');
  const [text, setText] = useState(saved?.text ?? firstStarter.text);
  const [doc, setDoc] = useState<Doc>(saved?.doc ?? { name: firstStarter.file, starter: firstStarter.id });
  const [docKey, setDocKey] = useState(0);
  const [pref, setPref] = useState<ThemePref>(store.get('theme') ?? 'system');
  const systemDark = useSystemDark();
  const theme: 'light' | 'dark' = pref === 'system' ? (systemDark ? 'dark' : 'light') : pref;
  const [selected, setSelected] = useState<Selection>();
  const [modal, setModal] = useState<'palette' | 'templates' | 'problems'>();
  const [menu, setMenu] = useState(false);
  const [toast, setToast] = useState<{ message: string; action?: { label: string; run(): void } }>();
  const [split, setSplit] = useState<number>(store.get('split') ?? 0.4);
  const editor = useRef<EditorHandle>(null);

  const load = useMemo(() => (doc.starter ? exampleLoader(doc.starter) : undefined), [doc.starter]);
  const rendered = useRender(useDebounced(text, 40), theme, undefined, load, docKey);
  const result = rendered?.result;
  const diagnostics = result?.diagnostics ?? [];
  const errors = diagnostics.filter((d) => d.severity === 'error').length;
  const warnings = diagnostics.length - errors;
  const entries = useMemo(() => entryRanges(rendered?.text ?? '', result?.graph), [rendered?.text, result?.graph]);
  const mark = selected ? entries.find((e) => e.kind === selected.kind && e.id === selected.id) : undefined;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  useEffect(() => store.set('theme', pref), [pref]);
  useEffect(() => store.set('split', split), [split]);
  useEffect(() => {
    const t = setTimeout(() => store.set('doc', { text, doc }), 300);
    return () => clearTimeout(t);
  }, [text, doc]);

  const notify = useCallback((message: string, action?: { label: string; run(): void }) => {
    setToast({ message, action });
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(undefined), toast.action ? 7000 : 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const open = useCallback(
    (next: string, nextDoc: Doc) => {
      const before = { text: editor.current?.text() ?? text, doc };
      editor.current?.load(next);
      setDoc(nextDoc);
      setSelected(undefined);
      setDocKey((k) => k + 1);
      notify(`Opened ${nextDoc.name}`, {
        label: 'Undo',
        run: () => {
          editor.current?.load(before.text);
          setDoc(before.doc);
          setDocKey((k) => k + 1);
        },
      });
    },
    [text, doc, notify],
  );

  const pick = (s: Starter) => {
    setModal(undefined);
    open(s.text, { name: s.file, starter: s.id });
  };

  const openFile = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.yaml,.yml,text/yaml';
    input.onchange = async () => {
      const f = input.files?.[0];
      if (f) open(await f.text(), { name: f.name });
    };
    input.click();
  };

  const exportInput = () => ({ text: editor.current?.text() ?? text, theme, load });
  const saveYaml = () => download(doc.name.endsWith('.yaml') ? doc.name : `${doc.name}.yaml`, editor.current?.text() ?? text, 'text/yaml');
  const saveSvg = async () => {
    const svg = await exportSvg(exportInput());
    if (svg) download(`${baseName(doc.name)}.svg`, svg, 'image/svg+xml');
  };
  const savePng = async () => {
    const png = await exportPng(exportInput(), 2);
    if (png) download(`${baseName(doc.name)}.png`, png);
  };
  const copySvg = async () => {
    const svg = await exportSvg(exportInput());
    if (!svg) return;
    await navigator.clipboard.writeText(svg);
    notify('SVG copied');
  };
  const copyPng = async () => {
    const png = exportPng(exportInput(), 2).then((b) => b ?? new Blob());
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
    notify('PNG copied, paste it into slides or docs');
  };

  const selectFromDrawing = (s: Selection | undefined) => {
    setSelected(s);
    const e = s && entries.find((x) => x.kind === s.kind && x.id === s.id);
    if (e) editor.current?.reveal(e.from, e.to);
  };
  const onCursor = (pos: number) => {
    const e = entryAt(entries, pos);
    setSelected(e ? { kind: e.kind, id: e.id } : undefined);
  };

  const commands: Command[] = [
    { id: 'new', group: 'File', label: 'New from template…', icon: 'layout-template', run: () => setModal('templates') },
    { id: 'open', group: 'File', label: 'Open YAML file…', icon: 'folder-open', shortcut: '⌘O', run: openFile },
    { id: 'save', group: 'File', label: 'Save YAML', icon: 'save', shortcut: '⌘S', run: saveYaml },
    { id: 'svg', group: 'Export', label: 'Export SVG', icon: 'download', shortcut: '⌘E', run: saveSvg },
    { id: 'png', group: 'Export', label: 'Export PNG (2×)', icon: 'image', shortcut: '⇧⌘E', run: savePng },
    { id: 'copy-png', group: 'Export', label: 'Copy as PNG', icon: 'copy', run: copyPng },
    { id: 'copy-svg', group: 'Export', label: 'Copy as SVG', icon: 'copy', run: copySvg },
    { id: 'theme-light', group: 'View', label: 'Light theme', icon: 'sun', run: () => setPref('light') },
    { id: 'theme-dark', group: 'View', label: 'Dark theme', icon: 'moon', run: () => setPref('dark') },
    { id: 'theme-system', group: 'View', label: 'Theme follows system', icon: 'monitor', run: () => setPref('system') },
    { id: 'problems', group: 'View', label: 'Show problems', icon: 'circle-exclamation-point', run: () => setModal('problems') },
    ...starters.map((s) => ({
      id: `starter:${s.id}`,
      group: 'Start from',
      label: s.title,
      hint: `${s.kind === 'template' ? 'Template' : 'Example'} · ${typeName(s.type)}`,
      icon: 'layout-template',
      run: () => pick(s),
    })),
    ...(result?.graph?.nodes ?? []).map((n) => ({
      id: `node:${n.id}`,
      group: 'Go to',
      label: n.shape.kind === 'card' ? n.shape.label : n.shape.kind === 'table' ? n.shape.title : n.id,
      hint: n.id,
      icon: n.shape.kind === 'card' || n.shape.kind === 'table' ? (n.shape.icon ?? 'box') : 'table',
      run: () => selectFromDrawing({ kind: 'node', id: n.id }),
    })),
  ];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      if (k === 'k') setModal((m) => (m === 'palette' ? undefined : 'palette'));
      else if (k === 's') saveYaml();
      else if (k === 'o') openFile();
      else if (k === 'e') void (e.shiftKey ? savePng() : saveSvg());
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Splitter between editor and drawing.
  const dragSplit = (e: React.PointerEvent) => {
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => setSplit(Math.min(0.7, Math.max(0.2, ev.clientX / window.innerWidth)));
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };

  const typeId = result?.type?.id;
  return (
    <div className="app" style={{ ['--split' as string]: `${split * 100}%` }}>
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden="true" />
          Cartography
        </div>
        <div className="doc-name">
          <Icon name="file-code" />
          <span>{doc.name}</span>
          {typeId && <span className="type-pill">{typeName(typeId)}</span>}
        </div>
        <div className="actions">
          <button className="button ghost" onClick={() => setModal('templates')}>
            <Icon name="layout-template" /> Templates
          </button>
          <button className="button ghost" onClick={() => setModal('palette')} title="Command palette">
            <Icon name="search" /> Commands <kbd>⌘K</kbd>
          </button>
          <button
            className="icon-button"
            onClick={() => setPref(theme === 'dark' ? 'light' : 'dark')}
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
            aria-label="Toggle theme"
          >
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
          </button>
          <div className="menu-anchor">
            <button className="button primary" onClick={() => setMenu((m) => !m)} aria-expanded={menu}>
              <Icon name="download" /> Export <Icon name="chevron-down" size={14} />
            </button>
            {menu && (
              <div className="menu" role="menu" onMouseLeave={() => setMenu(false)} onClick={() => setMenu(false)}>
                <button role="menuitem" onClick={saveSvg}>
                  <Icon name="download" /> SVG <kbd>⌘E</kbd>
                </button>
                <button role="menuitem" onClick={savePng}>
                  <Icon name="image" /> PNG 2× <kbd>⇧⌘E</kbd>
                </button>
                <hr />
                <button role="menuitem" onClick={copyPng}>
                  <Icon name="copy" /> Copy as PNG
                </button>
                <button role="menuitem" onClick={copySvg}>
                  <Icon name="copy" /> Copy as SVG
                </button>
                <hr />
                <button role="menuitem" onClick={saveYaml}>
                  <Icon name="save" /> Save YAML <kbd>⌘S</kbd>
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="workspace">
        <section className="pane editor-pane" aria-label="YAML">
          <Editor ref={editor} initial={text} diagnostics={diagnostics} mark={mark} onChange={setText} onCursor={onCursor} />
        </section>
        <div className="splitter" onPointerDown={dragSplit} role="separator" aria-orientation="vertical" />
        <section className="pane canvas-pane" aria-label="Drawing">
          <Preview result={rendered?.drawn} stale={!!rendered && rendered.drawn !== result} selected={selected} onSelect={selectFromDrawing} docKey={`${docKey}`} />
        </section>
      </main>

      <footer className="statusbar">
        <button className={`status-problems${errors ? ' has-errors' : warnings ? ' has-warnings' : ''}`} onClick={() => setModal('problems')}>
          <Icon name={errors || warnings ? 'circle-exclamation-point' : 'check'} size={14} />
          {errors || warnings ? `${errors} error${errors === 1 ? '' : 's'}${warnings ? `, ${warnings} warning${warnings === 1 ? '' : 's'}` : ''}` : 'No problems'}
        </button>
        {result?.graph && (
          <span>
            {result.graph.nodes.length} elements · {result.graph.edges.length} lines
          </span>
        )}
        {selected && (
          <span className="status-selected">
            <Icon name="mouse-pointer-2" size={13} /> {selected.id}
          </span>
        )}
        <span className="spacer" />
        {rendered && <span>{rendered.ms} ms</span>}
        <span>{theme === 'dark' ? 'Dark' : 'Light'}</span>
      </footer>

      {modal === 'palette' && <Palette commands={commands} onClose={() => setModal(undefined)} />}
      {modal === 'templates' && <Templates theme={theme} onPick={pick} onClose={() => setModal(undefined)} />}
      {modal === 'problems' && (
        <Palette
          placeholder={diagnostics.length ? 'Filter problems…' : 'No problems'}
          onClose={() => setModal(undefined)}
          commands={diagnostics.map((d, i) => ({
            id: `p${i}`,
            group: d.severity === 'error' ? 'Errors' : 'Warnings',
            label: d.message,
            hint: d.line ? `line ${d.line}` : undefined,
            icon: 'circle-exclamation-point',
            run: () => {
              if (d.from != null) editor.current?.reveal(d.from, d.to ?? d.from);
              editor.current?.focus();
            },
          }))}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          {toast.message}
          {toast.action && (
            <button
              onClick={() => {
                toast.action!.run();
                setToast(undefined);
              }}
            >
              {toast.action.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
