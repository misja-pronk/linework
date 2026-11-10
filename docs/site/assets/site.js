// The site's few behaviours: light/dark, the section menu on small screens, search over a local
// index (no service, nothing leaves the page), the current heading in the table of contents, copy
// buttons on code. No dependencies.
(() => {
  const root = document.documentElement;
  const store = {
    get: () => {
      try {
        return localStorage.getItem('carto-site-theme');
      } catch {
        return null;
      }
    },
    set: (v) => {
      try {
        localStorage.setItem('carto-site-theme', v);
      } catch {}
    },
  };
  const dark = () => root.dataset.theme === 'dark' || (!root.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('.theme')?.addEventListener('click', () => {
    const next = dark() ? 'light' : 'dark';
    root.dataset.theme = next;
    store.set(next);
  });

  const menu = document.querySelector('.menu');
  menu?.addEventListener('click', () => {
    const open = document.body.classList.toggle('nav-open');
    menu.setAttribute('aria-expanded', String(open));
  });
  document.querySelector('.side')?.addEventListener('click', (e) => {
    if (e.target.closest('a')) document.body.classList.remove('nav-open');
  });
  // The current page in view in the section list, without scrolling the page itself.
  const side = document.querySelector('.side');
  const here = side?.querySelector('a[aria-current]');
  if (side && here) side.scrollTop = here.offsetTop - side.clientHeight / 2;

  // Opened from disk, the pages work but the editor (an ES module app) cannot load: say what to do.
  if (location.protocol === 'file:') {
    document.addEventListener('click', (e) => {
      const a = e.target.closest('a[href*="app/index.html"]');
      if (!a) return;
      e.preventDefault();
      alert('The editor needs to be served, not opened from disk. Run  pnpm docs:serve  and open the site from there.');
    });
  }

  // Copy buttons on code.
  for (const pre of document.querySelectorAll('pre.code')) {
    const b = document.createElement('button');
    b.className = 'copy';
    b.type = 'button';
    b.textContent = 'Copy';
    b.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(pre.querySelector('code').innerText.replace(/\n$/, ''));
        b.textContent = 'Copied';
      } catch {
        b.textContent = 'Select and copy';
      }
      setTimeout(() => (b.textContent = 'Copy'), 1400);
    });
    pre.append(b);
  }

  // The heading being read, marked in the table of contents.
  const toc = [...document.querySelectorAll('.toc a')];
  if (toc.length && 'IntersectionObserver' in window) {
    const byId = new Map(toc.map((a) => [decodeURIComponent(a.hash.slice(1)), a]));
    const seen = new Set();
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) (e.isIntersecting ? seen.add(e.target.id) : seen.delete(e.target.id));
      const first = [...byId.keys()].find((id) => seen.has(id));
      if (!first) return;
      for (const a of toc) a.classList.toggle('on', a === byId.get(first));
    }, { rootMargin: '-60px 0px -65% 0px' });
    for (const id of byId.keys()) {
      const h = document.getElementById(id);
      if (h) io.observe(h);
    }
  }

  // ---------------------------------------------------------------- search
  const dialog = document.querySelector('.search');
  const input = dialog?.querySelector('input');
  const list = dialog?.querySelector('.search-results');
  const base = document.body.dataset.root || '';
  const words = (s) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  let index;
  const load = () =>
    (index ??= (window.CARTO_SEARCH || []).map((d) => ({ ...d, hw: words(`${d.p} ${d.h}`), xl: d.x.toLowerCase() })));
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const mark = (s, terms) => {
    let out = esc(s);
    for (const t of terms) out = out.replace(new RegExp(`(${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'), '<mark>$1</mark>');
    return out;
  };
  const snippet = (text, terms) => {
    const l = text.toLowerCase();
    const at = Math.max(0, Math.min(...terms.map((t) => l.indexOf(t)).filter((i) => i >= 0), text.length) - 40);
    return (at ? '…' : '') + text.slice(at, at + 160);
  };
  let selected = 0;
  let shown = [];
  const run = () => {
    const terms = words(input.value);
    if (!terms.length) {
      list.innerHTML = '<li class="empty">Type to search pages, sections, types and examples.</li>';
      shown = [];
      return;
    }
    const scored = [];
    for (const d of load()) {
      let score = 0;
      let all = true;
      for (const t of terms) {
        const head = d.hw.some((w) => w === t) ? 10 : d.hw.some((w) => w.startsWith(t)) ? 6 : 0;
        const body = d.xl.includes(t) ? 1 + Math.min(3, d.xl.split(t).length - 1) * 0.5 : 0;
        if (!head && !body) all = false;
        score += head + body;
      }
      if (all) scored.push([score + (d.u.includes('#') ? 0 : 2), d]);
    }
    scored.sort((a, b) => b[0] - a[0]);
    shown = scored.slice(0, 30).map((s) => s[1]);
    selected = 0;
    list.innerHTML = shown.length
      ? shown.map((d, i) => `<li role="option" aria-selected="${i === 0}"><a href="${base}${d.u}"><span class="where">${esc(d.p)}</span><span class="what">${mark(d.h, terms)}</span><span class="text">${mark(snippet(d.x, terms), terms)}</span></a></li>`).join('')
      : '<li class="empty">Nothing found. Try fewer or other words.</li>';
  };
  const select = (i) => {
    const items = list.querySelectorAll('li[role=option]');
    if (!items.length) return;
    selected = (i + items.length) % items.length;
    items.forEach((li, j) => li.setAttribute('aria-selected', String(j === selected)));
    items[selected].scrollIntoView({ block: 'nearest' });
  };
  const open = () => {
    dialog.hidden = false;
    input.focus();
    input.select();
    run();
  };
  const close = () => (dialog.hidden = true);
  document.querySelector('.search-open')?.addEventListener('click', open);
  dialog?.addEventListener('click', (e) => {
    if (e.target === dialog) close();
    if (e.target.closest('a')) close();
  });
  input?.addEventListener('input', run);
  input?.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') (e.preventDefault(), select(selected + 1));
    else if (e.key === 'ArrowUp') (e.preventDefault(), select(selected - 1));
    else if (e.key === 'Enter' && shown[selected]) location.href = base + shown[selected].u;
  });
  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? '') || document.activeElement?.isContentEditable;
    if (e.key === 'Escape' && dialog && !dialog.hidden) close();
    else if (!typing && (e.key === '/' || ((e.metaKey || e.ctrlKey) && e.key === 'k'))) {
      e.preventDefault();
      open();
    }
  });
})();
