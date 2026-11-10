// Writes the two made-up templates (fixtures/templates.ts) to a folder, for the e2e scripts and the docs:
//   tsx packages/export/test/support/write-templates.ts out-folder
import fs from 'node:fs';
import path from 'node:path';
import { corporateTemplate, dutchTemplate } from '../fixtures/templates.ts';

const out = process.argv[2];
if (!out) {
  console.error('write-templates <out-folder>');
  process.exit(2);
}
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'exemplar.potx'), corporateTemplate());
fs.writeFileSync(path.join(out, 'polder.pptx'), dutchTemplate());
console.log(`${out}/exemplar.potx, ${out}/polder.pptx`);
