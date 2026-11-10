# Data products, contracts and lineage

A data mesh is usually already written down: a file per data product ([ODPS](#what-is-read-from-a-data-product-odps)) and a file per data contract ([ODCS](#what-is-read-from-a-data-contract-odcs)), in a repository. Cartography reads that folder and draws the map: the products per domain, their ports, which product reads which, and the contracts behind the ports. No catalogue, no server, nothing leaves your machine.

```sh
carto render examples/data-products/mesh -o mesh.svg
```

![The mesh map of the example folder](data-products/mesh.png)

The folder is [examples/data-products/mesh](../examples/data-products/mesh): six products (Bitol ODPS v1) and four contracts (ODCS 3.1) of a fictional web shop. Nothing in it was written for Cartography.

## A folder becomes a map

```sh
carto render mesh/ -o mesh.svg                 # the picture, nothing else is written
carto render mesh/ -o mesh.png --write mesh.yaml   # and keep the diagram it was drawn from
carto import mesh/                             # only the diagram: mesh.yaml beside the folder
carto import products/*.yaml contracts/*.yaml  # loose files: data-mesh.yaml
carto import mesh/ -o -                        # to the terminal
```

Files are recognised by what is in them, not by their name: `.yaml`, `.yml` and `.json`, in the folder and the folders under it. Anything else in the folder is passed over. A file that cannot be read is reported with its name, the rest is still drawn, and the command exits with 1.

What the map shows:

- **A product per ODPS file**, in the domain it names. A contract no product has a port for becomes a product of its own (or joins the product it names in `dataProduct`), so a folder of contracts alone draws too.
- **Lineage** from the ports. An input port names a contract; the product whose output port has that contract is what it reads. An input nobody in the folder offers is drawn as a source with the caption *Outside these files*, so the edge of what you know is visible.
- **The class of a product** (source-aligned, aggregate, consumer-aligned) is not in either standard. On the first import it is read from where the product stands: one that reads no other product is source-aligned, one that reads products and is read itself is an aggregate, one that only reads is consumer-aligned. Change it in the diagram and it stays changed.

### Running it again

The diagram that `carto import` or `--write` made is yours to edit. Running the same command again brings it up to date with the files and keeps what you added:

| The files win | Yours stays |
| --- | --- |
| label, domain, owner, version, status of a product | title, subtitle, `views:`, `focus:`, `steps:` |
| its ports and which contract each has | consumers, and products and sources you wrote yourself |
| what reads what | a product's `class`, `caption`, and `detail:` |
| products and contracts that are gone from the folder go | a port's label and kind where the file gives none |

A product keeps the id its file was first given, so positions you pinned in the editor (`mesh.layout.json`) and references you wrote by hand hold when a product is renamed. `--force` starts over.

### In the editor

- **Open** (`⌘O`) takes several files at once: pick the product and contract files and they open as one map.
- **Drop** files or a folder anywhere on the page.
- **Open folder…** (in the command palette, `⌘K`) on a folder that has data products or contracts and no diagram yet makes `data-mesh.yaml` in it, unsaved until you press `⌘S`. *Data mesh map of ‹folder›* in the palette brings it up to date later, the same way the command line does.

The files stay with the document, so the detailed view can read the contracts, also after a reload.

## Ports, contracts and keys

`view: detailed` opens the products up: input and output ports, and the contract behind a port with its schema, guarantees and quality checks.

![Customer 360 with its ports and the contracts it reads](data-products/customer-360.png)

This is [examples/data-products/mesh-detailed.yaml](../examples/data-products/mesh-detailed.yaml): the same mesh (`include: [mesh.yaml]`), cut down to one product and what it reads. The violet lines between fields are the `relationships` of the contracts, new in ODCS 3.1, drawn with crow's feet like in a database design:

```yaml
schema:
  - name: orders
    properties:
      - name: customer_id
        relationships:                       # on a property: where it points, here into another contract
          - type: foreignKey
            to: customers.odcs.yaml#/schema/customers_tbl/properties/customer_id_pk
  - name: order_lines
    relationships:                           # on the object: both ends
      - type: foreignKey
        from: order_lines.order_id
        to: orders.order_id
```

A key into another contract is drawn when that contract is in the drawing; lines between contracts do not pull the layout around, the data flow decides where things stand. Contracts written for ODCS 2 or 3.0 are drawn as before.

## The focus view

A whole mesh answers "what is there?". The questions people actually ask are about one product: *where does this number come from?* and *what breaks when I change this?* A focus draws one element and what is within a few lines of it, from the same file.

```yaml
focus: revenue                                         # revenue and what is one line away
focus: { on: revenue, hops: all, direction: upstream } # everything that feeds it
focus: { on: [orders, tag:pii], hops: 2 }              # two lines around several things
```

![Everything upstream of Revenue](data-products/revenue-lineage.png)

| Key | Says |
| --- | --- |
| `on` | What it is about: an id, a group (everything in it), `id.*`, `tag:x`, `kind:x`, or a list of these. The same selectors [steps](steps.md#selectors) take |
| `hops` | How many lines away: a number (default 1, 0 is the thing alone) or `all` for everything connected |
| `direction` | `both` (default), `upstream` (what feeds it, against the arrows) or `downstream` (what it feeds). A line without an arrow counts both ways |

What the focus is about gets a ring, the groups around what is left stay, and the key explains only what is still in the drawing. The subtitle says what you are looking at.

It is a property of the drawing, so it can be written at the top of a diagram or per view, and one file holds the landscape and its cuts:

```yaml
views:
  revenue-lineage: { title: Where revenue comes from, focus: { on: revenue, hops: all, direction: upstream } }
  orders-impact: { title: What a change to Orders touches, focus: { on: orders, hops: all, direction: downstream } }
```

On the command line, without touching the file:

```sh
carto render mesh.yaml --focus revenue --hops all --upstream -o lineage.svg
carto render shop.yaml --focus api --hops 2            # any diagram of boxes and lines
```

`--focus` wins over a `focus:` in the file. A step's `focus:` in [steps](steps.md) is its relative: that one dims what is around, this one leaves it out.

**It works for every type that is elements and lines**: architecture, C4, Azure, AWS and Google Cloud, Kubernetes, network, database, access, GitHub, data products. A sequence diagram, a git graph, a roadmap, a journey map or a matrix is one drawing with nothing to walk from: it is drawn whole, with a remark that says so.

### In the editor

| Key | Does |
| --- | --- |
| `F` | Focus on what is selected. While focused: select something else and press `F` to walk on |
| `+` `-` | One hop more, one fewer. Past six it becomes everything connected |
| `D` | Both ways, upstream, downstream |
| `Esc` | Back to the whole drawing (first press clears the selection) |

A chip at the top of the drawing says what is shown (*Focused on Revenue*, how many of the elements are drawn, the hops and the direction) with the same actions as buttons, and each of them is in the command palette (`⌘K`) under *Focus*. The focus you set with keys is a way of looking: it is not written to the YAML, and an export (`⌘E`) is what you see. When the file itself has a `focus:`, `Esc` shows everything and `Esc` again goes back to it.

## What is read from a data product (ODPS)

Two standards carry the name. Both are read; which one a file is, is seen from its content.

**Open Data Product Standard v1** (Bitol, Linux Foundation AI & Data): `kind: DataProduct`.

| In the file | In the diagram |
| --- | --- |
| `name` (else `id`) | The product and its label |
| `domain` | The domain it is drawn in |
| `team.name`, else the member with the owner role | Owner |
| `version`, `status` | In the caption; a status is shown unless it is active |
| `inputPorts[].name`, `.contractId` | An input, linked to the product that offers that contract |
| `outputPorts[].name`, `.type`, `.contractId` | An output port, its kind (table, topic, API, files…, read from `type`) and its contract |
| `outputPorts[].inputContracts[]` | Lineage as well |

Not read: `description`, `tags`, `managementPorts`, `support`, `team.members` beyond the owner, `productCreatedTs`, `customProperties`, `authoritativeDefinitions`.

**Open Data Product Specification 3.x and 4.x** (Linux Foundation, opendataproducts.org): a `product:` with `details` or a language block such as `en`.

| In the file | In the diagram |
| --- | --- |
| `name`, `productID` | The product |
| `categories[0]`, else `dataHolder.businessDomain` | Domain |
| `dataHolder.legalName` | Owner |
| `productVersion` or `version`, `status` | In the caption |
| `dataAccess` (one in 3.x, named ways in 4.x) | Output ports |
| `contract.id` | The contract of the first port |

Not read: pricing plans, licence, SLA, data quality, support, payment gateways. This specification has no input ports, so its lineage is yours to add in the diagram: `inputs:` you write stay through the next import.

## What is read from a data contract (ODCS)

**Open Data Contract Standard** (Bitol) 2.x, 3.0 and 3.1: `kind: DataContract`, with `schema[].properties[]` (3.x) or `dataset[].columns[]` (2.x).

| In the file | In the diagram |
| --- | --- |
| `id` | What ports refer to with `contractId`. Two files with one id: a warning |
| `name`, `version` | The contract's card |
| `dataProduct`, `domain`, `team` | Where a contract nobody has a port for belongs |
| `schema[]`, `properties[]` | Objects and fields in the detailed view: `physicalType` (else `logicalType`), primary key, unique, optional, and a mark on personal data |
| `classification` | On the card: the contract's own, else the strictest of its fields |
| `slaProperties[]` | Guarantees |
| `quality[]` on the contract, an object or a field | Quality checks |
| `relationships[]` on an object or a field (3.1) | Lines between fields; `customProperties` named `label` or `description` label the line |

A relationship can name its ends as `table.column`, as `schema/<object>/properties/<property>` by id, or in another file as `other.odcs.yaml#/schema/…`. Composite keys (lists in `from` and `to`) draw a line per pair. One that cannot be followed is listed as a remark, with the file.

Not read: `servers`, `roles`, `price`, `support`, `description`, `tags`, `authoritativeDefinitions`, `transformLogic`, and relationship types other than `foreignKey`.

## The standards

- Open Data Product Standard (Bitol): <https://bitol-io.github.io/open-data-product-standard/>
- Open Data Contract Standard (Bitol): <https://bitol-io.github.io/open-data-contract-standard/>
- Open Data Product Specification (Linux Foundation): <https://opendataproducts.org/>

Writing a data-products diagram by hand, without any of these files: see [Data products](types.md#data-products) and [examples/data-products](../examples/data-products).
