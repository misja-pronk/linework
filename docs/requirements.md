# Cartography — requirements

IDs: **M** = must (first release), **S** = should (soon after), **C** = could (later).

## 1. Goals and non-goals
- G1 One tool for all diagram types below, with one consistent look.
- G2 Presentation-ready output with no redrawing: slides, customer documents, README files.
- G3 Two equal ways to make a diagram: text (YAML) and an interactive builder. Both stay in sync.
- G4 Open source (MIT), using only open-source dependencies with permissive licences.
- Non-goals (for now): live collaboration with multiple people at once, a hosted SaaS with accounts, a general freeform whiteboard, importing existing draw.io/Visio files (C at most).

## 2. Users and use cases
- U1 Architect/consultant (you): make diagrams fast for customers, documents and slides.
- U2 Developer: keep diagrams next to the code in git, review them in PRs, render them in CI.
- U3 Claude or another AI: write or change the YAML for you; the schema must make that reliable.
- U4 Contributor: add a new diagram type or icon without touching the core.

## 3. Diagram types
Every type: **M** has a template, an example in the gallery, a JSON Schema, a builder palette and a dedicated layout.

### 3.1 Azure infrastructure (M)
- Nested containers: tenant → management group → subscription → resource group → VNet → subnet.
- Resources: App Service, Function, AKS, Container Apps, VM, SQL, Cosmos DB, Storage, Key Vault, Service Bus, Event Hub, API Management, Front Door, App Gateway, Firewall, Private Endpoint, Entra ID, Log Analytics, and others (extensible list).
- Edges carry a label (protocol/port) and a style: public, private, data flow, identity.
- Region and availability-zone bands (S).

### 3.2 Kubernetes (M)
- Cluster → namespace → workloads (Deployment, StatefulSet, DaemonSet, Job/CronJob) → pods (optional).
- Service, Ingress/Gateway, ConfigMap, Secret, PVC/StorageClass, ServiceAccount, NetworkPolicy, HPA.
- Show traffic from outside → ingress → service → workload.
- Node pools as an optional grouping (S). Generate from manifests / `kubectl get -o yaml` (C).

### 3.3 Networking (M)
- Zones/segments (internet, DMZ, LAN, VLANs, on-prem, cloud) as groups with CIDR labels.
- Devices: router, switch, firewall, load balancer, VPN gateway, access point, server, client, DNS.
- Links with labels (bandwidth, VLAN, port), VPN/tunnel style, direction.
- Optional IP/port table view per device (S).

### 3.4 Database design / ERD (M)
- Tables with columns: name, type, PK, FK, nullable, unique, default.
- Relations with crow's-foot cardinality (1–1, 1–n, n–m), lines attach to the exact column.
- Schemas as groups; views and enums (S).
- Import from SQL DDL (S) and from Postgres/SQL Server catalogue (C); export DDL (C).

### 3.5 Roles, groups & access packages (M) — type `access`
- Principals: users, guests, security / dynamic / role-assignable / Microsoft 365 groups, service principals, managed identities, connected organisations; group membership (nested).
- Entra ID governance: catalogs with access packages; per package what it grants (group membership, app and site roles), its policies (who may request, approvers in order, duration, access review, automatic assignment) and who holds it now.
- Resources and scopes as a tree (tenant → management group → subscription → resource group → resource), plus apps and sites.
- Roles with inheritance and permissions; role assignments written as `sg-dev is contributor on rg-dev`.
- Four views from one file (`view:`): **graph** (requestors → policy → package → group / app role → role on scope), **access** (who × where with the effective role and where it comes from: via group, via package, from parent scope), **packages** (packages × what they grant), **roles** (roles × permissions, inherited ones marked).
- Presets for built-in Azure RBAC, Entra and GitHub roles (S).

### 3.6 GitHub design (M)
- Organisation → teams (nested) → repositories → environments.
- Branch protection/rulesets, Actions workflows, runners (hosted/self-hosted), secrets/variables per level, GitHub Apps, CODEOWNERS.
- Show which team has what access to which repo (link with 3.5).

### 3.7 Git flow (M)
- Branches as horizontal lanes (main, develop, feature/*, release/*, hotfix/*), commits, merges, tags, releases.
- Presets: Git Flow, GitHub Flow, trunk-based, release branches.
- Annotations on commits (e.g. "deploy to test", "PR review").
- Steps/animation to show the flow in a presentation (S).

### 3.8 Developer journey / storytelling (M)
- Timeline or storyboard of steps for one persona: action, touchpoint/tool, thoughts, emotion (curve), pain points, gains.
- Phases as columns (e.g. onboarding → first commit → first deploy → incident).
- Characters/avatars from an open-source set; speech bubbles.
- Step-through presentation mode (S).

### 3.9 Data products (M), type `data-products`
- Domains as groups; source systems; data products with owner, version, input ports (from a source, a product or `product.port`) and output ports (table, view, files, API, stream, topic, SQL, model); consumers (dashboard, report, ML model, application, team, analyst, partner).
- Product classes **source-aligned**, **aggregate** and **consumer-aligned**, each with its own colour, icon and caption, plus a legend.
- **Data contracts** on output ports: version, classification, schema fields (pk, PII, nullable), guarantees (freshness, availability, …) and quality checks.
- **Two detail levels from one source:** `view: overview` (products as cards plus lineage between them, one line per product pair) and `view: detailed` (products as tables with their ports, lines attached to the exact port, contracts beside the port they govern). With products in several domains the detailed drawing is offered per domain (`detailed-<domain>`), so each fits a slide; `detailed` still draws them all when asked for by name.
- Detail per product too: `detail: [id]` or `detail: true` shows one product in detail and the rest as overview; `show-contracts: false` hides contracts.
- Contracts can come from an **Open Data Contract Standard** file (`file: contracts/x.odcs.yaml`, v3 and v2): name, version, schema objects and fields (key, PII from tags or classification, optional unless required), SLA properties with units, quality rules and the strictest classification. Keys written in the diagram override the file; `contract-fields: n` caps the fields shown ("+ n more fields"). The CLI resolves files relative to the diagram and `carto watch` follows them.

## 4. Text format
- T1 (M) YAML, one diagram per file, with `type:` at the top and a published JSON Schema per type (autocomplete and validation in VS Code and the web editor).
- T2 (M) Short syntax for edges: `web -> db: label`, plus a long form with properties.
- T3 (M) IDs are stable and readable; labels can differ from IDs.
- T4 (M) Manual tweaks (pinned positions, bends, sizes) go in a sidecar `name.layout.json`, so the YAML stays clean and diffs stay small.
- T5 (M) Clear error messages with line/column, also in the CLI.
- T6 (S) Reuse: include/import other files, shared variables (e.g. region name).
- T7 (S) Several views/pages in one file (e.g. ERD per schema, data products overview + detail).

## 5. Interactive builder (per template)
- B1 (M) Template picker: start from an empty or example template of any type.
- B2 (M) Palette with the type's shapes; add by dragging or with a keyboard shortcut plus search.
- B3 (M) Inspector panel: a form for the selected element's properties (label, kind, parent, type-specific fields such as CIDR, PK/FK, owner, SLA).
- B4 (M) Connect by dragging from element to element; nest by dropping into a group; reorder columns/lanes.
- B5 (M) Two-way sync: builder changes write YAML, YAML edits update the canvas immediately, and the cursor and selection stay where they were.
- B6 (M) Palette and forms are generated from the type's JSON Schema, so a new type gets its builder without UI code.
- B7 (M) Undo/redo, multi-select, copy/paste, delete, duplicate.
- B8 (M) Keyboard-first: every action has a visible shortcut, plus a command palette (⌘K). Trackpad-friendly as well.
- B9 (S) Wizards for common setups (e.g. "hub-spoke network", "3-tier on Azure", "Git Flow").

## 6. Layout
- L1 (M) Automatic layout per type that avoids crossing lines, gives groups room, and routes edges orthogonally around nodes.
- L2 (M) Pinned nodes stay where you put them; the rest re-layouts around them.
- L3 (M) Stable: a small change gives a small change in the drawing (no jumps).
- L4 (M) Direction (left→right, top→bottom) per diagram.
- L5 (S) Snap to grid, align/distribute, manual edge bends.

## 7. Visual design
- V1 (M) Clean modern style with a look of its own (Survey, see style.md): lots of whitespace, restrained colour, thin crisp lines, bundled OFL fonts (Instrument Sans and Geist Mono by default).
- V2 (M) One set of design tokens (colours, spacing, radii, lines, font sizes) for all types.
- V3 (M) Light and dark themes; the export follows the chosen theme.
- V4 (M) Own line-icon set in one style for all types (based on Lucide, ISC). Kubernetes icons (CC-BY-4.0) optional. Microsoft Azure icons are not bundled (their terms forbid redistribution), but users can load their own icon pack (S).
- V5 (M) Accessible: contrast AA, meaning never carried by colour alone (also line style/icon).
- V6 (S) Own themes/brand colours per customer via a theme file.
- V7 (S) Legend generated automatically from the edge and node styles in use.

## 8. Output and export
- E1 (M) SVG (crisp, selectable text, fonts embedded or outlined) and PNG (1×/2×/3×).
- E2 (M) CLI output identical to web output.
- E3 (S) PDF; copy to clipboard as PNG/SVG; slide-sized frames (16:9).
- E4 (S) Markdown/GitHub: render in CI and commit the SVG; a GitHub Action.
- E5 (C) Export to draw.io / Excalidraw.

## 9. Apps
- A1 (M) **Web app** (static, runs offline, no account): editor + builder + preview + export. Files open/save locally (File System Access API, with download/upload as fallback).
- A2 (M) **CLI**: `carto render`, `carto watch`, `carto validate`, `carto new <template>`.
- A3 (S) VS Code extension with live preview (reuses the web components).
- A4 (C) Embed component (`<carto-diagram src=…>`) for docs sites.

## 10. Extensibility
- X1 (M) A diagram type is a plugin: schema + layout + shape renderers + template + palette. Core stays type-agnostic.
- X2 (M) Icon packs and themes are plain files (SVG + JSON).
- X3 (S) Contributor guide "add a type in one afternoon".

## 11. Quality, tech and open source
- Q1 (M) TypeScript, pnpm monorepo; packages `core`, `layout`, `render`, `theme`, `icons`, `cli`, `web`, and one package per type.
- Q2 (M) Only permissive licences: Graphviz dot via @hpcc-js/wasm-graphviz (Apache-2.0 wrapper, Graphviz EPL) for node placement, our own orthogonal line router, React, Vite, CodeMirror 6, resvg-js (PNG without a browser), Lucide, and OFL fonts (Instrument Sans, Geist Mono, Barlow, IBM Plex, Inter). Licence check in CI.
  - Decided 2026-11-09 after measuring (`pnpm lab`): ELK lays out each group as one block, so lines that go into a group, out and back in were reversed or detoured around the drawing. dot layers the whole graph at once and keeps clusters together; our router then avoids boxes and group headers, spreads lines into lanes and places labels. Result on the examples: no backward lines, no lines through boxes, about 35% shorter lines.
- Q3 (M) Tests: schema/parse unit tests, SVG snapshot tests per gallery example, layout quality guard per example (no lines through boxes, no overlapping labels, no backward lines, crossing budget), builder round-trip tests (UI action → YAML → same drawing).
- Q4 (M) Performance: diagram of 200 elements renders under 1 s; editing feels instant (<100 ms update).
- Q5 (M) Privacy: everything local, no telemetry, no network calls.
- Q6 (M) MIT licence, README with gallery, docs, CONTRIBUTING, GitHub Actions CI. I'll make the repo public and publish to npm only after you OK it.

---

## Build phases (after you approve the requirements)
1. Repo + `docs/requirements.md`; core, theme, render, CLI; first types **Azure** and **ERD** (hardest layout cases: nesting and ports); gallery.
2. Web app: editor, preview, drag-to-pin, schema-driven builder (B1–B8), export.
3. Data products (overview + detailed), Kubernetes, networking, GitHub; then roles & permissions, git flow, journey, each with template and builder.
4. S items, docs site, open-source release.

## Verification
- `pnpm test`: unit, snapshot and builder round-trip tests.
- `carto render examples/**/*.yaml` → gallery; I check the PNGs visually per type, and you judge the look before the next type starts.
- Web: build every template using only the builder → YAML validates and renders the same in the CLI; drag-to-pin survives a reload; data products render in both detail levels.
