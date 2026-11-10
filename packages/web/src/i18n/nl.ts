// The editor's Dutch, by English text (see ./index.ts). Short and plain, as a Dutch architect
// writes it: "je", no anglicisms where a common Dutch word exists, IT terms (API, deployment,
// subnet, YAML) as they are. Terms: docs/nederlands.md. One part per area of the editor, so work on
// one area does not touch the others' lines.
import { nlShell } from './nl-shell.ts';
import { nlApp } from './nl-app.ts';
import { nlDialogs } from './nl-dialogs.ts';
import { nlPanels } from './nl-panels.ts';

export const nl = { ...nlShell, ...nlApp, ...nlDialogs, ...nlPanels } as const satisfies Record<string, string>;
