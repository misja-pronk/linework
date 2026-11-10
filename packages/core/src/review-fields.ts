// What the architecture review (packages/review) reads from a diagram besides what is drawn: a few
// properties of a resource that a reviewer asks about, and where a finding was looked at and set
// aside. Only the schema lives here, so every type takes the same words; the rules are in the review
// package.
//
//   nodes:
//     db: { kind: sql-database, public: false, zones: 3, sku: Business Critical }
//     aks: { kind: aks, props: { network-policy: calico, private-cluster: true } }
//     web: { kind: app-service, review: { ignore: [{ rule: azure.public-without-waf, reason: Internal tool behind the VPN }] } }
//   review:                                 # the whole file
//     packs: [azure]
//     rules: { azure.no-diagnostics: off }
//     ignore: [{ rule: arch.deep-sync-chain, on: checkout, reason: Accepted for the pilot }]

const ignoreItem = (on: boolean) => ({
  anyOf: [
    { type: 'string', description: 'A rule id, e.g. azure.public-without-waf' },
    {
      type: 'object',
      required: ['rule'],
      properties: {
        rule: { type: 'string', description: 'The rule id' },
        ...(on ? { on: { type: 'string', description: 'The element (an id) or line ("a -> b") it is about; left out: the whole file' } } : {}),
        reason: { type: 'string', description: 'Why it is set aside: printed in the review report' },
      },
      additionalProperties: false,
    },
  ],
});

const severity = { enum: ['off', 'info', 'warn', 'error'] };

/** `review:` on an element or a line: findings set aside here, with a reason. */
export const reviewEntrySchema = {
  type: 'object',
  properties: { ignore: { type: 'array', items: ignoreItem(false), description: 'Rules set aside for this one: [rule-id] or { rule, reason }' } },
  additionalProperties: false,
  description: 'Architecture review (carto review): findings set aside here',
};

/** `review:` at the top of a file. */
export const reviewSchema = {
  anyOf: [
    { const: 'off', description: 'No architecture review for this file' },
    {
      type: 'object',
      properties: {
        packs: { type: 'array', items: { type: 'string' }, description: 'Only these rule packs: azure, aws, kubernetes, systems, github, data-products' },
        rules: { type: 'object', additionalProperties: severity, description: 'Per rule: off, info, warn or error' },
        ignore: { type: 'array', items: ignoreItem(true), description: 'Findings set aside: a rule id for the whole file, or { rule, on, reason }' },
      },
      additionalProperties: false,
    },
  ],
  description: 'Architecture review (carto review, the Review tab): packs, severities and findings set aside',
};

/** Properties of a node or group of a node-and-edge diagram that the review rules read. */
export const reviewFields = {
  public: { type: 'boolean', description: 'Reachable from the internet (public network access); false: only privately' },
  zones: { anyOf: [{ type: 'integer', minimum: 1 }, { type: 'array', items: { type: ['string', 'integer'] } }, { const: 'redundant' }], description: 'Availability zones it runs in: 3, [1, 2, 3] or redundant' },
  sku: { type: 'string', description: 'Tier or SKU, e.g. WAF_v2 or Premium' },
  props: { type: 'object', additionalProperties: { type: ['string', 'number', 'boolean'] }, description: 'Other settings worth checking, e.g. { network-policy: calico, multi-az: true }' },
  review: reviewEntrySchema,
};
