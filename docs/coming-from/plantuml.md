# Coming from PlantUML

PlantUML has drawn UML from text for a long time, and many architecture repositories carry `.puml` files: sequence diagrams, component diagrams, state machines and C4-PlantUML. Cartography covers the same ground for architecture work, with a different look and a layout of its own; it does not try to be UML.

## Bring your diagrams

```sh
carto import auth.puml           # → auth.yaml; a file with several @startuml blocks gives one file each
carto import docs/README.md      # every ```plantuml (or ```puml) block, and ```mermaid and ```d2
carto render auth.yaml -f svg
```

In the editor: drop a `.puml` or `.plantuml` file on the window, or paste PlantUML in the start dialog (*Import from Mermaid, D2, PlantUML…*). The importer is Cartography's own: no Java, no PlantUML server, `!include` is never fetched (a C4 include only says which C4 diagram it is).

| You have | Becomes |
| --- | --- |
| Sequence diagram | `type: sequence`: `participant`, `actor`, `database`, `queue`, `entity`, `boundary`, `control`, `collections` (with `as` aliases) as participants with a kind; `->` call, `-->` reply, `->>` async, `->x` lost, `<-` turned round, `[->` from outside; `++`/`--`, `activate`, `deactivate` and `return` as activations; `alt/else`, `opt`, `loop`, `par`, `break`, `critical`, `group` as frames; notes (one line or several), `ref over`, `== dividers ==`, `autonumber`, `box … end box` |
| Component and deployment diagram | `type: systems`: `component`, `[Name]`, `node`, `database`, `queue`, `storage`, `cloud`, `actor`, `interface` and `()` as nodes with a kind; `package`, `node`, `frame`, `folder`, `rectangle`, `cloud { … }` as groups; `-->`, `->`, `..>` (async), `--` and `<--` with labels; direction hints (`-up->`) and `[hidden]` lines dropped; `left to right direction` kept |
| C4-PlantUML | `type: c4`: the model (`Person`, `System`, `SystemDb`, `Container`, `ContainerDb`, `ContainerQueue`, `Component`, `_Ext` as external, `System_Boundary` as the system, `Container_Boundary` as the container, technology and description) with `Rel`, `Rel_*`, `Rel_Back`, `BiRel`, `RelIndex` as relations, and the one view the file draws: context (or a landscape with `Enterprise_Boundary`), container, component, dynamic (the numbered steps) or deployment (`Deployment_Node` and `Node`, with the containers inside them as instances). Add more views to the same model by hand: see [c4.md](../c4.md) |
| State diagram | `type: states`: `[*]`, composite states, `state "Long name" as x`, `<<choice>>`, notes, every arrow (`-->`, `->`, `-down->`) as a transition |
| Activity diagram (new syntax) | `type: process`: `start`, `stop`, `:action;` (over several lines too), `if/elseif/else/endif`, `while … endwhile`, `repeat … repeat while`, `switch/case`, `fork`/`split` as parallel gateways, `|Swimlanes|` as lanes, `-> label;` on the next line |
| Entity diagram (`entity X { … }`) | `type: erd`: columns with `<<PK>>`, `<<FK>>` and `<<UK>>`, crow's feet (`||--o{`) as relations and foreign keys |
| Class diagram | `type: class`: `class`, `abstract class`, `interface`, `enum` (its values), `record`, `class "Long name" as X`, `<<stereotypes>>`, generics, members (`- String name` or `- name : String`, `{static}`, `{abstract}`, separators dropped), `extends` and `implements`, `package` and `namespace` as packages, relations with multiplicities and labels (direction words and colours taken out) |
| Mind map (`@startmindmap`) | `type: mindmap`: `*` levels, `+` and `-` for the right and left side, `left side`, boxless `_` topics, `:multi-line;` topics; colours and icons left out |
| Use case, wbs, Gantt, old-style activity diagrams | Not imported: the report says so. For Gantt write a `roadmap` |

What is left out, each said in the report: `skinparam`, `!theme` and colours (the theme draws each kind its own way), stereotypes, legends, headers, footers and captions, preprocessor lines (`!define`, `!function`, `!if`), notes in component and activity diagrams, partitions, `destroy` and `create` marks, delays (drawn as dividers), history states, notes on transitions, C4 tags and styles (`AddElementTag`, `UpdateElementStyle`), `Lay_*` hints and generic boundaries (their contents are kept).

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

- **UML.** Use cases, object, timing and Gantt-in-PlantUML have no Cartography type.
- **What the importer leaves out** (above): layout hints, notes outside sequence and state diagrams, styling.
- **`skinparam`-level control** over every colour and font of every element.
- **The PlantUML ecosystem**: its server, the IDE plugins, Confluence and wiki macros that render `.puml` in place.

## What you gain

- **No Java, no server.** Cartography renders in Node or in the browser, offline, with the same result everywhere.
- **Layout that fits architecture**: groups that nest (a subnet in a network in a subscription), lines that route around boxes and share tracks, and a key. See the [layout benchmark](../benchmark.md) for how the layouts compare with Mermaid and D2 (PlantUML is not measured there, as it needs Java).
- **One model, many views**, drill-down links between diagrams, steps for presenting, PowerPoint export with one slide per step.
- **Infrastructure types** with real icons: Azure, AWS, Google Cloud, Kubernetes, networks with VLANs and IP plans, and importers from Terraform and cloud exports.
