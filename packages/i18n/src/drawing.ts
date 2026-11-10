// The words a drawing and its exports add themselves (the KEY, "Step 3 of 7", a review's headings),
// in the diagram's `lang:`. Kind names and key labels that types write are in ./terms.ts.
import { translator, type Lang } from './index.ts';
import { terms } from './terms.ts';
import { nl } from './drawing-nl.ts';

export { terms };
export type DrawingMessage = keyof typeof nl;

/** A drawing's own word in its language: tr(theme.lang, 'KEY'). */
export const tr = translator(nl);

const SEGMENTS = /( · |: |, )/;

/**
 * Text a type made (a caption, a key label) in the drawing's language: as a whole when the terms
 * have it, else part by part ("Source · Database", "Maturity: 1 Initial", "[Container: React]").
 * Parts the terms do not know (a size, a version, a product name) stay as written.
 */
export function term(lang: Lang | undefined, text: string): string {
  if (lang !== 'nl' || !text) return text;
  const whole = terms[text];
  if (whole) return whole;
  const bracket = /^\[(.+)\]$/.exec(text);
  if (bracket) return `[${term(lang, bracket[1]!)}]`;
  if (!SEGMENTS.test(text)) return text;
  return text
    .split(SEGMENTS)
    .map((part) => terms[part] ?? part)
    .join('');
}
