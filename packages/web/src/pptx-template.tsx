// The PowerPoint template decks are made in (docs/powerpoint-templates.md): picked from disk or
// found in the open folder (brand/template.potx), remembered per folder in IndexedDB, bytes and all,
// so it is there again after a reload. Only the Export menu uses it.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Workspace } from './files.ts';
import { Icon } from './icon.tsx';
import { t } from './i18n/index.ts';

export interface TemplateChoice {
  /** File name, or its path in the folder. */
  name: string;
  bytes: Uint8Array;
  /** Draw in the diagram's own theme instead of one made from the template. */
  keepLook?: boolean;
}

const DB = 'linework-pptx';
const keyOf = (ws: Workspace | undefined) => (ws ? `folder:${ws.name}` : 'no-folder');

function db(): Promise<IDBDatabase> {
  return new Promise((ok, fail) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('templates');
    r.onsuccess = () => ok(r.result);
    r.onerror = () => fail(r.error);
  });
}

async function stored(key: string): Promise<TemplateChoice | undefined> {
  try {
    const d = await db();
    return await new Promise((ok) => {
      const r = d.transaction('templates').objectStore('templates').get(key);
      r.onsuccess = () => ok(r.result as TemplateChoice | undefined);
      r.onerror = () => ok(undefined);
    });
  } catch {
    return undefined;
  }
}

async function store(key: string, choice: TemplateChoice | undefined) {
  try {
    const d = await db();
    const s = d.transaction('templates', 'readwrite').objectStore('templates');
    if (choice) s.put(choice, key);
    else s.delete(key);
  } catch {
    /* private window: chosen for this session only */
  }
}

/** Bytes of a file in the folder, by its path from the folder's root. */
export async function folderBytes(ws: Workspace, file: string): Promise<Uint8Array | undefined> {
  try {
    let d = ws.dir;
    const parts = file.split('/').filter((s) => s && s !== '.');
    for (const seg of parts.slice(0, -1)) d = await d.getDirectoryHandle(seg);
    return new Uint8Array(await (await (await d.getFileHandle(parts.at(-1)!)).getFile()).arrayBuffer());
  } catch {
    return undefined;
  }
}

/** PowerPoint templates in the folder, the shallowest first (brand/template.potx before deep copies). */
async function templatesIn(ws: Workspace): Promise<string[]> {
  const found: string[] = [];
  const walk = async (d: FileSystemDirectoryHandle, prefix: string, depth: number) => {
    for await (const [name, h] of (d as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
      if (h.kind === 'directory') {
        if (depth < 3 && !name.startsWith('.') && name !== 'node_modules') await walk(h as FileSystemDirectoryHandle, `${prefix}${name}/`, depth + 1);
      } else if (/\.potx$/i.test(name) || (/\.pptx$/i.test(name) && /template|sjabloon|vorlage|modèle|brand|huisstijl/i.test(prefix + name))) found.push(prefix + name);
    }
  };
  try {
    await walk(ws.dir, '', 0);
  } catch {
    /* a folder that cannot be listed has none */
  }
  return found.sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b)).slice(0, 6);
}

/** The chosen template for the open folder, the ones the folder has, and the menu's actions. */
export function useTemplateChoice(ws: Workspace | undefined, onError: (m: string) => void) {
  const [chosen, setChosen] = useState<TemplateChoice>();
  const [found, setFound] = useState<string[]>([]);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let live = true;
    void stored(keyOf(ws)).then((c) => live && setChosen(c));
    if (ws) void templatesIn(ws).then((f) => live && setFound(f));
    else setFound([]);
    return () => {
      live = false;
    };
  }, [ws]);
  const choose = useCallback(
    (c: TemplateChoice | undefined) => {
      setChosen(c);
      void store(keyOf(ws), c);
    },
    [ws],
  );
  const useFound = useCallback(
    async (path: string) => {
      const bytes = ws && (await folderBytes(ws, path));
      if (!bytes) return onError(t('Cannot read {path}', { path }));
      choose({ name: path, bytes });
    },
    [ws, choose, onError],
  );
  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!/\.(potx|pptx)$/i.test(file.name)) return onError(t('{name} is not a PowerPoint template: pick a .potx or .pptx', { name: file.name }));
    const bytes = await file.arrayBuffer().catch(() => undefined);
    if (!bytes) return onError(t('Cannot read {path}', { path: file.name }));
    choose({ name: file.name, bytes: new Uint8Array(bytes) });
  };
  const picker = <input ref={input} type="file" accept=".potx,.pptx,application/vnd.openxmlformats-officedocument.presentationml.template,application/vnd.openxmlformats-officedocument.presentationml.presentation" hidden onChange={(e) => void onFile(e)} data-pptx-template />;
  return {
    chosen,
    found,
    picker,
    pick: () => input.current?.click(),
    useFound,
    clear: () => choose(undefined),
    toggleKeepLook: () => chosen && choose({ ...chosen, keepLook: !chosen.keepLook }),
  };
}

export type TemplateState = ReturnType<typeof useTemplateChoice>;

/** The Export menu's rows for the template, under PowerPoint. */
export function TemplateItems({ t: tpl }: { t: TemplateState }) {
  const base = (p: string) => p.split('/').pop()!;
  return (
    <>
      {tpl.found
        .filter((p) => p !== tpl.chosen?.name)
        .map((p) => (
          <button key={p} role="menuitem" onClick={() => void tpl.useFound(p)} title={t('A PowerPoint template in this folder')} data-template-found={p}>
            <Icon name="layout-template" /> {t('Use {name}', { name: base(p) })}
          </button>
        ))}
      <button role="menuitem" onClick={tpl.pick} title={t('Make the PowerPoint export in a .potx or .pptx: its layouts, master, fonts and colours')} data-template-pick>
        <Icon name="folder-open" /> {tpl.chosen ? t('Another template…') : t('Use a template…')}
      </button>
      {tpl.chosen && (
        <>
          <button
            role="menuitemcheckbox"
            aria-checked={!!tpl.chosen.keepLook}
            title={t("Draw the diagram in its own theme on the template's slides, rather than in the template's colours and fonts")}
            onClick={(e) => {
              e.stopPropagation();
              tpl.toggleKeepLook();
            }}
          >
            <Icon name={tpl.chosen.keepLook ? 'check' : 'square'} /> {t("Keep the diagram's own look")}
          </button>
          <button role="menuitem" onClick={tpl.clear} data-template-clear>
            <Icon name="x" /> {t('Stop using {name}', { name: base(tpl.chosen.name) })}
          </button>
        </>
      )}
    </>
  );
}
