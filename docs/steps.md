# Steps: one drawing, told in parts

A diagram that is shown to people is rarely shown all at once. `steps:` tells the story of a drawing in the order you say it: what is there, what stands out, which route the request takes, and the sentence that goes with it. The same block drives the presenter in the editor, `--step` on the command line and one slide or page per step in PowerPoint and PDF.

The layout is made once, for the whole drawing. A step never moves anything: what is not shown yet leaves its place empty, so slide 2 lines up with slide 5.

```yaml
type: systems
nodes:
  customer: { kind: user, label: Customer }
  web: { kind: client, label: Web shop }
  api: { kind: service, label: Orders }
  db: { kind: database, label: Orders DB }
  psp: { kind: external, label: Payment provider, tags: [outside] }
edges:
  - customer -> web
  - web -> api
  - api -> db
  - api -> psp

steps:
  - The shop as it is today.
  - customer -> web -> api: The order comes in.
  - title: Payment
    caption: The API asks the payment provider and waits for the answer.
    focus: [api, psp]
    note: { psp: PCI scope ends here }
```

Examples: [systems/invoice-walkthrough.yaml](../examples/systems/invoice-walkthrough.yaml) (a proposal told in seven steps, building up), [azure/web-shop.yaml](../examples/azure/web-shop.yaml) (a request through an Azure landing zone), [data-products/customer.yaml](../examples/data-products/customer.yaml) (lineage from source to consumer) and the `payment` view of [c4/kestrel-bank.yaml](../examples/c4/kestrel-bank.yaml), a dynamic view that steps through its numbered lines by itself.

## A step

| Written as | Means |
| --- | --- |
| `- The shop as it is today.` | A caption only: the whole drawing at full strength |
| `- customer -> web -> api` | A route: its lines and what they connect stand out, the rest stands back |
| `- customer -> web: The order comes in.` | A route with its caption |
| `- { title: …, caption: …, show: …, focus: …, path: …, hide: …, note: … }` | The long form, any of the keys |

| Key | What it does |
| --- | --- |
| `title` | Short name of the step: on its chip in the editor, in bold above the caption |
| `caption` | The sentence you say, under the drawing and in the speaker notes |
| `focus` (or `highlight`) | These at full strength, everything else quiet |
| `path` | A route `a -> b -> c`: its lines are drawn heavier with a soft band behind them, their ends in focus |
| `show` | Revealed from this step on |
| `hide` | Gone from this step on. Hiding a line (`a -> b`) keeps its two ends |
| `note` | A callout on an element or a line, for this step only: `note: { api: Scales to zero }` |

`focus`, `path`, `show` and `hide` take one selector or a list.

A step's `focus` dims what is around. To leave the rest out of the drawing altogether, a diagram or a view has a `focus:` of its own: see [the focus view](data-products.md#the-focus-view).

## Selectors

| Selector | Picks |
| --- | --- |
| `api` | The element with that id |
| `shop` or `shop.*` | A group: everything inside it |
| `tag:outside` | Everything with that tag |
| `kind:database` | Everything of that kind |
| `*` | Everything |
| `web -> api` | The line between the two (either direction), and in `focus`, `path` and `show` also its ends |
| `web -> api -> db` | A route: each line along it. `shop -> tag:outside` works too |

## What is there, and what is not

- **No `show` in any step**: everything is there from the first step. Steps only move the attention.
- **A `show` in any step**: the drawing builds up. Everything starts absent, each `show` adds to what earlier steps showed, and what a step puts in `focus` or on a `path` is there from then on as well. To start from part of the drawing, give the first step a `show` (the walkthrough example tags what exists today and starts with `show: tag:today`).
- Something inside a group brings its group along. A line is drawn once both its ends are there.
- `hide` stays in force for the steps after it, until a later `show` brings the element back.

In a step with a focus, what is not in focus is drawn quiet rather than faded: flat, without its shadow, in a grey that still reads on a projector and in the dark theme. A route does not rely on colour: its lines are heavier and have a band behind them. A group that holds something in focus stays as it is.

## Steps in views

A view has its own steps, inside the view:

```yaml
views:
  inside:
    title: Inside the shop
    steps:
      - web -> api: The web shop calls the API.
      - api -> db: The API stores the order.
```

Steps at the top of a file belong to the drawing as written; a file that only has views says so when it finds steps there.

Two kinds of drawing step by themselves, with nothing extra written: a **sequence diagram** goes message by message, and a **C4 dynamic view** goes line by line in its numbered order. They take no presentation steps of their own (a sequence lists its messages under `messages:`; its old name `steps:` is still read, with a warning); the label of a message or line is its caption.

## Problems

A selector that names nothing is reported on its own line and column, like any other problem in the file:

- `Nothing drawn here is called "apii"`: an id, group, tag or kind that is not in this drawing (or not in this view).
- `"web ->" misses an end`: a route with an empty end.
- `There is no line between "web" and "db"`: a warning; the step is drawn without that part of the route.

## In the editor

A diagram with steps gets a strip of chips under the drawing: **All**, then one per step. The strip writes YAML, and every action is one undo.

| Key | Does |
| --- | --- |
| `S` | Add a step from the selection: what is selected is its `focus`. Type a name, `↵` |
| `[` / `]` | Previous / next step in the drawing |
| `←` / `→`, `Home` / `End` | On a chip: walk the steps |
| `F2` | On a chip: name the step |
| `⌥←` / `⌥→` | On a chip: move the step earlier / later |
| `⌫` | On a chip: remove the step |
| `P` or `⌘↩` | Present |

Autocomplete knows `steps:` and its keys in every diagram type and inside views. `?` lists all of this.

## Presenting

**Present** (toolbar, `P`, `⌘↩` from the YAML editor, or the command palette) shows the drawing full screen with the caption under it and a small `3 / 7`.

| Key | Does |
| --- | --- |
| `→` `↓` `Space` `PageDown` `↵` | Next |
| `←` `↑` `⇧Space` `PageUp` | Previous |
| `Home` / `End` | First / last |
| `3` `↵` | Jump to a number |
| `B` or `.` | Blank the screen; any key brings it back |
| `Tab`, then `↵` — or `⌘`-click | Follow a link on an element to its view |
| `⌫` | Back to where the link was followed |
| `F` | Full screen on / off |
| `Esc` | Stop |

A file with views is presented view by view, in the order written, and step by step inside a view that has steps. Steps fade into each other (not with *reduce motion* on), and the pointer hides when it has been still for a moment. A clicker works: it sends `PageDown` and `PageUp`.

## Command line and export

```sh
carto render shop.yaml --step 3              # → shop-step-03.svg, the drawing at step 3
carto render shop.yaml --all-steps -f png    # → shop-step-01.png, shop-step-02.png, …
carto render shop.yaml --view inside --all-steps
carto render shop.yaml -o shop.pptx          # one slide per step
carto render shop.yaml -o shop.pdf           # one page per step
carto deck *.yaml -o deck.pptx               # every diagram; one slide per step where there are steps
```

| Format | With steps |
| --- | --- |
| SVG, PNG | One drawing: where the steps end, or one step with `--step n`. `--all-steps` writes a numbered file per step. The caption and `3 / 7` are part of the picture |
| PowerPoint | One slide per step. Shapes are native and stand in the same place on every slide, so the slides build up cleanly and stay editable. Title and caption are text on the slide and in the speaker notes; the steps of one drawing fade into each other |
| PDF | One page per step, all the same size |

- Without `--step` (and in the editor and the docs gallery) the drawing is where the story ends: what a step showed and a later one hid (`hide:`) is not drawn, so today's lines and the proposal's are never shown at once; the rest is at full strength, without a caption. In the editor what was hidden stays, quiet, so it can still be picked and edited.
- `--no-steps` gives one slide or page for the drawing, also where the steps end.
- `--all-steps` with PowerPoint or PDF also steps through sequence diagrams and dynamic views, which otherwise stay one slide.
- In the editor, SVG and PNG export the step on screen; PowerPoint and PDF get every step.

From code, `render(text, { step: 3 })` returns that step; the result lists `steps` (title, caption and what each one shows), the `step` drawn, and `stepsImplied` when nobody wrote them. `stepCaption: false` leaves the caption block out of the picture.
