# Coming from PlantUML

PlantUML has drawn UML from text for a long time, and many architecture repositories carry `.puml` files: sequence diagrams, component diagrams, state machines and C4-PlantUML. Cartography covers the same ground for architecture work, with a different look and a layout of its own; it does not try to be UML.

## Bring your diagrams

There is **no PlantUML importer yet**. What to do instead, per kind of diagram:

| You have | Do |
| --- | --- |
| C4-PlantUML (`Person`, `System`, `Container`, `Rel`) | Rewrite as `type: c4`; the mapping is one to one ([c4.md](../c4.md)). If you also have a Structurizr workspace, `carto import workspace.dsl` does it for you. |
| Sequence diagrams | Rewrite as `type: sequence`: participants, `->` messages, `-->` replies, `alt`, `loop` and `par` frames. |
| State diagrams | Rewrite as `type: states`. |
| Component and deployment diagrams | `type: systems`, or `azure`, `cloud`, `kubernetes` when the boxes are real infrastructure. |
| Activity diagrams | `type: process`, with lanes per role. |
| Class, object, use case, timing diagrams | Stay in PlantUML: Cartography has no UML class or use case types. |

An assistant connected to the [MCP server](../mcp.md) can do the rewriting: it reads the schema of each type and checks what it writes before you see it.

## What maps to what

| PlantUML | Cartography |
| --- | --- |
| `@startuml` … `@enduml` | one YAML file, `type:` first |
| `participant`, `actor`, `database` (sequence) | `participants:` with a `kind` |
| `A -> B : call` / `A --> B : reply` | messages in `type: sequence`: `- a -> b: call`, `- b --> a: reply` |
| `alt` / `else` / `loop` / `group` | frames in `type: sequence` |
| `component`, `node`, `database`, `queue` | nodes with `kind: service`, `database`, `queue`, … |
| `package`, `rectangle { … }`, `frame` | groups, with `in:` |
| `skinparam`, `!theme` | themes and brand themes |
| `left to right direction` | `direction: right` |
| `!include` | `include:` for model files ([model.md](../model.md)) |
| `[*] --> State` | `type: states`: start, end, composite states, guards |

## What you lose

- **UML.** Class diagrams, use cases, object, timing and Gantt-in-PlantUML have no Cartography type.
- **An importer**, for now: your `.puml` files are rewritten, not converted.
- **`skinparam`-level control** over every colour and font of every element.
- **The PlantUML ecosystem**: its server, the IDE plugins, Confluence and wiki macros that render `.puml` in place.

## What you gain

- **No Java, no server.** Cartography renders in Node or in the browser, offline, with the same result everywhere.
- **Layout that fits architecture**: groups that nest (a subnet in a network in a subscription), lines that route around boxes and share tracks, and a key. See the [layout benchmark](../benchmark.md) for how the layouts compare with Mermaid and D2 (PlantUML is not measured there, as it needs Java).
- **One model, many views**, drill-down links between diagrams, steps for presenting, PowerPoint export with one slide per step.
- **Infrastructure types** with real icons: Azure, AWS, Google Cloud, Kubernetes, networks with VLANs and IP plans, and importers from Terraform and cloud exports.
