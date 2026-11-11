# State machines

`type: states` draws the states one thing can be in and what moves it from one to the next: the lifecycle of an order, a pull request, a document, a connection. It follows UML's state machine where that helps a reader (initial and final pseudo-states, composite states, choice, history, `event [guard] / action`) and leaves out what a slide never needs.

It answers "which states are there, and how do you get from one to another". Who does what in which order is a [process](process.md); who calls whom is a sequence diagram.

```sh
carto new states order.yaml                    # a starter with a composite state
carto render order.yaml --format png           # svg, png, pdf, pptx
carto render order.yaml --all-steps --format pptx    # one slide per state on the way from start to end
```

## The YAML reads like the machine

```yaml
type: states
title: Order lifecycle

states:                             # only what the transitions cannot say themselves
  Awaiting payment: { entry: reserve stock }
  Fulfilment:                       # a composite state: its substates are nested in it
    states:
      Picking: { do: collect the items }
      Packed: { entry: print the label }
  Cancelled: { entry: release stock }

transitions:
  - start -> Awaiting payment: order placed
  - Awaiting payment -> Fulfilment: payment received
  - start -> Picking                # where Fulfilment begins
  - Picking -> Packed: all items scanned
  - Fulfilment -> Shipped: handed to carrier
  - Shipped -> Delivered: signed for
  - Delivered -> end
  - Awaiting payment -> Cancelled: 30 min without payment
  - Fulfilment -> Cancelled: customer cancels     # from any of its substates
  - Cancelled -> end
```

The names are the states. A state that appears only in `transitions:` (`Shipped`, `Delivered`) needs no entry under `states:`. A state has one name in the whole diagram, however deep it is nested, so a transition names it without a path.

### Transitions

A transition is `from -> to`, and after the colon what moves it: `event [guard] / action`. Each part is optional.

| Written | Means |
| --- | --- |
| `Open -> Closed` | goes over by itself, when the work in `Open` is done |
| `Open -> Closed: close` | on the event `close` |
| `Open -> Closed: close [nobody in the way]` | on the event, if the guard holds |
| `Open -> Closed: close / click` | on the event, doing `click` on the way |
| `Enough? -> Paid: [amount covers it]` | a guard alone |
| `Enough? -> Open: "[too little] / ask for the rest"` | a guard with something after it: in quotes |
| `Idle -> Idle: heartbeat` | a transition to itself, drawn as a small loop on the state |
| `Draft -> In review -> Approved` | a chain; a label after the colon goes on the first arrow |

The quotes in the sixth row are YAML's doing: text that starts with `[ ]` and goes on after it is not valid YAML without them. The editor adds them for you, and the diagnostic says so in those words if you forget. The quotes go around what stands after the colon, not around the whole item.

### Start and end

`start` and `end` are the initial pseudo-state (a filled dot) and the final one (a dot in a ring). They are written in transitions only and belong to the level of the state at the other end of the arrow: `start -> Awaiting payment` is the start of the machine, `start -> Picking` the start inside `Fulfilment`, because that is where `Picking` lives. The same goes for `Packed -> end` inside a composite state.

### Composite states

A state with `states:` in it is a composite state: a frame with its substates inside. A transition to the composite enters at its inner `start`; a transition from the composite leaves from whichever substate it is in. Composite states nest as deep as you write them.

A transition from outside straight to a substate is drawn, and remarked on: say where the composite begins with `start -> <substate>` instead, so the frame means something.

### Kinds

`kind:` on a state, or the kind as the whole entry (`In stock?: choice`).

| Kind | Drawn as |
| --- | --- |
| `state` (default) | a rounded box; with `entry`, `do` or `exit` it gets a second compartment |
| `choice` | a small diamond with the question under it; a name that ends in `?` is a choice by itself |
| `final` | a dot in a ring with its name: an end that deserves one ("Refunded") |
| `history` | an H in a ring, inside a composite state: go back to the substate it was in |

A state can also have:

- `entry`, `do`, `exit`: what it does on the way in, while it is there and on the way out. One thing or a list: `entry: [book the payment, send the receipt]`.
- `note`: a remark beside it, tied to the state by a dotted line.
- `label` (what it says, when the name in the transitions should stay short), `tone`, `description` (tooltip), `tags`, `links`.

### Direction

`direction: down` runs the machine top to bottom. Left to right is the default.

## What it tells you

Problems come with a line and column, in the editor and from `carto validate`:

- an item that is no transition; a state written twice; `start` or `end` used as the name of a state; a kind that is none; `start -> end` (errors)
- no start; a state that is in no transition, or that the machine cannot reach from its start
- a composite state that is entered as a whole while nothing says where it begins
- a choice with one way out, or with ways out that have no guard
- a transition that leaves an end, leads to a start or leaves a final state
- a history state outside a composite state; a composite state with a transition to itself
- two spellings of one state (`In review` and `in review`)
- quotes around a whole transition, which make the label part of the state's name

## Layout

A state machine uses the general layout, the one architecture diagrams use: ranks follow the transitions from the start, composite states are frames around their substates, lines are routed around boxes and their labels kept off the lines. The same file gives the same picture.

Dragging a state in the editor pins it. The pin is kept beside the YAML in `<name>.layout.json`, the YAML itself does not change, and the rest is laid out around what you placed.

## In the editor

The palette has the four kinds; `A` adds one by name from the keyboard. Drag from a state's handle to another state for a transition. Renaming a state renames it in every transition, also when only the transitions name it. A transition is picked from its state's connections and has one field, its label, written as `event [guard] / action`. Deleting a state cuts it out of its chains and takes the transitions that were only about it.

`P` presents: without `steps:` the presenter walks from the start along the first way out of every state, one state at a time, with the event that led there as its caption. With `steps:` you tell it your way, see [steps.md](steps.md); the name of a composite state selects everything in it, `tag:name` everything with that tag:

```yaml
steps:
  - An order from payment to delivery.
  - Awaiting payment -> Fulfilment: Paid orders go to the warehouse.
  - title: In the warehouse
    focus: [Fulfilment]
```

## Export

SVG, PNG and PDF are the drawing. PowerPoint gets native shapes: every state, pseudo-state and frame is a shape you can move and restyle, every transition a connector, every label a text box. An embed (`carto embed`) carries a text description under the drawing: every state with the composite it is in, and every transition as "from, to, label".

## From Mermaid

A Mermaid `stateDiagram` (or `stateDiagram-v2`) maps onto states like this. Give your own AI the file and this table ([ai.md](ai.md)).

| Mermaid | States |
| --- | --- |
| `s1 --> s2: label` | `s1 -> s2: label` |
| `[*]` | `start` or `end`, by the side of the arrow it stands on |
| `state "Long name" as s1`, `s1: Long name` | the long name is the name of the state |
| `state Name { … }` | a composite state with its substates nested |
| `state c <<choice>>` | `choice` |
| `note right of s1 … end note`, `note left of s1: text` | `note` on the state |
| `direction TB` | `direction: down` |

What has no counterpart:

- `<<fork>>` and `<<join>>`: there are no fork and join bars; plain states with their lines do.
- Concurrent regions (`--` inside a composite state): one region.
- `classDef`, `class` and `style`: the theme decides the look.
- `direction RL` and `BT`: drawn left to right and top to bottom.

A Mermaid state diagram that names no direction is drawn top to bottom by Mermaid and left to right here: that is what a slide wants. `direction: down` draws it top to bottom.

## Examples

[examples/states](../examples/states): the lifecycle of an order (a composite state), of a pull request, the approval of a document (a choice and a note), and the connection of a field device (a composite state, self-transitions and a retry with a limit).

## What it does not do

- Fork and join bars, and concurrent regions: one thing is in one state at a time here.
- Entry and exit points on a composite state's frame, deep history, submachine references.
- Transitions grouped by trigger, or a state table as export.
- A machine with many transitions between the same few states gets crowded: the layout routes every line separately and does not bundle them. The device connection example is where it shows.
