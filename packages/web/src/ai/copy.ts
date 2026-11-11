// "Copy for your AI": the open diagram, its type's schema and short instructions as one text, for
// people who only have a chat window. They paste it in, ask for a change, and paste the YAML back
// (the start dialog's "Paste YAML", or straight into the editor).
import type { DiagramType } from '@cartography/core';

export function forYourAi(o: { yaml: string; type: DiagramType; file?: string; selection?: string[]; request?: string }): string {
  return `This is a Cartography diagram: a YAML file that is checked against a JSON Schema and laid out automatically, so it has no positions or sizes.

Rules:
- Follow the schema exactly; unknown keys are errors.
- Keep the ids that stay (they hold the places in the drawing and the hand-made pins); new ids are short, lowercase, kebab-case.
- Keep the comments and the order of what you do not change.
- Short labels; name lines with what flows (HTTPS, events, daily). Prefer the short line form "a -> b: label".
- Answer with the whole new file in one \`\`\`yaml code block, then one line saying what you changed.

Type "${o.type.id}" (${o.type.name}): ${o.type.description}
${o.selection?.length ? `\nSelected in the editor: ${o.selection.join(', ')} ("this" means these).\n` : ''}
The diagram${o.file ? ` (${o.file})` : ''}:
\`\`\`yaml
${o.yaml.trim()}
\`\`\`

The JSON Schema:
\`\`\`json
${JSON.stringify(o.type.schema)}
\`\`\`

${o.request?.trim() || 'What I want changed:'}
`;
}
