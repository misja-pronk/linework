// markdown-it renders synchronously; drawing a diagram is not (Graphviz loads as wasm). A worker
// draws, and this thread sleeps until the worker says it is done.
import { MessageChannel, receiveMessageOnPort, Worker } from 'node:worker_threads';
import type { Built, Job } from './core.ts';

let worker: Worker | undefined;

function start(): Worker {
  // From source (tests, tsx) the worker is TypeScript and needs tsx too; built, it is plain JavaScript next to this file.
  const source = import.meta.url.endsWith('.ts');
  const w = new Worker(
    new URL(source ? './worker.ts' : './worker.js', import.meta.url),
    source && !process.execArgv.some((a) => a.includes('tsx')) ? { execArgv: ['--import', 'tsx'] } : {},
  );
  // Nothing keeps the build alive for the worker's sake.
  w.unref();
  return w;
}

export function buildSync(job: Job, timeoutMs = 120_000): Built {
  worker ??= start();
  const done = new Int32Array(new SharedArrayBuffer(4));
  const { port1, port2 } = new MessageChannel();
  worker.postMessage({ job, done, port: port2 }, [port2]);
  const waited = Atomics.wait(done, 0, 0, timeoutMs);
  const answer = receiveMessageOnPort(port1)?.message as { built?: Built; error?: string } | undefined;
  port1.close();
  if (waited === 'timed-out' || !answer) {
    void worker.terminate();
    worker = undefined;
    throw new Error('Drawing the diagram took too long or the drawing worker could not start');
  }
  if (!answer.built) throw new Error(answer.error ?? 'The diagram could not be drawn');
  return answer.built;
}
