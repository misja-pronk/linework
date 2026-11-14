// The live drawing is made in a worker (render-worker.ts): laying out a big drawing (the whole of a
// working canvas) can take a minute, and the page goes on answering meanwhile. A drawing nobody waits
// for any more is stopped there; where a worker cannot run (tests, a page opened from disk) the
// drawing is made here, as before.
import { findType, render, type RenderOptions, type RenderResult } from '@cartography/engine';
import type { Lang } from '@cartography/i18n';

/** Where a loader reads: the folder's (or the examples') files and the diagram's place among them. */
export interface FileSource {
  base: string[];
  /** The files as they are now (a folder's change while it is open). */
  files(): ReadonlyMap<string, string>;
  /** What to say for a file that is not there, with {file} in it. */
  missing: string;
}

/** Reads a file relative to the diagram; one that says where it reads can be read in the worker too. */
export type Loader = ((file: string) => string) & { source?: FileSource };

/** A loader over files: `base` is the diagram's folder, as path segments; `get` finds a path's text. */
export function loaderOver(base: string[], get: (path: string) => string | undefined, missing = 'No file {file}'): Loader {
  return (file) => {
    const parts = [...base];
    for (const seg of file.split('/')) {
      if (seg === '..') parts.pop();
      else if (seg && seg !== '.') parts.push(seg);
    }
    const text = get(parts.join('/'));
    if (text == null) throw new Error(missing.replace('{file}', file));
    return text;
  };
}

/** A loader that says where it reads, so that the worker can read the same files. */
export function sourcedLoader(base: string[], get: (path: string) => string | undefined, files: () => ReadonlyMap<string, string>, missing: string): Loader {
  const load = loaderOver(base, get, missing);
  load.source = { base, files, missing };
  return load;
}

/** The same texts under the same paths (the strings of files that did not change are the same ones). */
const sameFiles = (a: ReadonlyMap<string, string>, b: ReadonlyMap<string, string>) => a === b || (a.size === b.size && [...a].every(([k, v]) => b.get(k) === v));

/** What the page asks the worker: everything but the loader, which goes as its files. */
export interface Ask {
  id: number;
  text: string;
  opts: Omit<RenderOptions, 'load'>;
  /** The loader's files: `entries` only when they are not the ones sent last. */
  files?: { key: number; base: string[]; missing: string; entries?: [string, string][] };
}

/** What comes back: the result without its type (by id) and with its views' titles in each language. */
export type Answer = { id: number; result: Omit<RenderResult, 'type' | 'viewTitles'>; type?: string; titles?: Record<Lang, Record<string, string>> } | { id: number; error: string };

/** A drawing on its way. */
export interface Drawing {
  result: Promise<RenderResult>;
  /**
   * Not wanted any more: dropped. One that has been laying out a while in the worker is stopped there
   * (the worker starts again for the next); `now` stops it however short it has run.
   */
  cancel(now?: boolean): void;
}

/** Said by a drawing that was cancelled. */
export class Cancelled extends Error {
  constructor() {
    super('cancelled');
    this.name = 'Cancelled';
  }
}

/** A drawing that has run this long is stopped when nobody waits for it, rather than finished. */
const STOP_AFTER_MS = 1000;

interface Job {
  id: number;
  text: string;
  opts: RenderOptions;
  resolve(r: RenderResult): void;
  reject(e: unknown): void;
  sent?: number;
  dropped?: boolean;
}

let worker: Worker | undefined;
/** No worker here (tests, Node), or it would not start: drawings are made on the page. */
let here = typeof Worker === 'undefined';
let ids = 0;
const queue: Job[] = [];
let running: Job | undefined;
/** The files the worker has, by the map they came from. */
let sentFiles: { map: ReadonlyMap<string, string>; key: number } | undefined;
/** The worker has drawn something: an error from it after that is the drawing's, not its loading. */
let answered = false;

function start(): Worker | undefined {
  if (worker || here) return worker;
  try {
    worker = new Worker(new URL('./render-worker.ts', import.meta.url), { type: 'module' });
  } catch {
    here = true;
    return undefined;
  }
  worker.onmessage = (e: MessageEvent<Answer>) => {
    answered = true;
    const job = running;
    if (!job || job.id !== e.data.id) return;
    running = undefined;
    const a = e.data;
    if (job.dropped) job.reject(new Cancelled());
    else if ('error' in a) job.reject(new Error(a.error));
    else {
      const titles = a.titles;
      const type = a.type ? findType(a.type) : undefined;
      job.resolve({ ...a.result, ...(type ? { type } : {}), ...(titles ? { viewTitles: (l: Lang) => titles[l] ?? {} } : {}) } as RenderResult);
    }
    pump();
  };
  // The worker would not load (a page opened from disk, a strict policy): draw here from now on.
  // Once it has drawn, an error is the drawing's: that one fails, and the worker starts again.
  worker.onerror = (e) => {
    e.preventDefault();
    stopWorker();
    const job = running;
    running = undefined;
    if (!answered) {
      here = true;
      if (job) queue.unshift(job);
    } else job?.reject(new Error(e.message || 'The drawing failed'));
    pump();
  };
  return worker;
}

function stopWorker() {
  worker?.terminate();
  worker = undefined;
  sentFiles = undefined;
}

function pump() {
  if (running) return;
  const job = queue.shift();
  if (!job) return;
  const w = start();
  if (!w) {
    render(job.text, job.opts).then(job.resolve, job.reject);
    return pump();
  }
  const { load, ...opts } = job.opts as RenderOptions & { load?: Loader };
  const source = load?.source;
  let files: Ask['files'];
  if (source) {
    const map = source.files();
    const fresh = !sentFiles || !sameFiles(sentFiles.map, map);
    if (fresh) sentFiles = { map, key: ++ids };
    files = { key: sentFiles!.key, base: source.base, missing: source.missing, ...(fresh ? { entries: [...map] } : {}) };
  }
  // A loader that does not say where it reads cannot go to the worker: this one is drawn here.
  if (load && !source) {
    render(job.text, job.opts).then(job.resolve, job.reject);
    return pump();
  }
  const ask: Ask = { id: job.id, text: job.text, opts, ...(files ? { files } : {}) };
  try {
    w.postMessage(ask);
  } catch {
    // Something in the options does not cross to the worker: drawn here.
    if (files?.entries) sentFiles = undefined;
    render(job.text, job.opts).then(job.resolve, job.reject);
    return pump();
  }
  job.sent = performance.now();
  running = job;
}

/** Draws as render() does, in the worker where there is one. */
export function draw(text: string, opts: RenderOptions): Drawing {
  let job!: Job;
  const result = new Promise<RenderResult>((resolve, reject) => {
    job = { id: ++ids, text, opts, resolve, reject };
  });
  queue.push(job);
  pump();
  return {
    result,
    cancel(now = false) {
      const i = queue.indexOf(job);
      if (i >= 0) {
        queue.splice(i, 1);
        return job.reject(new Cancelled());
      }
      if (running !== job) return;
      if (now || (job.sent !== undefined && performance.now() - job.sent > STOP_AFTER_MS)) {
        stopWorker();
        running = undefined;
        job.reject(new Cancelled());
        pump();
      } else job.dropped = true;
    },
  };
}
