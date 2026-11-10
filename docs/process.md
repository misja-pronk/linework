# Processes and flowcharts

`type: process` draws who does what, in which order, and where it branches: an approval, an incident runbook, order to cash, a release with a manual gate. It has BPMN's everyday shapes (tasks, events, gateways, lanes, message flow) without its ceremony, and it is also the type for a plain decision flowchart: leave the lanes out.

It is not a BPMN modeller. There are no pools, boundary events, data stores or compensation, nothing is executable, and there is no BPMN XML in or out. What you get is a process a steering group can read, laid out for you.

```sh
carto new process access.yaml                  # a starter with lanes and a decision
carto render access.yaml --format png          # svg, png, pdf, pptx
carto render access.yaml --all-steps --format pptx   # one slide per step of the happy path
carto import flow.mmd                          # a Mermaid flowchart with decisions lands as a process
```

## The YAML reads like the process

```yaml
type: process
title: Access request

lanes:                              # who does it; optional
  employee: Employee
  manager: Line manager
  it: IT service desk

nodes:                              # only what the flow cannot say itself
  Request access: { in: employee, kind: user }
  Check request: { in: manager, kind: user }
  Grant access: { in: it, kind: service }
  Confirm access: employee          # short for { in: employee }
  Explain why: manager
  Request rejected: end             # short for { kind: end }

flow:
  - start -> Request access -> Check request -> Approved? -yes-> Grant access -> Confirm access -> end
  - Approved? -no-> Explain why -> Request rejected
```

The names are the steps. A step that appears only in `flow:` is a task and needs no entry under `nodes:`. Three names mean something by themselves:

- `start` and `end` are the start and end events.
- A name that ends in `?` is a decision (an exclusive gateway). Its question is written over the diamond, its answers on the ways out.

**The first item of `flow:` is the happy path.** It is drawn in one straight line where it stays in a lane, a little heavier than the rest, and named in the key. It is also what a presentation walks when you write no `steps:`. A decision tree has no main route: `happy: false` draws every line the same.

### Arrows

| Written | Means |
| --- | --- |
| `a -> b` | sequence flow: `b` comes after `a` |
| `a -yes-> b` | the same, with a label at the start of the line |
| `a --> b` | message flow (dashed): `a` tells `b`, the work is not handed on |
| `a --by mail--> b` | a message with a label |
| `a -> b: label` | a label after the colon; in a chain it goes on the first arrow |
| `a -> b: { label: none left, default: true }` | the default way out of a gateway, marked with a slash |

A chain may be as long as the process: `a -> b -> c -> d`. A line that leads back to an earlier step is a loop and is drawn around the outside.

### Lanes

`lanes:` lists the roles or systems, top to bottom in the order written: `id: Label`, or `id: { label, tone, description, links }`. A step says where it stands with `in:`; a step without `in:` stands in the lane of the step before it, so a run of steps by one role needs the lane only once. Lanes do not nest.

Without `lanes:` the same file is a flowchart.

### Kinds

`kind:` on a step, or the kind as the whole entry (`Wait for stock: timer`).

| Kind | Drawn as |
| --- | --- |
| `task` (default) | a rounded box |
| `user`, `service`, `manual`, `script` | a task with a person, cog, hand or script mark |
| `subprocess` | a task with a `+` at its foot: it has a process of its own |
| `decision` (also `xor`) | a diamond: one way out is taken |
| `parallel` (also `and`) | a diamond with `+`: every way out is taken, or every way in is waited for |
| `inclusive` (also `or`) | a diamond with a ring: one or more ways out |
| `event-based` | a diamond with a pentagon in a double ring: whichever event comes first |
| `start`, `end` | a thin circle, a heavy circle |
| `timer`, `message`, `error`, `signal` | a circle with a clock, envelope, bolt or radio mark; a double ring when it stands in the middle of the flow |
| `document` | a page with a wavy foot |
| `note` | a remark with a bracket, tied to its step by a dotted line |

A kind is never told by colour alone: every kind has its own shape or mark, so the drawing reads in grey and on a projector.

A step can also have `label` (what it says, when the name in the flow should stay short; `label: ""` leaves a gateway bare), `caption` (a second, lighter line), `icon`, `tone`, `description` (tooltip), `tags` and `links`.

A note or a document is tied to its step with a line in the flow: `Laptop policy -> Order laptop`. It stands beside the step and does not count as a step of the process.

### Direction

`direction: down` runs the process top to bottom, with the lanes as columns. Left to right is the default and what a slide wants.

## What it tells you

Problems come with a line and column, in the editor and from `carto validate`:

- a flow item that is not a chain; a lane that does not exist; a name used for both a lane and a step (errors)
- a step under `nodes:` that is in no flow, or one nothing leads to
- a decision with one way out, or with ways out that have no label
- a flow that goes on after an end, a process that never ends, a branch that stops half way while others reach an end
- two spellings of one step (`Check request` and `check request`)

## Layout

A process has its own layout: columns follow the flow, rows follow the lanes, and nothing is placed by hand. Dragging a step in the editor does not pin it (there is no `.layout.json` for a process); change the order in the YAML and the drawing follows. The same file always gives the same picture, and adding a step at the end of a branch leaves the rest where it was.

- The happy path keeps one row per lane and runs straight.
- A branch leaves its gateway by the point that faces it: down to a lower lane, up to a higher one. The first branch in the same lane stands under the main line, the next over it.
- Lines never run through a step. Where two lines cross, one is drawn with a gap; where they join, a small ring marks it.
- A label on a line sits where the line leaves its gateway. A label longer than its line stands beside it.

## In the editor

The palette has every kind; `A` adds one by name from the keyboard. Drag from a step's handle to another step to connect them: the line is added to `flow:` as an item of its own. Renaming a step renames it in every line of the flow. A line is picked from its step's connections and has one field, its label: a short one (`yes`) is written in the arrow, a longer one after the colon. Whether a line is a message or the default way out is written in the YAML. Deleting a step cuts it out of its chains, so `a -> b -> c` without `b` reads `a -> c`; an item that was only `a -> b` goes whole.

`P` presents: without `steps:` the presenter walks the happy path one step at a time. With `steps:` you tell it your way, see [steps.md](steps.md); a lane id selects everything in the lane, a name selects a step, `tag:name` everything with that tag:

```yaml
steps:
  - The request as it runs today.
  - start -> Request access -> Check request: It starts with the employee.
  - title: What IT does
    focus: [it]
```

## Export

SVG, PNG and PDF are the drawing. PowerPoint gets native shapes: every task, event, gateway and lane is a shape you can move and restyle, every line a connector, every label a text box. An embed (`carto embed`) carries a text description under the drawing for screen readers and search: every lane and step with the lane it stands in, and every line as “from, to, label”.

## From Mermaid

`carto import flow.mmd` (and Import in the editor) reads a Mermaid `flowchart` or `graph`. It becomes a process when it decides something: at least one `{diamond}` or question, and decisions, starts and ends together are two or more and at least a quarter of the nodes. Otherwise it stays an architecture diagram (`systems`), as does a flowchart where a line ends on a subgraph: a lane is not something a flow can point at.

| Mermaid | Process |
| --- | --- |
| `{…}`, a `{{…}}` that names nothing else, any shape whose text ends in `?` | decision |
| `([…])`, `((…))` at the start or the end of the flow | start, end |
| `[[…]]` | subprocess |
| `[(…)]` | document |
| `-.->` | message |
| `subgraph` | lane; a subgraph inside a subgraph is not kept, its steps stand in the outer lane |
| `-->\|label\|`, `-- label -->` | the label on the line |

`flowchart TD` is not kept: an imported process runs left to right. Add `direction: down` to have it top to bottom again. A diamond with one way in and one way out decides nothing and comes in as a task.

## Examples

[examples/process](../examples/process): an access request with approval, incident handling, order to cash, a release with a manual gate, onboarding with work in parallel, and a build-buy-reuse decision tree without lanes.

## What it does not do

- Pools (two organisations side by side, each with lanes), boundary events on a task, data stores, compensation, multi-instance markers.
- BPMN XML import or export. The export was weighed and left out: a file that bpmn.io opens needs the drawing's coordinates in BPMN DI as well as the flow, and half of that is worse than none.
- Expanded subprocesses: a subprocess is a box with a `+`; link it to its own diagram with `links:`.
- Manual placement. If the layout puts a branch where you do not want it, the order of the items in `flow:` is the lever: the first item is the main line, the first branch stands nearest to it.
