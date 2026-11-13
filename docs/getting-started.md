# Get started

Cartography turns a short YAML file into an architecture diagram: you say what is there and how it connects, and it lays the drawing out, routes the lines and draws it in one consistent style. There is an editor in the browser and a command line; both read and write the same files.

## Install

Cartography is not on npm yet. Run it from a clone of the repository:

```sh
mise install            # Node 24 and pnpm, or bring your own
pnpm install
pnpm web                # the editor → http://localhost:5178
pnpm carto --help       # the command line
```

`pnpm web:build` builds the editor into `packages/web/dist`: plain files that run from any folder, offline. Nothing you draw leaves your machine.

## Your first diagram

Start from a type's template, or write the file yourself:

```sh
pnpm carto types                          # which type for what
pnpm carto new systems shop.yaml          # start from the template
pnpm carto render shop.yaml -f png        # → shop.png
pnpm carto watch shop.yaml                # draw again on every save
```

A diagram is a type, a title, the things in it and the lines between them. This is a whole file:

```yaml
type: systems
title: Web shop
groups:
  shop: { kind: system, label: Web shop }
nodes:
  customer: { kind: user, label: Customer }
  web: { kind: client, label: Storefront, in: shop }
  api: { kind: service, label: Orders API, in: shop }
  db: { kind: database, label: Orders DB, in: shop }
  stripe: { kind: payments, label: Stripe }
edges:
  - customer -> web: HTTPS
  - web -> api: { label: REST, style: sync }
  - api -> db: { label: SQL, style: data }
  - api -> stripe: { label: charge, style: sync }
```

- `kind` says what a thing is. It brings the icon, the shape and the entry in the key. In the editor, autocomplete lists the kinds each type knows.
- `in:` puts a thing in a group; groups nest the same way.
- An edge is `from -> to`, with a label, or a map with a label and a `style` (`sync`, `async`, `data`, …), each with its own dash in the key.
- A line without a style (`a --> b` dashed, `a ..> b` dotted) is named in the key by how it looks, "Connection (dotted)", unless `key:` says what it means: `key: { dotted: Configuration }`.

## Pick the right type

The type decides what can go in a diagram and how it is laid out: Azure, AWS and Google Cloud, Kubernetes, a network, a database, a sequence, a process in lanes, a state machine, a roadmap, a journey, a capability map, an org chart, a matrix, and more. [Which type do I need?](types.md) has a table; the [gallery](../examples/) shows every template and example drawn (on the docs site; on GitHub the link opens the examples themselves).

## Where to next

- Already have diagrams in Mermaid, D2, draw.io, PlantUML, Structurizr or Terraform? Your own AI converts them: [from other tools](ai.md#from-other-tools).
- Draw the same systems in several diagrams: [one model, many diagrams](model.md).
- Check diagrams and show what changed in pull requests: [ci.md](ci.md).
- Make it look like your client: [brand themes](themes.md).
