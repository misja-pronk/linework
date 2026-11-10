// The editor's Dutch, by English text (see ./index.ts). Short and plain, as a Dutch architect
// writes it: "je", no anglicisms where a common Dutch word exists, IT terms (API, deployment,
// subnet, YAML) as they are. Terms: docs/nederlands.md.
export const nl = {
  Language: 'Taal',
  English: 'English',
  Nederlands: 'Nederlands',
  'Same as the browser': 'Zoals de browser',
} as const satisfies Record<string, string>;
