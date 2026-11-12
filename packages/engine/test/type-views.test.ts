import { describe, expect, it } from 'vitest';
import { render } from '../src/index.ts';

// Views a type draws itself, said in the drawing and in the result, whatever the type.
const sequence = (title = '') => `type: sequence
${title}participants:
  a: { label: Browser }
  b: { label: Orders API }
  c: { label: Payments }
messages:
  - divider: Order
  - a -> b: Place order
  - divider: Payment
  - b -> c: Charge card
`;

const mesh = (view: string) => `type: data-products
${view}domains:
  sales: Sales
  finance: Finance
products:
  orders: { domain: sales }
  revenue: { domain: finance, inputs: [orders] }
`;

describe("a type's own views", () => {
  it('give a drawing without a title the view as its title, and leave the default drawing as it is', async () => {
    const phase = await render(sequence(), { fonts: 'none', view: 'phase-payment' });
    expect(phase.graph?.title).toBe('Payment');
    expect(phase.graph?.subtitle).toBeUndefined();
    const whole = await render(sequence(), { fonts: 'none' });
    expect(whole.graph?.title).toBeUndefined();
    expect((await render(sequence(), { fonts: 'none', view: 'whole' })).graph?.title).toBeUndefined();
    // With a title the view is the subtitle, as before.
    const titled = await render(sequence('title: Checkout\n'), { fonts: 'none', view: 'phase-payment' });
    expect([titled.graph?.title, titled.graph?.subtitle]).toEqual(['Checkout', 'Payment']);
  });

  it('say which view the drawing as written is, a hidden one too', async () => {
    const whole = await render(sequence(), { fonts: 'none' });
    expect([whole.view, whole.asWritten, whole.scroll]).toEqual([undefined, { name: 'whole', title: 'Whole sequence' }, true]);
    const detailed = await render(mesh('view: detailed\n'), { fonts: 'none' });
    expect(detailed.asWritten?.name).toBe('detailed');
    expect(detailed.views?.map((v) => v.name)).not.toContain('detailed');
    expect((await render(mesh(''), { fonts: 'none' })).asWritten?.name).toBe('overview');
    // A type without views of its own, or a sequence in one phase, has none.
    expect((await render('type: systems\nnodes: { a: A }\n', { fonts: 'none' })).asWritten).toBeUndefined();
    expect((await render('type: sequence\nmessages:\n  - a -> b: hi\n', { fonts: 'none' })).asWritten).toBeUndefined();
  });
});
