# Diagrams-as-code tool market (as of 2026-11-09)

Research scope: Mermaid (+ Mermaid Chart, now mermaid.ai), D2 (+ TALA), PlantUML, Structurizr, Graphviz, mingrammer Diagrams, Ilograph, Kroki, Eraser, LikeC4, newer entrants. Purpose: positioning "Linework" (YAML + interactive builder that writes YAML back, sidecar layout pins, own orthogonal router on Graphviz dot, 9 domain diagram types).

Repo snapshot (GitHub API, fetched 2026-11-09 via `gh api`):

| Repo | Stars | Licence | Last push |
|---|---|---|---|
| mermaid-js/mermaid | 91,051 | MIT | 2026-11-09 |
| mingrammer/diagrams | 42,800 | MIT | 2026-11-02 |
| d2lang/d2 (moved from terrastruct/d2) | 25,815 | MPL-2.0 | 2026-10-11 |
| plantuml/plantuml | 13,408 | LGPL-3.0 (multi-licensed builds exist) | 2026-11-09 |
| likec4/likec4 | 6,047 | MIT | 2026-11-08 |
| yuzutech/kroki | 4,402 | MIT | 2026-11-07 |
| structurizr/structurizr (new unified repo) | 525 | Apache-2.0 | 2026-11-07 |

(GitHub mirror graphviz/graphviz is archived; main development is on GitLab — not re-verified this session.)

## Per-tool profile: layout engine, layout complaints, syntax, theming, licence, pricing, editing sync, exports

### Takeaway
The market splits into (a) ubiquitous-but-ugly renderers (Mermaid, PlantUML, Graphviz, mingrammer Diagrams) whose main complaint is uncontrollable layout, (b) prettier engines (D2/TALA) that lack native platform rendering, and (c) model-based C4 tools (Structurizr, LikeC4, Ilograph) with manual-layout persistence. Two big 2026 shifts: Terrastruct shut down and TALA became MPL-2.0 open source (2026-09-07), and Structurizr's cloud service hit end of life (2026-09-30) with Lite/CLI/on-prem folded into one tool.

### Cited Findings

**Mermaid / Mermaid Chart (rebranded mermaid.ai)**
- Most-starred tool (91k), MIT. — GitHub API (repo mermaid-js/mermaid)
- Layout: dagre historically; ELK available and, per third-party docs mirror, "In Mermaid 12, ELK is the default for most graph diagrams" with `layout: dagre` to switch back; ELK now bundled in main package. — [Mintlify mirror of Mermaid layout docs](https://www.mintlify.com/mermaid-js/mermaid/configuration/layouts) (secondary; not confirmed on mermaid.js.org this session)
- ELK registration problems in Mermaid 11 reported by Quarto users. — [Quarto discussion #13736](https://github.com/orgs/quarto-dev/discussions/13736)
- HN complaints: layout renderer "pretty bad… not aesthetically pleasing"; putting things in a reasonable location "nearly impossible", one new connection disrupts whole layout; advanced layout options "obscure"; "I really wish Mermaid would just ratify a layout spec"; routing "tends to blow up" with many lines into a node; engine "completely falls apart" past a certain node count. — [HN 41260127 Mermaid thread](https://news.ycombinator.com/item?id=41260127), [HN 45706792](https://news.ycombinator.com/item?id=45706792), [HN 42044771](https://news.ycombinator.com/item?id=42044771) (paraphrased via search summary)
- Install pain: npm CLI install "lasts too long" because it pulls headless Chrome (tretiy3). — [HN 45707539](https://news.ycombinator.com/item?id=45707539)
- Top GitHub issues by 👍 (all are about missing diagram types / styling, not layout): Use Case diagram (+695, closed), Styling sequence diagram components (+475, open since 2017), Venn (+473), Component Diagram (+364, open), Swimlanes in flowchart (+337), **Network topology diagram type (+329, open since 2020)**, subgraph direction not applying (+186), Activity diagram (+178). — [GitHub search](https://github.com/mermaid-js/mermaid/issues/4628), [#523](https://github.com/mermaid-js/mermaid/issues/523), [#1462](https://github.com/mermaid-js/mermaid/issues/1462), [#1227](https://github.com/mermaid-js/mermaid/issues/1227), [#2509](https://github.com/mermaid-js/mermaid/issues/2509)
- Mermaid Chart moved to mermaid.ai (mermaidchart.com/pricing 301 → mermaid.ai/pricing). Plans: Basic free (3 diagrams — table elsewhere says 6 — limited size, 15 AI credits); Plus $10/user/mo annual (unlimited diagrams, 300 AI credits/yr); Premium $20/user/mo annual (2,000 AI credits/yr, unlimited viewer seats); Enterprise custom (SSO). Annual billing only; paid prompts not used for training. — [mermaid.ai/pricing](https://mermaid.ai/pricing)
- Open-source lib free; hosted collaboration, AI, visual editing, presentations, integrations monetised via Mermaid Chart. — [aitoolsatlas (secondary)](https://aitoolsatlas.ai/tools/mermaid-chart/pricing)
- Killer feature = native GitHub rendering ("mermaids killer feature is that GitHub supports it natively"; "natively supported in so many places making it the pragmatic choice"). — [HN 45713312](https://news.ycombinator.com/item?id=45713312), [HN 45707539](https://news.ycombinator.com/item?id=45707539)

**D2 (d2lang, formerly Terrastruct)**
- MPL-2.0, 25.8k stars; repo moved to d2lang/d2. — GitHub API
- 2026 governance change: "D2 Is Non-Profit" — fiscally sponsored by Hack Club (7% cut of donations per maintainer alixanderwang); Terrastruct company shutting down; development to shift to AI ("D2 thus far has been a product of handcrafted code. That era is over."). Commenters questioned Hack Club sponsorship. — [HN 49589768](https://news.ycombinator.com/item?id=49589768), [runtimewire](https://runtimewire.com/article/terrastruct-open-sources-tala-alexander-wang-winds-down-business)
- TALA open-sourced 2026-09-07 under MPL-2.0, bundled in D2 v0.9.0 (`--layout=tala`), runs client-side in playground. TALA = orthogonal layout for software architecture, "closer to whiteboard-style" than DAG; optimises symmetry, median distance, flow, clustering of like nodes. Supports top/left pinned positions and sizes mixed with auto-placed nodes. Stated tradeoffs: output can change noticeably when a node is added (random seeds, 3 by default, best score wins); weaker than dagre/ELK on long flowing DAGs; runtime grows nonlinearly. — [D2 blog: TALA is open source](https://d2lang.com/blog/tala-is-open-source/)
- Before that: TALA watermarked without licence; "3000usd / year for a single TALA license is… not justifiable" (snowfield, Oct 2025). — [HN 45707539](https://news.ycombinator.com/item?id=45707539), [D2 TALA tour](https://d2lang.com/tour/tala/)
- `top`/`left` locking works only with TALA, not dagre/ELK ("Sadly it's not possible in the open-source ones" — alixanderwang, 2025, pre-open-sourcing). — [d2lang.com/tour/positions](https://d2lang.com/tour/positions/), [d2lang.com/tour/layouts](https://d2lang.com/tour/layouts/), [HN 45707539](https://news.ycombinator.com/item?id=45707539)
- Layout opinions split: "results are so incredibly well laid out" (nmadden) vs "TALA output to be the worst of all the engines" (ris); "extremely rare that Dagre does a better job than ELK" (aidenn0); D2 "only solution… render a lot of objects without having to fight the engine" (aduwah); declarative tools lack "declare, then tweak" (rtpg). — [HN 45707539](https://news.ycombinator.com/item?id=45707539)
- Doesn't handle hyperedges (one edge to many nodes) (IshKebab). — [HN 49589768](https://news.ycombinator.com/item?id=49589768)
- Styling: default theme "a hard sell to orgs where management isn't technical" (nwmcsven); sketch mode popular though font less readable; tooltips/links valued. — [HN 45707539](https://news.ycombinator.com/item?id=45707539)
- No GitHub rendering; Confluence Cloud only via paid add-on; LLMs generate D2 as easily as Mermaid. — [HN 49589768](https://news.ycombinator.com/item?id=49589768), [HN 45707539](https://news.ycombinator.com/item?id=45707539)
- Top GitHub issues (low counts): multi-view / C4 model views of same model (+18, closed), draw.io import/export (+15, open), **specify ports (+14, open)**, custom shape types (+12, open), per-container directions/layouts (+11, open). — [#711](https://github.com/d2lang/d2/issues/711), [#743](https://github.com/d2lang/d2/issues/743), [#628](https://github.com/d2lang/d2/issues/628), [#133](https://github.com/d2lang/d2/issues/133), [#495](https://github.com/d2lang/d2/issues/495)

**PlantUML**
- LGPL-3.0 (repo), Java, Graphviz-based layout for most UML diagrams. 13.4k stars. — GitHub API
- Classic complaint issue #13 "diagrams are a mess…" (2016, still open, +24): "there is no way to more finely control diagram layouts… PlantUML is unusable in anything more than trivial… please find a way to prevent such a spaghetti". — [plantuml#13](https://github.com/plantuml/plantuml/issues/13)
- Open: port placement instructions for component diagrams (+28, 2024). — [plantuml#1766](https://github.com/plantuml/plantuml/issues/1766)
- "spending 20-30% of my time desperately trying to tweak the layout with hints"; wants to "lock the coordinates for certain components" (zmmmmm). — [HN 45706792](https://news.ycombinator.com/item?id=45706792)
- "much more featureful than Mermaid" but can't render in-browser JS (everforward); "feeling a bit stale" (bargainbin). — [HN 45707539](https://news.ycombinator.com/item?id=45707539)
- Rendered natively in GitLab (enabled on GitLab.com; admin must enable on self-managed). — [GitLab Markdown docs](https://docs.gitlab.com/user/markdown/)

**Graphviz**
- Underlying engine for PlantUML, mingrammer Diagrams, (historically) Structurizr/LikeC4 auto-layout. Complaint: "a diagram jumps around a lot… snapshot to snapshot" (layout instability, purpleidea); "why does this need to exist vs graphviz?" re D2 (spopejoy). — [HN 45707539](https://news.ycombinator.com/item?id=45707539)

**mingrammer Diagrams (Python)**
- MIT, 42.8k stars, Graphviz backend, cloud icon sets. — GitHub API
- Top issues are all layout/structure control, nearly all open since 2020: Terraform support (+130), **arrows to/from clusters (+121)**, any node as cluster (+46), control size/position of nodes (+28), control cluster arrangement LR/TB (+28), lines between clusters (+20), official Docker image (+19). — [#6](https://github.com/mingrammer/diagrams/issues/6), [#17](https://github.com/mingrammer/diagrams/issues/17), [#34](https://github.com/mingrammer/diagrams/issues/34), [#65](https://github.com/mingrammer/diagrams/issues/65), [#44](https://github.com/mingrammer/diagrams/issues/44), [#128](https://github.com/mingrammer/diagrams/issues/128)

**Structurizr (C4)**
- Cloud service end of life 30 September 2026; Lite, CLI and on-premises folded into one unified tool/Docker image with `local`, `server`, `export`, pull/push commands. — [Structurizr EOL](https://docs.structurizr.com/eol), [changelog](https://www.structurizr.com/help/changelog)
- "All Structurizr commands are free to use except for server, which requires a license when using it via our prebuilt binaries"; binaries v2026.09.19. — [docs.structurizr.com](https://docs.structurizr.com/), [server pricing](https://docs.structurizr.com/server/pricing) (price figures not retrieved)
- Server EULA (updated 23 May 2026): perpetual licence for installed version continues if discontinued. — [EULA](https://docs.structurizr.com/server/eula)
- Manual layout: drag elements on the canvas and save the layout; also diagram editor docs. — [Structurizr manual layout](https://docs.structurizr.com/ui/diagrams/manual-layout), [diagram editor](https://docs.structurizr.com/server/diagrams/editor)
- New repo issue "Manual layout not preserved" (Jan 2026, closed) — persistence of manual layouts is a sore point. — [structurizr#16](https://github.com/structurizr/structurizr/issues/16)
- Offers AI guidance/MCP server for DSL validation and inspection. — [docs.structurizr.com/ai](https://docs.structurizr.com/ai), [architecto.dev comparison](https://architecto.dev/de/compare/structurizr-direct)
- Lite praised for "as code", docs criticised ("documentation of it not so much"). — [lemmy thread](https://lemmy.nekusoul.de/post/26482)

**LikeC4**
- MIT, 6k stars, very active (push 2026-11-08). DSL inspired by C4/Structurizr but with custom element kinds ("specification") and nesting; does not enforce C4 levels. CLI (`build`, `serve`, `generate react`), VS Code extension with live preview, Vite plugin, React/Web Components, MCP server, LLM-friendly DSL; validates changes in Git for architectural drift. — [likec4.dev](https://likec4.dev/), [README](https://cdn.jsdelivr.net/gh/likec4/likec4@main/README.md), [notes.dsebastien.net](https://notes.dsebastien.net/30+Areas/33+Permanent+notes/33.02+Content/likec4)
- Manual layout: `@likec4/diagram` exposes `useDiagramCompareLayout` (compare manual vs auto layout, "drift reasons", apply latest model); `likec4 validate` flags "layout drift (outdated manual layout)" and exits non-zero. — [@likec4/diagram README](https://cdn.jsdelivr.net/npm/@likec4/diagram@1.59.3/README.md), [LikeC4 CLI docs](https://likec4-docs-astro.pages.dev/tooling/cli)
- Edge routing option "Draw relationships with right-angle bends" (orthogonal). — [likec4.dev/dsl/views](https://likec4.dev/dsl/views/)
- Top issues: "Larger systems render poorly" (+18, open since 2024 — containers don't wrap in large context view), "Render relations as orthogonal arrows" (+14, closed Mar 2026), relationship technology, Markdown descriptions, logical grouping in dynamic views. — [#751](https://github.com/likec4/likec4/issues/751), [#2680](https://github.com/likec4/likec4/issues/2680), [#2674](https://github.com/likec4/likec4/issues/2674)
- Third-party listing claims draw.io round-trip import. — [openapps.pro](https://openapps.pro/apps/likec4) (unverified)

**Ilograph**
- Products: Ilograph for Web, Desktop (offline, local files), Confluence Cloud. Model of resources + perspectives (relation and sequence perspectives), walkthroughs, contexts, imports; docs section "Adjusting Resource Sizes, Positions, and Detail". — [Ilograph docs](https://www.ilograph.com/docs/)
- Pricing: Desktop ~$11.99/mo (official page garbled); Team ~$20/user/mo; free tier exists (viewer limits disputed: "unlimited" vs "up to 3 viewers"); desktop licences not included with team workspaces; Confluence priced by team size. — [ilograph.com/pricing.html](https://ilograph.com/pricing.html), [gappsy](https://gappsy.com/tools/ilograph/), [freetier.co](https://freetier.co/directory/products/ilograph), [agentdeals](https://agentdeals.dev/vendor/ilograph)

**Kroki**
- MIT, 4.4k stars; unified rendering API over many engines; integrated in GitLab (admin must enable). Top requests: draw.io support (+26), mingrammer Diagrams (+17), Sankey, Venn; D2 evaluation closed. — GitHub API, [kroki#405](https://github.com/yuzutech/kroki/issues/405), [kroki#1323](https://github.com/yuzutech/kroki/issues/1323), [GitLab docs](https://docs.gitlab.com/user/markdown/)

**Eraser**
- Free $0 (3 files, 3 AI credits, 7-day history); Business $45/member/mo annual ($60 monthly), 100 AI credits/mo, 1 Git repo; Business Plus $42/member/mo annual, 10-seat min, 250 credits, SAML; Enterprise custom, unlimited AI. All plans: AI diagrams, diagram-as-code, 3,000+ tech icons, infinite canvas, export PDF/PNG/SVG/MD, Notion and Confluence integrations, VS Code extension. GitHub integration paid only. Starter plan discontinued for new teams. — [eraser.io/pricing](https://www.eraser.io/pricing)

**Newer entrants**
- oxdraw (Show HN 2025-10-25, 266 pts): reads Mermaid, GUI drag to customise layout, manual changes saved as comments so files still render in stock Mermaid — the closest analogue to Linework's sidecar pins. — [HN 45706792](https://news.ycombinator.com/item?id=45706792)
- Scryer (canvas editor docs surfaced), small animated/AI arch-diagram projects on GitHub topics; adoption not verifiable. — [scryer](https://aklos.github.io/scryer/editor/canvas), [GitHub topic diagrams-as-code](https://github.com/topics/diagrams-as-code)

### Inferences
- Across Mermaid, PlantUML, mingrammer Diagrams and LikeC4 the most persistent pain is layout control on large/clustered graphs (cluster-to-cluster edges, ports, wrapping). Linework's orthogonal router + pins addresses the single loudest complaint category.
- Mermaid's top-voted open requests include **network topology** (+329) and **component diagrams** (+364) — domain diagram types Linework targets (networking, Azure/K8s) are visibly underserved by the market leader.
- TALA going open source removes D2's main paywall; D2 now has free pinning + orthogonal layout, so it is Linework's closest direct competitor on layout quality — but its future is uncertain (company shut, non-profit, AI-driven development) and it still has no GitHub rendering.

### Gaps
- Could not retrieve Structurizr server price figures or LikeC4's exact drag-and-save UX (whether positions live in a separate file).
- Mermaid 12/ELK-default claim seen only on a secondary docs mirror.
- Graphviz upstream (GitLab) stars/issues not retrieved.

## Manual position overrides: who supports what, and how

### Takeaway
Manual overrides exist in TALA (inline `top`/`left` in the source), Structurizr (drag and save into the workspace JSON), LikeC4 (saved manual layout with drift detection), Ilograph (adjust size/positions), and oxdraw (Mermaid comments). Pure dagre/ELK/Graphviz paths (Mermaid, PlantUML, D2-OSS-engines, mingrammer) offer only hints.

### Cited Findings
- D2/TALA: `top`/`left` per object; engine moves other objects around pinned ones; only in TALA. — [d2 positions](https://d2lang.com/tour/positions/), [d2 layouts](https://d2lang.com/tour/layouts/), [TALA OSS blog](https://d2lang.com/blog/tala-is-open-source/)
- Structurizr: drag elements in the canvas, save layout; "Manual layout not preserved" bug reported Jan 2026. — [manual layout docs](https://docs.structurizr.com/ui/diagrams/manual-layout), [structurizr#16](https://github.com/structurizr/structurizr/issues/16)
- LikeC4: saved manual layouts, compare vs auto layout, `likec4 validate` fails on outdated manual layout. — [@likec4/diagram README](https://cdn.jsdelivr.net/npm/@likec4/diagram@1.59.3/README.md), [CLI docs](https://likec4-docs-astro.pages.dev/tooling/cli)
- Ilograph: "Adjusting Resource Sizes, Positions, and Detail" docs section. — [Ilograph docs](https://www.ilograph.com/docs/)
- oxdraw: drag in GUI, persisted as Mermaid comments. — [HN 45706792](https://news.ycombinator.com/item?id=45706792)
- User preferences differ: lock some coordinates and let engine do the rest (zmmmmm) vs assign weights, not x/y (Anduia); generate with AI then adjust visually (eagleinparadise); LLM refinement of layouts hard, interactive editing much faster (liqilin1567). — [HN 45706792](https://news.ycombinator.com/item?id=45706792)
- TALA warns that adding a node can noticeably change layout (random seeds). — [TALA OSS blog](https://d2lang.com/blog/tala-is-open-source/)

### Inferences
- Linework's sidecar pin file is a differentiator vs D2 (pins inline in source, polluting text) and similar in spirit to Structurizr/LikeC4 (layout stored separately); LikeC4's "layout drift" check is a feature worth copying (warn when pins reference removed nodes or model changed).
- Layout stability ("jumps around snapshot to snapshot", TALA reshuffles on node add) is a distinct complaint; deterministic dot + pins can be marketed as stable diffs.

### Gaps
- Didn't verify whether Ilograph positions are absolute or relative hints, nor Eraser's manual-tweak model for its diagram-as-code.

## Recurring complaints (HN, GitHub; Reddit sparse)

### Takeaway
Complaints cluster into: (1) uncontrollable/spaghetti layouts and edge routing at scale; (2) missing ports and cluster-level edges; (3) ugly/unprofessional default themes; (4) no native rendering where docs live (for anything except Mermaid); (5) heavy tooling (headless Chrome, Java).

### Cited Findings
- "diagram as code tools… limiting. There will be that…" (thread on limits of DaC). — [HN 38997237](https://news.ycombinator.com/item?id=38997237)
- "Never seen a bigger waste of time than when my colleague…" (diagram-as-code time sink anecdote). — [HN 43559405](https://news.ycombinator.com/item?id=43559405)
- PlantUML "spaghetti" (#13), Mermaid routing blowups, D2 hyperedge limitation, LikeC4 large-system rendering (#751), mingrammer cluster edges (#17, +121). — links above
- Language "rough in the hands" with frustrating layout systems (jitl). — [HN 45707539](https://news.ycombinator.com/item?id=45707539)
- Reddit: no high-quality r/devops / r/softwarearchitecture threads retrieved this session; one r/dataengineering thread on AI technical diagrams exists. — [r/dataengineering mirror](https://reddit.birdcat.cafe/r/dataengineering/comments/1jmmf52/how_to_use_ai_to_create_better_technical_diagrams)

### Inferences
- Default visual polish matters for adoption beyond engineers (D2 "hard sell to management"); Linework's domain-specific icon/stencil sets (Azure, K8s) and LCARS-quality styling can be a lever.

### Gaps
- Reddit quotes not retrieved (Reddit not directly fetched); treat as gap.

## Multi-view / model-based approaches

### Takeaway
Users like one model, many views because views stay consistent and can be validated/drilled into; D2's most-upvoted (closed) issue was literally a request for C4-style multiple views of one model.

### Cited Findings
- Structurizr: model-based "for consistent views"; strict C4 levels, less customisable. — [architecto.dev](https://architecto.dev/de/compare/structurizr-direct)
- LikeC4: custom element types and nesting as main selling point; must define own spec, careful with abstraction levels "especially when AI generates the code"; interactive drill-down views. — [lemmy/LikeC4 discussions](https://lemmy.dbzer0.com/post/98001), [likec4.dev](https://likec4.dev/)
- D2 #711 "Support different views/selective renderings of the same model (support C4Model approach)" +18 — top D2 issue. — [d2#711](https://github.com/d2lang/d2/issues/711)
- Ilograph: resources defined once, shown across perspectives, plus walkthroughs/contexts. — [Ilograph docs](https://www.ilograph.com/docs/)
- Simon Brown argues "models as code" constrains AI output and gives better C4 results than PlantUML/Mermaid/D2 diagram syntax. — [Patreon: AI vs architecture diagrams part 3](https://www.patreon.com/posts/152027514)

### Inferences
- Linework's 9 separate diagram types are diagram-centric, not model-centric; a shared model across types (e.g., same Azure resource in network and data-product views) would answer the multi-view demand.

### Gaps
- No quantitative user-sentiment data on multi-view.

## AI generation features and reliability

### Takeaway
Every commercial player bundles credit-metered AI generation (mermaid.ai 15–2,000 credits/yr; Eraser 3–250/mo). Reliability evidence is anecdotal: fine for generic AWS/K8s diagrams, poor for real complex systems; syntax errors and missing edges common; model-based DSLs constrain output better.

### Cited Findings
- mermaid.ai credit tiers (15 free / 300 / 2,000 per year). — [mermaid.ai/pricing](https://mermaid.ai/pricing)
- Eraser AI credits (3 / 100/mo / 250/mo / unlimited). — [eraser.io/pricing](https://www.eraser.io/pricing)
- Generic AWS/K8s diagrams "work reasonably well"; diagrams of existing complex systems "largely beyond AI's current capabilities". — [IcePanel blog](https://icepanel.io/blog/the-pros-and-cons-of-diagram-as-code-for-software-architecture) (via search summary; vendor)
- LLM diagram code may contain syntax errors, missing connections, or wrong structure. — [codingfleet](https://codingfleet.com/blog/best-ai-diagram-generators-from-code/) (vendor)
- LLMs generate D2 as easily as Mermaid; D2's expressiveness helps AI. — [HN 49589768](https://news.ycombinator.com/item?id=49589768), [HN 45707539](https://news.ycombinator.com/item?id=45707539)
- Structurizr and LikeC4 both ship MCP servers. — [docs.structurizr.com/ai](https://docs.structurizr.com/ai), [likec4.dev](https://likec4.dev/)

### Inferences
- A YAML schema (Linework) with domain types is easy for LLMs and validatable; offering an MCP server/JSON schema would match LikeC4/Structurizr.

### Gaps
- No independent benchmark of Eraser DiagramGPT or Mermaid AI accuracy found.

## Native rendering (GitHub/GitLab/Notion/Confluence) and adoption

### Takeaway
Native rendering is the decisive adoption driver: Mermaid wins on GitHub/GitLab despite worse layout; D2, LikeC4, Structurizr need CI export, Kroki, or paid Confluence add-ons.

### Cited Findings
- GitLab renders Mermaid, PlantUML (admin-enable on self-managed) and Kroki (admin-enable). — [GitLab docs](https://docs.gitlab.com/user/markdown/)
- GitHub renders Mermaid natively; D2 "is better, but it's not supported by GitHub. Go where your users are." — [HN 45713312](https://news.ycombinator.com/item?id=45713312)
- D2 not rendered by GitHub or Confluence; Confluence Cloud only via paid add-on. — [HN 49589768](https://news.ycombinator.com/item?id=49589768), [HN 45707539](https://news.ycombinator.com/item?id=45707539)
- Eraser has Notion/Confluence integrations on all plans, GitHub on paid. Ilograph sells a Confluence Cloud app. — [eraser.io/pricing](https://www.eraser.io/pricing), [Ilograph docs](https://www.ilograph.com/docs/)
- Obsidian used for D2/Mermaid rendering; Mermaid ELK renderer plugin exists for Obsidian. — [HN 45707539](https://news.ycombinator.com/item?id=45707539), [Obsidian forum](https://forum.obsidian.md/t/mermaid-elk-renderer/113112)

### Inferences
- Linework cannot get native GitHub rendering; mitigations: commit SVG output via GitHub Action, export to Mermaid/draw.io as a fallback, Kroki plugin, static HTML viewer. Draw.io import/export is a repeatedly requested feature (D2 #743, Kroki #405).

### Gaps
- Notion's Mermaid support and Confluence's native options not verified from primary docs this session.
