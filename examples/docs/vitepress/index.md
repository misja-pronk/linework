# Cartography in VitePress

Diagrams on this page are drawn when the site is built. No browser, no server: the page holds plain SVG, a light and a dark one, and the switch at the top right picks.

## A diagram file next to the docs

`![Web shop](./diagrams/shop.yaml)`

![Web shop](./diagrams/shop.yaml)

## A fenced block

````md
```cartography
type: systems
title: Sign-up
nodes:
  visitor: { kind: user, label: Visitor }
  site: { kind: client, label: Website }
  crm: { kind: database, label: CRM }
edges:
  - visitor -> site: Fills in the form
  - site -> crm: Stores the lead
```
````

```cartography
type: systems
title: Sign-up
nodes:
  visitor: { kind: user, label: Visitor }
  site: { kind: client, label: Website }
  crm: { kind: database, label: CRM }
edges:
  - visitor -> site: Fills in the form
  - site -> crm: Stores the lead
```

## With zoom and drill-down

`![Web shop](./diagrams/shop.yaml "interactive")` shows the same static drawing first and turns it into a live one when the component has loaded. Click **Web shop** to open it; Backspace goes back.

![Web shop](./diagrams/shop.yaml "interactive")
