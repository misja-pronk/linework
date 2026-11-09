// Entry point of the action: `tsx packages/action/src/main.ts`, with the inputs as INPUT_* variables.
import { run } from './run.ts';

try {
  const r = await run(process.env);
  process.exitCode = r.ok ? 0 : 1;
} catch (e) {
  console.log(`::error::${(e as Error).message.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')}`);
  process.exitCode = 1;
}
