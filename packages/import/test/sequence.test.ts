import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { render } from '@cartography/engine';
import { importMermaid } from '../src/index.ts';

async function clean(yaml: string) {
  const r = await render(yaml, { fonts: 'none' });
  expect(r.diagnostics, yaml).toEqual([]);
  return r;
}

describe('sequenceDiagram', () => {
  it('imports participants, boxes, arrows, notes, frames and explicit activations', async () => {
    const { yaml, warnings } = importMermaid(`sequenceDiagram
    title Pay
    autonumber
    actor C as Customer
    box Aqua Shop system
      participant W as Web shop
      participant DB@{ "type": "database" }
    end
    participant S as Stripe
    C->>W: Pay
    W->>+S: Create intent
    S-->>-W: secret
    W-)S: confirm
    S-xW: timeout
    W->>W: Retry
    activate W
    Note right of W: waits
    Note over W,S: 3-D Secure
    alt paid
      S--)W: webhook
    else declined
      S->>W: failed
    else
      W->>DB: log
    end
    par to DB
      W->>DB: save
    and to Stripe
      W->>S: capture
    end
    rect rgb(240, 240, 255)
      critical lock
        W->>DB: SELECT FOR UPDATE
      option busy
        W->>W: wait
      end
    end
    deactivate W
`);
    const d = parse(yaml);
    expect(d).toMatchObject({ type: 'sequence', title: 'Pay', autonumber: true, activations: 'explicit', boxes: { 'shop-system': 'Shop system' } });
    expect(d.participants).toEqual({
      C: { kind: 'person', label: 'Customer' },
      W: { kind: 'client', label: 'Web shop', box: 'shop-system' },
      DB: { kind: 'database', box: 'shop-system' },
      S: { kind: 'payments', label: 'Stripe' },
    });
    expect(d.steps.slice(0, 9)).toEqual([
      { 'C -> W': 'Pay' },
      { 'W -> +S': 'Create intent' },
      { 'S --> -W': 'secret' },
      { 'W ->> S': 'confirm' },
      { 'S -x W': 'timeout' },
      { 'W -> W': 'Retry' },
      { activate: 'W' },
      { note: 'waits', right: 'W' },
      { note: '3-D Secure', over: ['W', 'S'] },
    ]);
    expect(d.steps[9]).toEqual({ alt: 'paid', steps: [{ 'S ->> W': 'webhook' }], else: { declined: [{ 'S -> W': 'failed' }], else: [{ 'W -> DB': 'log' }] } });
    expect(d.steps[10]).toEqual({ par: 'to DB', steps: [{ 'W -> DB': 'save' }], and: { 'to Stripe': [{ 'W -> S': 'capture' }] } });
    expect(d.steps[11]).toEqual({ group: null, steps: [{ critical: 'lock', steps: [{ 'W -> DB': 'SELECT FOR UPDATE' }], else: { busy: [{ 'W -> W': 'wait' }] } }] });
    expect(warnings).toEqual(['rect highlights become plain group frames (colours are not kept)']);
    await clean(yaml);
  });

  it('declares participants on first use and keeps our activations when the diagram sets none', async () => {
    const { yaml } = importMermaid('sequenceDiagram\n  Alice->>Bob: Hi\n  Bob-->>Alice: Hello\n  Alice->>Order DB: read\n');
    const d = parse(yaml);
    expect(d.activations).toBeUndefined();
    expect(Object.keys(d.participants)).toEqual(['Alice', 'Bob', 'Order-DB']);
    expect(d.participants['Order-DB']).toEqual({ kind: 'database', label: 'Order DB' });
    const r = await clean(yaml);
    expect(r.type!.id).toBe('sequence');
  });

  it('imports the comparison case cleanly', async () => {
    const file = path.resolve(import.meta.dirname, '../../../docs/comparison/src/payment-sequence.mmd');
    const { yaml, warnings } = importMermaid(fs.readFileSync(file, 'utf8'));
    expect(warnings).toEqual([]);
    await clean(yaml);
  });
});
