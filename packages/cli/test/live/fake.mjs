// A stand-in for kubectl, az or gh in tests: records how it was called, answers from a routes file.
// Never reaches a cluster, a tenant or GitHub. FAKE_DIR holds routes.json and gets calls.jsonl.
import fs from 'node:fs';
import path from 'node:path';

const dir = process.env.FAKE_DIR;
const argv = process.argv.slice(2);
fs.appendFileSync(path.join(dir, 'calls.jsonl'), JSON.stringify(argv) + '\n');
const routes = JSON.parse(fs.readFileSync(path.join(dir, 'routes.json'), 'utf8'));
const hit = routes.find((r) => JSON.stringify(r.argv) === JSON.stringify(argv));
const answer = hit ?? (argv[0] === 'gh' ? { stdout: '{"message":"Not Found","status":"404"}', stderr: 'gh: Not Found (HTTP 404)', code: 1 } : { stderr: `fake ${argv[0]}: no answer for ${argv.join(' ')}`, code: 1 });
// Written synchronously: process.exit would cut a pipe short.
if (answer.file) fs.writeSync(1, fs.readFileSync(answer.file));
if (answer.stdout) fs.writeSync(1, answer.stdout);
if (answer.stderr) fs.writeSync(2, answer.stderr + '\n');
if (answer.sleep) await new Promise((r) => setTimeout(r, answer.sleep));
process.exit(answer.code ?? 0);
