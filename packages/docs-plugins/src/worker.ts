// The other half of sync.ts: draws what it is sent and wakes the thread that waits for it.
import { parentPort, type MessagePort } from 'node:worker_threads';
import { build, type Job } from './core.ts';

parentPort?.on('message', async ({ job, done, port }: { job: Job; done: Int32Array; port: MessagePort }) => {
  try {
    port.postMessage({ built: await build(job) });
  } catch (e) {
    port.postMessage({ error: e instanceof Error ? e.message : String(e) });
  }
  Atomics.store(done, 0, 1);
  Atomics.notify(done, 0);
});
