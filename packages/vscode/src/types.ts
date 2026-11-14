// The diagram types the engine knows, and how to pick one (the CLI's `linework types` and `linework new`).
import { matchTypes, type DiagramType } from '@linework/core';
import { types } from '@linework/engine';

let ids: string[] | undefined;
export const typeIds = (): string[] => (ids ??= types.map((t) => t.id));

export interface TypeChoice {
  id: string;
  label: string;
  description: string;
  /** When to pick it, and what it is not for: the guide's own lines. */
  detail: string;
  template: string;
}

const choice = (t: DiagramType): TypeChoice => {
  const name = (id: string) => types.find((x) => x.id === id)?.name ?? id;
  const when = (t.useWhen ?? []).join('; ');
  const not = (t.notFor ?? []).map((n) => `not for ${n.text}${n.use ? ` (use ${name(n.use)})` : ''}`).join('; ');
  return { id: t.id, label: t.name, description: t.tagline ?? t.description, detail: [when && `Use when: ${when}`, not].filter(Boolean).join(' · '), template: t.template };
};

/** Every type in the guide's order, or the best matches for some words first. */
export function typeChoices(query = ''): TypeChoice[] {
  const ranked = matchTypes(query, types);
  const shown = query && ranked[0]!.score > 0 ? ranked.filter((r) => r.score > 0) : ranked;
  return shown.map((r) => choice(r.type));
}
