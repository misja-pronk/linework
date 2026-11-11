// "Official icons…": where each vendor's set is downloaded, drop the zip or pick the folder, and a
// sheet of our kinds with the icon each got. A kind without one (or with the wrong one) gets an icon
// by picking it from the set. Everything stays in this browser.
import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { Icon } from './icon.tsx';
import { useModal } from './menu.tsx';
import { t } from './i18n/index.ts';
import { coverage, folderFiles, iconSvg, importDownload, listFiles, mapKind, removePack, searchIcons, unmapKind, useIconPacks, vendorKinds, vendors, zipFiles, type StoredPack, type Vendor } from './icon-packs.ts';

const ORDER: Vendor[] = ['azure', 'aws', 'gcp', 'kubernetes'];
const canPickFolder = typeof window !== 'undefined' && 'showDirectoryPicker' in window;

const dataUri = (svg: string) => `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;

export function IconPacksDialog({ onClose, onDone }: { onClose(): void; onDone?(message: string, tone?: 'error'): void }) {
  const modal = useModal();
  const s = useIconPacks();
  const [open, setOpen] = useState<Vendor | undefined>(() => ORDER.find((v) => s.packs[v]));
  const sheet = useRef<HTMLDivElement>(null);
  // After an import the sheet of that set comes into view: what got an icon and what did not.
  useEffect(() => {
    void sheet.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, [open]);
  const [error, setError] = useState<string>();
  const [over, setOver] = useState(false);
  const zipInput = useRef<HTMLInputElement>(null);
  const dirInput = useRef<HTMLInputElement>(null);
  const target = useRef<Vendor | undefined>(undefined);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !(e.target as HTMLElement).closest?.('.icon-pick')) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const run = async (get: () => Promise<{ files: Awaited<ReturnType<typeof zipFiles>>; source: string } | undefined>, vendor?: Vendor) => {
    setError(undefined);
    try {
      const got = await get();
      if (!got) return;
      const r = await importDownload(got.files, got.source, vendor);
      setOpen(r.vendor);
      onDone?.(t('{vendor} icons: {have} of {of} kinds have an icon', { vendor: vendors[r.vendor].name, have: r.have, of: r.of }));
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      setError((e as Error).message);
    }
  };
  const chooseZip = (v?: Vendor) => {
    target.current = v;
    zipInput.current?.click();
  };
  const chooseFolder = (v?: Vendor) => {
    target.current = v;
    if (!canPickFolder) return dirInput.current?.click();
    void run(async () => {
      const dir = await (window as unknown as { showDirectoryPicker(o: object): Promise<FileSystemDirectoryHandle> }).showDirectoryPicker({ mode: 'read', id: 'cartography-icons' });
      return { files: await folderFiles(dir), source: dir.name };
    }, v);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const file = [...e.dataTransfer.files][0];
    if (!file) return;
    void run(async () => (/\.zip$/i.test(file.name) ? { files: await zipFiles(file), source: file.name } : { files: listFiles([...e.dataTransfer.files]), source: file.name }));
  };

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div
        className={`shortcuts icon-packs${over ? ' dropping' : ''}`}
        role="dialog" aria-modal="true" ref={modal}
        aria-label={t('Official icons')}
        onMouseDown={(e) => e.stopPropagation()}
        onDragOver={(e) => (e.preventDefault(), setOver(true))}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        <header>
          <h2>
            <Icon name="boxes" /> {t('Official icons')}
          </h2>
          <button className="icon-button" onClick={onClose} aria-label={t('Close')} autoFocus>
            <Icon name="x" />
          </button>
        </header>
        <p className="icon-packs-lead">
          {t("Customers expect the vendors' own icons. Their terms do not let us ship them, so download each set once and drop the zip here: it is copied into this browser and matched to our shapes. Diagrams made with them can be shared as pictures, slides and pages; the set itself stays with you. Turn them on in the theme menu, or with")}{' '}
          <code>icons: official</code>{' '}
          {t('in a diagram.')}
        </p>
        <input
          ref={zipInput}
          type="file"
          accept=".zip,application/zip"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void run(async () => ({ files: await zipFiles(f), source: f.name }), target.current);
          }}
        />
        <input
          ref={dirInput}
          type="file"
          hidden
          {...({ webkitdirectory: '' } as object)}
          onChange={(e) => {
            const list = [...(e.target.files ?? [])];
            e.target.value = '';
            if (list.length) void run(async () => ({ files: listFiles(list), source: list[0]!.webkitRelativePath.split('/')[0] || 'folder' }), target.current);
          }}
        />
        {error && (
          <p className="icon-packs-error" role="alert">
            <Icon name="circle-exclamation-point" size={14} /> {error}
          </p>
        )}
        {s.busy && (
          <p className="icon-packs-busy" role="status">
            {s.busy.vendor ? t('Copying {vendor} icons… {done} of {of}', { vendor: vendors[s.busy.vendor].name, done: s.busy.done, of: s.busy.of }) : t('Copying icons… {done} of {of}', { done: s.busy.done, of: s.busy.of })}
          </p>
        )}
        <div className="icon-vendors">
          {ORDER.map((v) => {
            const info = vendors[v];
            const pack = s.packs[v];
            const cov = pack ? coverage(pack, vendorKinds(v)) : undefined;
            return (
              <section key={v} className="icon-vendor" data-vendor={v}>
                <h3>
                  {info.name}
                  <span className="icon-status">{cov ? t('{have} of {of} shapes · {date}', { have: cov.have, of: cov.of, date: pack!.imported ?? '' }) : t('not imported')}</span>
                </h3>
                <ol>
                  <li>
                    {t('Open@step')}{' '}
                    <a href={info.page} target="_blank" rel="noreferrer noopener">
                      {info.page.replace(/^https:\/\//, '').replace(/\/$/, '')}
                    </a>
                  </li>
                  <li>{info.link}</li>
                  <li>
                    {t('You get')} <span className="icon-file">{info.file.split(/[\s,;]/)[0]}</span> {info.file.split(';')[0]!.replace(/^\S+[\s,]*/, '')}
                  </li>
                </ol>
                <p className="icon-terms">{info.terms}</p>
                <div className="icon-actions">
                  <button className="button" onClick={() => chooseZip(v)} disabled={!!s.busy}>
                    <Icon name="archive" /> {pack ? t('Newer zip…') : t('Choose zip…')}
                  </button>
                  <button className="button ghost" onClick={() => chooseFolder(v)} disabled={!!s.busy}>
                    <Icon name="folder-open" /> {t('Folder…')}
                  </button>
                  {pack && (
                    <>
                      <button className="button ghost" onClick={() => setOpen(open === v ? undefined : v)} aria-expanded={open === v}>
                        <Icon name="layout-grid" /> {open === v ? t('Hide shapes') : t('Check shapes')}
                      </button>
                      <button className="button ghost" onClick={() => void removePack(v)} title={t('Forget this set in this browser')}>
                        <Icon name="trash" />
                      </button>
                    </>
                  )}
                </div>
              </section>
            );
          })}
        </div>
        <p className="icon-packs-note">{t("Vendors move their pages and rename their downloads now and then; matching goes by the icons' names, so a newer release imports the same way and keeps what you mapped by hand. Or drop a zip anywhere on this sheet.")}</p>
        <div ref={sheet}>{open && s.packs[open] && <PackSheet vendor={open} pack={s.packs[open]!} markup={s.markup[open] ?? {}} />}</div>
      </div>
    </div>
  );
}

/** Our shapes with the icon each got; click one to pick another icon from the set. */
function PackSheet({ vendor, pack, markup }: { vendor: Vendor; pack: StoredPack; markup: Record<string, string> }) {
  const kinds = useMemo(() => vendorKinds(vendor), [vendor]);
  const cov = coverage(pack, kinds);
  const [picking, setPicking] = useState<string>();
  const uris = useMemo(() => Object.fromEntries(Object.entries(markup).map(([k, svg]) => [k, dataUri(svg)])), [markup]);
  return (
    <section className="icon-sheet" aria-label={t('{vendor} shapes', { vendor: vendors[vendor].name })}>
      <h3>
        {t('{have} of {of} shapes have a {vendor} icon', { have: cov.have, of: cov.of, vendor: vendors[vendor].name })}
      </h3>
      <p className="icon-terms">
        {cov.missing.length ? `${t('{count} draw their line icon (dashed below): {list}|{count} draw their line icon (dashed below): {list}', { count: cov.missing.length, list: `${cov.missing.slice(0, 12).join(', ')}${cov.missing.length > 12 ? t(' and more') : ''}` })}. ` : ''}
        {t('Click a shape to give it another icon from the set.')}
      </p>
      <div className="icon-grid" role="list">
        {kinds.map((k) => (
          <button key={k.kind} role="listitem" className={`icon-tile${pack.icons[k.kind] ? '' : ' missing'}${picking === k.kind ? ' picking' : ''}`} onClick={() => setPicking(picking === k.kind ? undefined : k.kind)} title={pack.icons[k.kind] ?? t('No icon yet: click to pick one')} data-kind={k.kind}>
            {uris[k.kind] ? <img src={uris[k.kind]} alt="" width={32} height={32} /> : <span className="icon-empty" aria-hidden="true" />}
            <span>{k.label ?? k.kind}</span>
            {pack.manual?.[k.kind] && <span className="icon-hand">{t('by hand')}</span>}
          </button>
        ))}
      </div>
      {picking && <IconPick vendor={vendor} pack={pack} kind={picking} label={kinds.find((k) => k.kind === picking)?.label ?? picking} onDone={() => setPicking(undefined)} />}
    </section>
  );
}

function IconPick({ vendor, pack, kind, label, onDone }: { vendor: Vendor; pack: StoredPack; kind: string; label: string; onDone(): void }) {
  const [q, setQ] = useState(label);
  const hits = useMemo(() => (q.trim() ? searchIcons(pack, q) : []), [pack, q]);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  useEffect(() => {
    let live = true;
    void Promise.all(hits.filter((h) => !previews[h.file]).map(async (h) => [h.file, await iconSvg(vendor, h.file)] as const)).then((got) => {
      if (!live) return;
      const add = Object.fromEntries(got.filter(([, svg]) => svg).map(([f, svg]) => [f, dataUri(svg!)]));
      if (Object.keys(add).length) setPreviews((p) => ({ ...p, ...add }));
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hits, vendor]);
  return (
    <div className="icon-pick" onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), onDone())}>
      <label>
        {t('Icon for')} <strong>{label}</strong>:{' '}
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Words of its name, e.g. key vault')} aria-label={t('Search {vendor} icons', { vendor: vendors[vendor].name })} />
      </label>
      <div className="icon-grid" role="list">
        {hits.map((h) => (
          <button key={h.file} role="listitem" className={`icon-tile${pack.icons[kind] === h.file ? ' chosen' : ''}`} title={h.file} onClick={() => void mapKind(vendor, kind, h.file).then(onDone)}>
            {previews[h.file] ? <img src={previews[h.file]} alt="" width={32} height={32} /> : <span className="icon-empty" aria-hidden="true" />}
            <span>{h.name}</span>
          </button>
        ))}
        {!hits.length && <p className="menu-note">{t('Nothing in this set is called that.')}</p>}
      </div>
      {pack.icons[kind] && (
        <button className="button ghost" onClick={() => void unmapKind(vendor, kind).then(onDone)}>
          <Icon name="x" /> {t('No official icon for {label}', { label })}
        </button>
      )}
    </div>
  );
}
