// Turns the answers into a prompt any capable model can follow: the type's schema, a worked
// example, the answers, and the house rules that make the result look good once laid out.
import type { DiagramType } from '@cartography/core';
import type { Question } from './questions.ts';

export type Answers = Record<string, string | string[]>;

export interface Prompt {
  system: string;
  user: string;
}

const SYSTEM = `You write diagrams for Cartography, a diagrams-as-code tool. A diagram is one YAML file that is validated against a JSON Schema and laid out automatically, so you never write positions or sizes.

Rules for a diagram people will want to show:
- Valid YAML only, following the schema exactly. Unknown keys are errors.
- Ids are short, lowercase, kebab-case and stable (orders-api, not OrdersAPI1). Labels are what people read: short, Title case or the product's own name.
- Use groups (containers, domains, zones…) to show structure; nest only when it means something.
- Name lines with what flows (HTTPS, events, CDC, daily) and keep those labels to one or two words. Use the line styles the schema offers to tell kinds of traffic apart.
- Fewer, meaningful shapes beat many: leave out what does not help the story. Respect the requested level of detail.
- Prefer the short line form "a -> b: label" where the schema allows it.
- Answer with the YAML in a single \`\`\`yaml code block and nothing else.`;

/** Answers as readable lines, skipping empty ones. */
function answerLines(questions: Question[], answers: Answers): string {
  return questions
    .map((q) => {
      const a = answers[q.id];
      const v = Array.isArray(a) ? a.join(', ') : (a ?? '').trim();
      return v ? `- ${q.label} ${v}` : '';
    })
    .filter(Boolean)
    .join('\n');
}

export function buildPrompt(type: DiagramType, questions: Question[], answers: Answers, example?: string, draft?: string): Prompt {
  const user = `Make a "${type.name}" diagram (type: ${type.id}). ${type.description}

What the diagram should show:
${answerLines(questions, answers) || '- (no answers given: make a small, typical example)'}

The JSON Schema the YAML must follow:
\`\`\`json
${JSON.stringify(type.schema)}
\`\`\`

A good example of this type, for style and structure (do not copy its content):
\`\`\`yaml
${(example ?? type.template).trim()}
\`\`\`${
    draft
      ? `

Start from this draft, made from the user's answers to a wizard. Keep what it has (ids, comments, steps) and change or add what the answers above ask for:
\`\`\`yaml
${draft.trim()}
\`\`\``
      : ''
  }`;
  return { system: SYSTEM, user };
}

/** The prompt as one text to paste into any chat assistant. */
export const promptText = (p: Prompt) => `${p.system}\n\n${p.user}`;

/** The YAML in an answer: the fenced block when there is one, else the whole text. */
export function extractYaml(answer: string): string {
  const fenced = /```(?:ya?ml)?\s*\n([\s\S]*?)```/.exec(answer) ?? /```(?:ya?ml)?\s*\n([\s\S]*)$/.exec(answer);
  return `${(fenced ? fenced[1]! : answer).trim()}\n`;
}
