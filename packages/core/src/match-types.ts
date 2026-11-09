// "Describe what you want to show": ranks diagram types by the words typed, locally and without AI.
import type { DiagramType } from './diagram-type.ts';

const STOP = new Set('a an and the of to in on for with from by is are be our my we i want show draw how what which where that this it do does or as at all me'.split(' '));
const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w && !STOP.has(w));
/** Crude stemming, enough for plurals: "pods" finds "pod", "policies" finds "policy". */
const stem = (w: string) => (w.length > 4 && w.endsWith('ies') ? w.slice(0, -3) + 'y' : w.length > 3 && /[^su]s$/.test(w) ? w.slice(0, -1) : w);

/** Every type with a score, best first; types the query says nothing about score 0 and keep their order. */
export function matchTypes<T extends DiagramType>(query: string, types: readonly T[]): { type: T; score: number }[] {
  const q = words(query).map(stem);
  if (!q.length) return types.map((type) => ({ type, score: 0 }));
  const phrase = ` ${q.join(' ')} `;
  const scored = types.map((type, order) => {
    // Keywords and the name weigh most; the prose a little, so "network" still finds a type that only mentions networks.
    const strong = new Set([type.id, ...words(type.name), ...(type.keywords ?? []).flatMap(words)].map(stem));
    const weak = new Set([type.description, type.tagline ?? '', ...(type.useWhen ?? [])].flatMap(words).map(stem));
    const hit = (set: Set<string>, w: string) => set.has(w) || (w.length >= 4 && [...set].some((t) => t.startsWith(w)));
    let score = 0;
    for (const w of q) score += hit(strong, w) ? 3 : hit(weak, w) ? 1 : 0;
    // A keyword phrase typed as such ("who has access") counts extra.
    for (const k of type.keywords ?? []) if (k.includes(' ') && phrase.includes(` ${words(k).map(stem).join(' ')} `)) score += 4;
    return { type, score, order };
  });
  return scored.sort((a, b) => b.score - a.score || a.order - b.order).map(({ type, score }) => ({ type, score }));
}
