# Describe: a diagram in words

Every diagram has a plain-language description, made from its model (no AI, nothing leaves your machine): what it
shows, its groups and what they hold, each element with its kind and description, the connections in reading
order, the steps as a numbered walkthrough, layers, trust boundaries, the decisions about it and what the key means. It is
written so a reader grasps the architecture in half a minute, and so a screen reader can say what a picture shows.

```text
Web shop

Architecture diagram: How an order flows through the system. 8 elements in 2 groups, with 7 connections.

Groups and elements
- Users
- Web shop (System)
  - Storefront (Web app)
  - API gateway
  - Private network (Zone)
    - Orders (Service)
    - Orders DB (Database)
…
Connections
- Users connect to Storefront over HTTPS.
- Storefront calls API gateway (REST).
- API gateway calls Orders.
- Orders sends data to Orders DB (SQL), sends OrderPlaced to order-events and calls Stripe (charge).
- order-events sends messages to Mailer.

Key
- Solid line with beads: Connection
- Dashed violet line: Async message
…
```

## Where it is

| Where | What |
| --- | --- |
| Every SVG that leaves the editor (`carto render`, Export → SVG) | `<title>` and `<desc>` right after the root, which says `role="img"`, `aria-labelledby` (the title) and `aria-describedby` (the description). A step's SVG says which step in its title. |
| PNG (`carto render -o x.png`, Export → PNG, Copy as PNG) | `Title` and `Description` text chunks (iTXt, UTF-8). Image viewers and asset tools show them; a web page still needs its own `alt`. |
| PDF (`carto render -o x.pdf`, `carto deck`, Export → PDF) | A tagged PDF: each drawing is a `Figure` with the description as its alternate text, frame and footer marked as artifacts, language set. A page per step says that step. |
| PowerPoint (`.pptx`) | The drawing is one group on the slide whose alt text (`descr`) is the description; each shape keeps its own. A slide per step says that step. |
| The editor | **Export → Describe in words…** or ⌘K *Describe in words*: the description of what is on screen (its view, step and focus), with **Copy text** (`T`), **Copy Markdown** (`M`) and **Copy for Confluence / Notion** (`C`, below). |
| Interactive HTML (`carto export-html`) | Each drawing is described to a screen reader by its description. |
| `carto describe` | On the command line, below. |

## Copy for Confluence / Notion

**Export → Copy for Confluence / Notion**, or `C` in the Describe dialog, puts the drawing on screen (its view, step
and focus) on the clipboard as rich HTML: a heading, the picture as a PNG inside it (2×, shown at its own size) with
alt text, and the description. Paste into a Confluence page, Notion, Google Docs or Word and you get the picture and
the words in one go; anything that takes only text gets the description as plain text. Made in the browser; nothing
is uploaded.

## carto describe

```sh
carto describe shop.yaml                     # plain text on standard output
carto describe shop.yaml -o shop.md          # Markdown (-o x.html: HTML; --format text|md|html says it outright)
carto describe model.yaml --view containers  # one view
carto describe teams.yaml --all-views        # the drawing as written and each view after it
```

It exits 1 when the diagram has errors and writes nothing then.

## What each kind of diagram says

Most diagrams are told as groups and elements, then connections. Each line from an element is one clause, in the
order a reader follows the drawing (from where the lines start, along them): *calls* for requests, *sends … to* for
messages, *sends data to* for data flows, *over HTTPS* for a protocol, and the label in brackets otherwise. Two
elements with one name are told apart by their kind (*web (Service)*, *web (Deployment)*).

| Type | Told as |
| --- | --- |
| Sequence | the participants (in their boxes), then the **message flow** in order: *4. Orders API calls Orders DB: INSERT order*, replies and async messages as such, `alt`/`loop`/`par` frames as nested lists, dividers and notes where they are |
| Database design | each **table** with its columns, types and keys (*customer_id (uuid, foreign key to customers.id)*), then the **relations** with cardinality in words: *each orders row has exactly one customers row; each customers row has zero or many orders rows* |
| Class diagram | classes with members and visibility; *Book extends Item*, *Item is made of Copy (1..\*)* |
| Matrix, RACI, CRUD, access | **row by row**, with what the tags mean: *Business case: Sponsor: A (Accountable); Programme manager: R (Responsible) …*; a plain table's continuation rows under their row |
| Journey | the persona, then **phase by phase** each step with how it feels, what is thought or said, touchpoints, pains, what works and ideas; where it feels worst and best; the metrics |
| Roadmap | **lane by lane**, items in date order with their dates, status, progress and what they wait for; milestones, phases and today |
| Org chart | **who reports to whom** as a tree, dotted lines, open roles |
| Team topology | the teams with their type, and the interactions between them |
| Capability map | areas and capabilities as a tree, with heatmap values and supporting systems |
| Mind map | the topics as a tree around the centre |
| Git branching | the branches, then the history oldest first (branches off, merges, tags, deployments); a delivery view as its pipelines |
| Process, states | lanes and steps, the main path in order, then what leads where (*Awaiting payment moves to Fulfilment on payment received*) |
| Context map | each relation with its ends: *Catalogue (upstream, open host service) and Ordering (downstream): Customer/Supplier* |

After that, for every type: the **walkthrough** (written steps, with their notes) or a dynamic view's numbered
**steps**; **layers** with their tags; **trust boundaries**; the architecture
**decisions** about the drawing (CLI and exports from a folder with [decisions](decisions.md)); and the **key**, each
sample in words (*Dashed violet line: Async message*, *Shade 4 of 4 (strongest): €600k–€800k*).

## Writing diagrams that read well

The description is only as good as the names in the diagram. Labels that say what a thing is (*Orders API*, not
*svc-2*), line labels that say what goes over them (*REST*, *OrderPlaced*), a `subtitle:` that says what the
drawing is about and `description:` on the elements that need a sentence all end up in it. Every example's
description is checked in `packages/engine/test/__snapshots__/describe/`.
