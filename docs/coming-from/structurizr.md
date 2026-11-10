# Coming from Structurizr

Structurizr made "model once, draw many views" the way to do C4. Cartography works the same way and reads Structurizr DSL, so a workspace comes over in one command: the people, systems, containers and components, their relations, and the landscape, context, container, component, dynamic and deployment views.

## Bring your workspace

```sh
carto import workspace.dsl            # → workspace.yaml, one type: c4 file with its views
carto render workspace.yaml --all-views
```

What is read and what is not is listed in [c4.md](../c4.md#from-structurizr-dsl): styles, themes, properties, perspectives, filtered and custom views are left out (the C4 look is built in), and anything else skipped is reported.

## What maps to what

| Structurizr DSL | Cartography (`type: c4`) |
| --- | --- |
| `workspace "Name"` | `title: Name` |
| `u = person "Customer"` | `u: { kind: person, label: Customer }` under `elements:` |
| `s = softwareSystem "Shop" { … }` | `s: { kind: software-system, label: Shop, elements: { … } }` |
| `c = container "API" "…" "Java"` | `c: { kind: container, label: API, technology: Java }` inside `s` |
| `component "Ctrl"` | `kind: component` inside the container |
| `u -> c "Uses" "HTTPS"` | `relations: [ u -> s.c: { label: Uses, technology: HTTPS } ]` |
| `systemContext s key` | `views: { key: { kind: context, of: s } }` |
| `container s key`, `component s.c key` | `kind: container, of: s`, `kind: component, of: s.c` |
| `dynamic s key { a -> b "Does" }` | `kind: dynamic` with numbered `steps:` |
| `deploymentEnvironment` + `deployment` view | `kind: deployment` with `nodes:` and `instances:` |
| `autoLayout lr` | `direction: right`; layout is always automatic |
| `styles { … }` | not needed; a brand theme changes colours, font and logo |

## The same model, drawn

```cartography
type: c4
title: Internet banking
elements:
  customer: { kind: person, label: Customer, description: A customer of the bank }
  bank:
    kind: software-system
    label: Internet banking
    elements:
      web: { kind: container, label: Web app, technology: React }
      api: { kind: container, label: API, technology: Java }
      db: { kind: database, label: Database, technology: PostgreSQL }
  mainframe: { kind: software-system, label: Mainframe, external: true }
relations:
  - customer -> bank.web: Uses
  - bank.web -> bank.api: { label: Calls, technology: JSON/HTTPS }
  - bank.api -> bank.db: { label: Reads and writes, technology: JDBC }
  - bank.api -> mainframe: { label: Gets accounts, technology: XML/HTTPS }
views:
  containers: { kind: container, of: bank }
```

## What you lose

- **Structurizr's hosted features**: the cloud and on-premises workspace, the diagram review and documentation tabs, ADRs inside the workspace, and the people who share it there.
- **Styles, perspectives, filtered and custom views** from the DSL.
- **Manual layout in the Structurizr editor.** Cartography lays out by itself; drag in the editor to pin a position.
- **The Java DSL and other client libraries** that write workspaces from code. (Cartography's input is YAML, which any language can write.)

## What you gain

- **Plain files in your repository**, rendered offline by a CLI, in CI, in your docs site and in the browser. No server.
- **The same model in other diagrams**: an Azure, AWS or Kubernetes deployment drawn with real icons from the same elements, with `of:` and `env:` per environment ([model.md](../model.md)).
- **Threat overlays** on the same views ([threats.md](../threats.md)), steps for presenting, PowerPoint export, share links.
- **A look of its own** that reads as C4 (type and technology on each card, external systems greyed, dashed boundaries, a legend that fills itself) without a styles block.
