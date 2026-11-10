// carto new --wizard <name>: the wizard's questions in the terminal (or its answers from a JSON file),
// the YAML to a file or standard output.
import fs from 'node:fs';
import readline from 'node:readline';
import { asked, coerce, resolve, wizards, findWizard, type Answers, type Question, type Wizard } from '@cartography/wizards';

const dim = (s: string) => (process.stderr.isTTY ? `\x1b[2m${s}\x1b[0m` : s);
const bold = (s: string) => (process.stderr.isTTY ? `\x1b[1m${s}\x1b[0m` : s);

export function listWizards(): string {
  const width = Math.max(...wizards.map((w) => w.id.length));
  return `Wizards (carto new --wizard <name> [file.yaml] [--answers answers.json] [-y]):\n${wizards.map((w) => `  ${w.id.padEnd(width)}  ${w.description}`).join('\n')}`;
}

/** What to type, and what Enter takes. */
function prompt(q: Question): string {
  const lines = [bold(q.label)];
  if (q.help) lines.push(dim(q.help));
  if (q.kind === 'choice' || q.kind === 'multi')
    q.options.forEach((o, i) => {
      const on = q.kind === 'choice' ? o.value === q.default : q.default.includes(o.value);
      lines.push(`  ${i + 1}. ${o.label}${on ? ' *' : ''}${o.help ? dim(` · ${o.help}`) : ''}`);
    });
  const def = q.kind === 'yesno' ? (q.default ? 'Y/n' : 'y/N') : q.kind === 'multi' ? `numbers, commas; Enter: ${q.default.length ? q.default.join(', ') : 'none'}` : q.kind === 'number' ? `${q.min}–${q.max}, Enter: ${q.default}` : q.kind === 'choice' ? 'number or name, Enter: *' : q.default ? `Enter: ${q.default}` : 'Enter: none';
  return `${lines.join('\n')}\n${dim(`(${def})`)} › `;
}

async function ask(w: Wizard, given: Answers): Promise<Answers> {
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  // Lines are read through the iterator, which keeps them while a question is on its way: piped answers are not lost.
  const lines = rl[Symbol.asyncIterator]();
  let ended = false;
  const read = async (text: string) => {
    process.stderr.write(text);
    if (ended) return '';
    const r = await lines.next();
    if (r.done) ended = true;
    return r.done ? '' : String(r.value);
  };
  const answers: Answers = { ...given };
  try {
    process.stderr.write(`${bold(w.name)}\n${dim(w.description)}\n${dim(`After: ${w.source}`)}\n\n`);
    for (;;) {
      // The questions asked depend on the answers so far: take the next one not yet answered.
      const q = asked(w, answers).find((x) => !(x.id in answers));
      if (!q) break;
      for (;;) {
        const line = (await read(prompt(q))).trim();
        if (!line) {
          answers[q.id] = q.default;
          break;
        }
        // In a text question "-" means none; elsewhere only what the question reads counts.
        if (q.kind === 'text' && line === '-') {
          answers[q.id] = '';
          break;
        }
        const v = coerce(q, line);
        if (v !== undefined && !(q.kind === 'multi' && Array.isArray(v) && !v.length)) {
          answers[q.id] = v;
          break;
        }
        if (ended) {
          answers[q.id] = q.default;
          break;
        }
        process.stderr.write(dim('  Not one of the choices; try again.\n'));
      }
      process.stderr.write('\n');
    }
  } finally {
    rl.close();
  }
  return answers;
}

export async function newFromWizard(name: string, target: string | undefined, opts: { answers?: string; yes?: boolean }): Promise<number> {
  const w = findWizard(name);
  if (!w) {
    console.error(`${name === 'list' ? '' : `No wizard "${name}". `}${listWizards()}`);
    return name === 'list' ? 0 : 1;
  }
  if (target && fs.existsSync(target)) {
    console.error(`${target} already exists`);
    return 1;
  }
  let given: Answers = {};
  if (opts.answers) {
    try {
      given = JSON.parse(fs.readFileSync(opts.answers, 'utf8')) as Answers;
    } catch (e) {
      console.error(`${opts.answers}: ${(e as Error).message}`);
      return 1;
    }
    const unknown = Object.keys(given).filter((k) => !w.questions.some((q) => q.id === k));
    if (unknown.length) console.error(dim(`Not a question of ${w.id}, ignored: ${unknown.join(', ')}. Questions: ${w.questions.map((q) => q.id).join(', ')}`));
  }
  // An answers file or -y: no questions. Otherwise ask what the file does not answer.
  const answers = opts.answers || opts.yes ? given : await ask(w, given);
  const yaml = w.build(resolve(w, answers));
  if (!target) return (process.stdout.write(yaml), 0);
  fs.writeFileSync(target, yaml);
  console.error(`Created ${target}`);
  return 0;
}
