---
name: cartography
description: Create, check and render architecture diagrams with Cartography (diagrams as YAML, laid out automatically). Use when the user asks for an architecture, Azure, system, database/ERD, access/RBAC/Entra, GitHub organisation or data-product (data mesh) diagram, wants a Mermaid diagram turned into a better-looking one, or edits a Cartography .yaml file (it starts with `type:`).
---

# Cartography diagrams

A diagram is one YAML file. Cartography validates it against the type's JSON Schema, places
everything itself and draws SVG or PNG. You never write positions, sizes or colours per element.

Use the **MCP tools** when the `cartography` server is connected (`list_types`, `get_schema`,
`new_diagram`, `validate`, `render`, `import_mermaid`). Otherwise use the CLI (bottom of this file).

## 1. Pick the type

| type | Use for | Main keys |
|---|---|---|
| `systems` | Any software architecture: users, apps, services, queues, databases, external systems; also simple process flows (step, decision, start, end). The default. | `groups`, `nodes`, `edges`, `badges` |
| `azure` | Azure resources in subscriptions, resource groups, VNets and subnets | `groups`, `nodes`, `edges`, `badges` |
| `erd` | Database tables, columns and foreign keys | `tables`, `schemas`, `relations` |
| `access` | Who gets which role on what, through groups and Entra access packages | `principals`, `packages`, `resources`, `roles`, `assignments`, `view` |
| `github` | Organisations, teams, repositories, environments, workflows, runners | `groups`, `nodes`, `edges`, `badges` |
| `data-products` | Data mesh: domains, sources, products with input/output ports, contracts, consumers | `domains`, `sources`, `products`, `consumers`, `contracts`, `view` |

Cloud-neutral or AWS/GCP → `systems` (group kinds `cloud`, `region`, `cluster`, `zone`).
When unsure, call `list_types`. Then **always** call `get_schema(type)` before writing: it returns the
schema, the template and a fuller example. Kinds, styles and fields differ per type.

## 2. YAML rules (all types)

- First line `type: <id>`; optional `title:`, `subtitle:`, `direction: right | down` (default right).
- Unknown keys are errors. Kinds and edge styles must be exactly the values the schema lists.
- Ids are map keys: letters, digits, `-`, `_` (`orders-api`). People read `label:`, not ids.
- Short entry form when only the kind matters: `customers: users`. Long form:
  `web: { kind: client, label: Storefront, caption: Next.js, in: shop }`.
  `in:` names a group id; groups nest the same way.
- Edges are a list, in any of these forms:
  ```yaml
  edges:
    - web -> api                         # arrow; also --> dashed, ..> dotted, <-> both, -- no arrow
    - api -> db: SQL                     # with a label
    - api -> bus: { label: OrderPlaced, style: async }
    - { from: api, to: db, label: SQL }
  ```
  Edge object fields: `label`, `style` (type-specific), `line: solid|dashed|dotted`, `both: true`,
  `badge: true` (graph types). ERD and access have their own forms; see below and the schema.
- Edge ends must be existing node or group ids (ERD: `table` or `table.column`).

Graph types (`systems`, `azure`, `github`) also allow `icon:` and `tone:` (blue, sky, indigo, violet,
teal, green, amber, orange, rose, slate) on an entry; leave them out unless asked, kinds set both.

**systems** edge styles: `sync` (request), `async` (message), `data` (data flow), `dotted` (supporting).
Node kinds include user, users, client, mobile, service, api, function, worker, job, queue, topic,
database, cache, storage, warehouse, search, gateway, load-balancer, cdn, identity, secrets,
monitoring, email, ai, payments, external, step, decision, start, end. Group kinds: group, system,
boundary, zone, team, domain, cluster, cloud, region, on-premises.

**azure** edge styles: `public`, `private`, `data`, `identity`, `management`. Group kinds include
tenant, management-group, subscription, resource-group, region, vnet, subnet, aks-cluster.

**erd**: columns are `name: <type> [pk] [fk table[.column]] [unique] [null] [default …]`, e.g.
`customer_id: uuid fk customers`. Relations come from `fk`; add `relations:` only for extra ones
(`- order_lines.product_id -> products.id: { cardinality: many-to-one }`). To group tables, define
`schemas: { sales: { label: sales } }` and set `schema: sales` on each table.

**access**: `assignments` are sentences: `- sg-dev is contributor on rg-shop`. `view: graph | access |
packages | roles` picks the drawing (graph, who × where matrix, packages matrix, roles × permissions).

**data-products**: products have `class: source-aligned | aggregate | consumer-aligned`, `domain:`,
`inputs: [source, product, product.port]` and `outputs:` (ports, optionally with `contract:`).
`view: overview | detailed`; `detail: [id]` shows only some products in detail. A contract may point
to an ODCS file with `file:` (relative to the diagram). A folder of ODPS and ODCS files is drawn as
one map with `carto render <folder>`, or made into a diagram with `carto import <folder>`.

**Focus** (every type of boxes and lines): `focus: orders`, or `focus: { on: [orders, tag:pii],
hops: 2 | all, direction: both | upstream | downstream }`, at the top or inside a view, draws only
that and what is within so many lines of it. Use it for lineage and impact questions in a big diagram.

## 3. The loop: validate → fix → render

1. Start from `new_diagram(type)` or the example in `get_schema`, rewrite it for the user's content.
2. `validate` with `yaml` (the text) or `file` (a path). Every problem has `line`, `column`,
   `message` and usually a `hint` (often "did you mean …"). Fix **all** errors, then validate again.
3. When valid, read `quality`: `verdict` (clean / good / needs work), `crossings`,
   `linesThroughBoxes`, `labelOverlaps`, `bends`, `voids`, `aspect`, `score` (lower is better, only
   comparable between versions of the same diagram) and `suggestions`. Apply suggestions that fit the
   story, validate again, and keep the version with the lower score. Stop at "clean" or "good";
   don't loop more than about three times on layout alone.
4. `render` with `path` to write a file (`docs/architecture.svg`, `.png`; relative to the working
   directory) and `theme: light | dark`. PNG comes back as an image: look at it before you report.

Never hand-edit the SVG and never add coordinates; change the YAML instead. Positions the user
dragged in the editor live in `<name>.layout.json` next to the file; leave that file alone.

## 4. Style: what makes it look good

- **5–20 shapes.** Leave out what doesn't serve the story; split a big landscape into two diagrams.
- **Groups carry structure**: system, zone, subscription, team, domain. Nest only when it means
  something (subscription → resource group → subnet). Every group should hold 2+ things.
- **Short labels**: the product or service name (`Orders API`, `Postgres`). Put the technology in
  `caption:` (`caption: RDS`). Line labels are one or two words: what flows (`HTTPS`, `OrderPlaced`,
  `CDC`, `daily`). Don't label a line with what its style already says.
- **Styles tell traffic apart**: requests vs messages vs data. Use the type's styles, not `line:`.
- **Badges for cross-cutting links**: Key Vault, logging, identity, monitoring are used by everyone
  and drag lines across the whole drawing. Give those edges a style and list it at the top level
  (`badges: [identity]` in azure, e.g. `badges: [dotted]` in systems), or set `badge: true` on single
  edges: they become a chip on the source card instead of a line.
- **Direction**: write edges in flow order (caller → callee, source → consumer). `right` suits
  pipelines and request flows, `down` suits layered or tall landscapes. Validate measures the other
  direction and says when it is clearly better; trust that over intuition.
- **Ids stay stable** across edits, so the user's manual positions keep applying.

## 5. From Mermaid

`import_mermaid(text)` converts flowchart/graph, architecture-beta and erDiagram into `systems` or
`erd` YAML and lists what it dropped. Validate the result, then improve it: real kinds instead of
generic ones, groups, styles, badges.

## 6. Without MCP: the CLI

From the Cartography repo (`pnpm install` once). Elsewhere run `pnpm -C <repo> carto …` and pass
absolute file paths, since paths then resolve from the repo:

```sh
pnpm carto types                               # list types
pnpm carto new systems diagram.yaml            # template to a file (stdout without a file)
pnpm carto validate diagram.yaml               # file:line:col  error  message; exit 1 on errors
pnpm carto render diagram.yaml -f png -t dark  # → diagram.png (svg default; -o out path or dir)
pnpm carto import flow.mmd -o flow.yaml        # Mermaid (or .md with mermaid blocks) → YAML
pnpm carto render diagram.yaml --focus api --hops 2   # only api and what is within two lines of it
pnpm carto render mesh/ -o mesh.png            # a folder of ODPS/ODCS files as one data mesh map
```

The CLI has no layout-quality report: render a PNG and look at it instead. Schemas are in
`types/<type>/src/index.ts` (`schema:`), examples in `examples/<type>/`.
