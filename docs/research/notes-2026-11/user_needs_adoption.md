# User needs, pain points and adoption drivers for architecture diagram tools (as of Nov 2026)

Research date: 2026-11-09. GitHub star counts were pulled live through the GitHub API on 2026-11-09 (`gh api repos/<repo>`), so they are a snapshot, not a time series.

## 1. Top pain points with architecture diagrams

### Takeaway
The pain point that comes up most often, in both surveys and threads, is keeping diagrams and docs up to date. After that come inconsistency or missing standards, choosing the level of detail, layout fiddling (manual editors are too fiddly, while auto-layout jumps around), and diff/versioning problems with binary formats. Text-in-git is the main reason people pick diagrams-as-code. Ugly output is the main reason they leave it again.

### Cited Findings
- IcePanel State of Software Architecture 2025 (published 21 Jan 2026; n=75; 57% architects, 29% engineers): "keeping documentation up to date" is the most common challenge. Next come lack of standards and consistency, finding the right level of detail, and time/resource constraints. No percentages are given for the challenges. — [IcePanel 2025 survey](https://icepanel.io/blog/state-of-software-architecture-survey-2025)
- Same survey, tools used: diagramming tools 87%, collaborative wikis 79%, modelling tools 65% (64% in 2024), "AI/LLMs and diagrams-as-code" 44% (new option; the article labels this figure inconsistently), physical whiteboards 40%. — [IcePanel 2025](https://icepanel.io/blog/state-of-software-architecture-survey-2025)
- Source of truth for architecture: collaborative wiki 42% (29% in 2024), dedicated tool 24% (down from 37%), no single source 19%, code/informal 11%. Docs are updated monthly 26%, quarterly 23%, annually 23%, weekly 23%. ADRs are used by 48%. — [IcePanel 2025](https://icepanel.io/blog/state-of-software-architecture-survey-2025)
- C4 usage: context diagrams 81%, container 79%, component 41%. Supplementary dynamic/flow diagrams 28%, system landscape 27%. Over 70% are moderately or very confident with C4. — [IcePanel 2025](https://icepanel.io/blog/state-of-software-architecture-survey-2025)
- 2024 edition: 96% used diagramming tools and 79% collaborative wikis. — [IcePanel 2024](https://icepanel.io/blog/2024-11-26-state-of-software-architecture-2024)
- HN "Ask HN: What do you use to create diagrams?" (March 2025), approximate mention counts: Mermaid ~12, Excalidraw ~9, Graphviz ~8, draw.io ~7, PlantUML ~5, PowerPoint ~4, Visio ~4, Lucidchart ~3, TikZ ~3, D2 ~3, Miro/Keynote/Cloudcraft ~2 each, Structurizr/Archi/yEd once each. — [HN 43343473](https://news.ycombinator.com/item?id=43343473)
- Quotes from the same thread:
  - "having it versioned as text is the big win" (versioning is the reason to use Mermaid).
  - "a single new connection can blow up the whole layout" (Mermaid auto-layout is unstable).
  - Visual editors "are all too fiddly and trying to use them requires a lot of yak-shaving".
  - Mermaid "even the CLI goes and runs Chrome, which feels insane" (headless-browser rendering is heavy).
  - Graphviz output is seen as too amateurish for slides.
  - Keeping diagrams in sync needs CI, for example publishing to Confluence.
  - Cloudcraft is priced too high for small teams.
  — [HN 43343473](https://news.ycombinator.com/item?id=43343473)
- Simon Brown (C4 author) argues against Visio, draw.io and Lucidchart for software architecture: copy-pasting elements between diagrams violates DRY, so he recommends model-based tools such as the Structurizr DSL, which can drive PlantUML, Mermaid and others. — [dev.to, Simon Brown](https://dev.to/simonbrown/visio-draw-io-lucidchart-gliffy-etc-not-recommended-for-software-architecture-diagrams-4bmm); [dev.to, which tool](https://dev.to/simonbrown/software-architecture-diagrams-which-tool-should-we-use-29e)
- Thoughtworks Radar put "Diagrams as code" in Trial (28 Oct 2020), naming Diagrams (mingrammer), Structurizr DSL, AsciiDoctor Diagram, WebSequenceDiagrams, PlantUML and Graphviz. D2 got its own Tools blip in April 2025, praised for readable, declarative syntax "specifically designed for software documentation and architecture diagrams". Neither blip is on the current Radar edition. — [Radar: diagrams as code](https://www.thoughtworks.com/radar/techniques/diagrams-as-code); [Radar: D2](https://www.thoughtworks.com/en-gb/radar/tools/d2)
- Reddit (Jan to Apr 2026 snapshots):
  - draw.io is "good enough" and free, and exports SVG.
  - Visio is "for corporate stuff".
  - Fancy stencils are "overkill unless you're billing a client".
  - Miro gets expensive on premium plans.
  — [Reddit snapshot Jan 2026](https://reddit.sentinel-team.org/posts/1qqqlmb/snapshots/2026-01-31T03%3A00%3A37.205841Z); [Reddit snapshot Apr 2026](https://reddit.sentinel-team.org/posts/1soylau/snapshots/2026-04-18T16%3A23%3A18.625438Z)

### Inferences
- Wikis gaining as the source of truth (29% to 42%) while dedicated tools fell (37% to 24%) suggests architects want diagrams to live where docs already live, not in a separate SaaS. That favours a tool whose output embeds in Confluence, Notion, GitHub and MkDocs, and argues against a destination app.
- The two main complaints pull against each other: hand-drawn tools are too fiddly and auto-layout is unstable. Linework's model (auto-layout plus pins kept in a sidecar file) answers both directly. "Adding one edge doesn't reshuffle the diagram" should be a headline claim, and it needs to be demonstrable.
- Survey samples are small. IcePanel's n=75 is vendor-run and C4-biased, so the percentages are directional only.

### Gaps
- The Stack Overflow Developer Survey 2025 has no diagram-tool question that I could find. I didn't verify this exhaustively.
- I found no quantified survey of "diagram staleness" (for example, the share of diagrams that are out of date).
- I only fetched the 2025 HN thread. Earlier threads (2021 "what diagrams do you use", 2024) were not fetched.

## 2. Consultants' workflow needs (branding, slides, Confluence/SharePoint, PDF)

### Takeaway
I found little direct evidence. Practitioners do say client-facing work needs polished, presentation-grade output (Lucidchart, draw.io, PowerPoint, Visio), and that sketchy or Graphviz-style output isn't acceptable for official documents or presentations.

### Cited Findings
- On HN, client-facing slides are made with Lucidchart or draw.io. PowerPoint (~4 mentions) and Keynote (~2) still appear as diagram tools. — [HN 43343473](https://news.ycombinator.com/item?id=43343473)
- Excalidraw-style sketches "might work in an email or a design document somewhere—but it probably won't in a presentation or for official documentation". — [A Cloud Guru / Pluralsight ranking](https://www.pluralsight.com/resources/blog/cloud/the-top-cloud-diagramming-tools-ranked)
- Vendor icon libraries (AWS, Azure, GCP, Kubernetes) are a key differentiator in cloud diagramming reviews (Lucidchart, Cloudcraft, draw.io stencils). — [Red Hat: diagramming tools for cloud infra](https://www.redhat.com/en/blog/diagramming-tools-cloud-infrastructure); [Pluralsight](https://www.pluralsight.com/resources/blog/cloud/the-top-cloud-diagramming-tools-ranked)
- "There is no audience-independent architecture view": keep one model and project audience-specific views from it. — [Kore Nordmann](https://kore-nordmann.de/blog/there-is-no-audience-independent-architecture-view.html)
- An Indie Hackers thread asks how founders and architects create client-facing system diagrams in 2025. I did not fetch it. — [Indie Hackers](https://www.indiehackers.com/post/show-me-your-diagram-workflow-how-do-founders-architects-actually-create-client-facing-systems-diagrams-in-2025-93cb89c8e0)

### Inferences
- A consistent modern look by default plus themeable client branding (colours, fonts, logo) is a plausible gap. Text tools (Mermaid, PlantUML, Graphviz) are seen as ugly, and polished tools (Lucidchart, Visio) are binary and not in git. Export to SVG/PNG at slide aspect ratios (16:9), plus a PPTX export or copy-paste-friendly SVG, is likely table stakes for consultants.
- Official Azure and Kubernetes icon sets are expected in cloud diagrams. Check the icon licences before bundling them in an MIT repo.

### Gaps
- I found no survey data on consultant needs (branding, PPTX export, SharePoint/Confluence embedding). This needs primary interviews.
- I did not research Confluence or SharePoint marketplace usage figures for diagram apps (for example, draw.io for Confluence install counts).

## 3. Developer workflows (docs-as-code, GitHub rendering, PR review, CI, editors)

### Takeaway
Native rendering on GitHub is the biggest distribution lever in this space. Mermaid's rendering in GitHub Markdown (since Feb 2022) made it the default text format. Developers want text in git, CI rendering and readable diffs. Heavy renderers (headless Chrome) are a complaint.

### Cited Findings
- GitHub announced native Mermaid rendering in Markdown on 14 Feb 2022 (files, issues, PRs, discussions). Gists followed on 28 Feb 2022. — [GitHub blog](https://github.blog/2022-02-14-include-diagrams-markdown-files-mermaid); [changelog 2022-02-28](https://github.blog/changelog/2022-02-28-gists-now-support-mermaid-diagrams/)
- Developers choose text formats for versioning and diffability. Binary formats push teams to text. CI pipelines keep docs in sync. — [HN 43343473](https://news.ycombinator.com/item?id=43343473)
- Mermaid's integration with note-taking tools and its easy versioning are cited as its advantages. — [HN 43343473](https://news.ycombinator.com/item?id=43343473)
- D2 0.7 added a `suspend` keyword so one model can be reused across views, which shows developer demand for a model plus views in plain text. — [D2 blog: C4](https://d2lang.com/blog/c4/)
- Kroki (a unified rendering API for many diagram languages) has 4,402 stars and is MIT. It serves as integration glue for docs pipelines. — GitHub API, yuzutech/kroki, 2026-11-09

### Inferences
- Linework can't get native GitHub rendering, which is limited to Mermaid. Workable alternatives:
  1. A GitHub Action that renders SVGs and commits or attaches them.
  2. A PR bot that posts before/after images (visual diff).
  3. Export to Mermaid as a fallback.
  4. A Kroki-compatible endpoint.
- A pure-JS/TS renderer with no headless browser in the CLI is a real selling point, because people complain that Mermaid's CLI launches Chrome.
- Plugins for VS Code preview, MkDocs and Docusaurus are expected in docs-as-code workflows. I found no adoption numbers for them in this research (see Gaps).

### Gaps
- I didn't collect VS Code Marketplace install counts for the Mermaid, D2 or draw.io extensions.
- I found no evidence on how widespread visual-diff PR review tools are.

## 4. AI angle (LLMs writing diagrams, MCP servers)

### Takeaway
LLM-generated diagrams are mainstream practice in 2026. People draft Mermaid with an LLM, and "diagram generation" is the top AI use in IcePanel's survey. In 2026 the major canvas tools shipped official MCP servers or apps, and these drew thousands of stars within months. Mermaid is the format LLMs write most fluently, but IBM found significant quality gaps even there.

### Cited Findings
- IcePanel 2025: 37% use AI somewhere in their architecture workflow, 33% are exploring it, and 19% haven't. Top uses are diagram generation, documentation creation and summarisation, design validation, and research. — [IcePanel 2025](https://icepanel.io/blog/state-of-software-architecture-survey-2025)
- HN users ask ChatGPT or Claude to write Mermaid (or TikZ in Cursor) because they "can't be bothered to learn the syntax". — [HN 43343473](https://news.ycombinator.com/item?id=43343473)
- MermaidSeqBench (IBM, NeurIPS 2025 workshop, arXiv 2511.14967): 132 natural-language-to-Mermaid sequence diagram samples, scored by an LLM judge on six criteria. It reports "significant capability gaps across models". Before it, no public benchmark existed for this task. — [arXiv 2511.14967](https://arxiv.org/abs/2511.14967)
- A practitioner says LLMs generate diagram text well "but these tools don't understand the C4 model and don't respect its rules". — [Patreon: AI vs architecture diagrams, part 3](https://www.patreon.com/posts/152027514)
- There is a dev.to analysis of diagram tools by token efficiency for the LLM age. I didn't fetch it. — [dev.to](https://dev.to/akari_iku/analyzing-the-best-diagramming-tools-for-the-llm-age-based-on-token-efficiency-5891)
- Official draw.io MCP (jgraph/drawio-mcp):
  - Repo created 2 Feb 2026; 5,799 stars by 9 Nov 2026.
  - Two forms: a stdio tool server (`@drawio/mcp`) that opens diagrams in the editor and accepts XML, CSV and Mermaid, and a hosted MCP App at mcp.draw.io/mcp that renders inline in chat.
  — GitHub API 2026-11-09; [github.com/jgraph/drawio-mcp](https://github.com/jgraph/drawio-mcp); [npm README](https://cdn.jsdelivr.net/npm/@drawio/mcp@1.5.0/README.md)
- Official Excalidraw MCP App (excalidraw/excalidraw-mcp, "Fast and streamable Excalidraw MCP App", mcp.excalidraw.com): repo created 4 Feb 2026, 5,656 stars. It is listed in Claude's connector directory with streaming, an interactive editor and checkpoints. — GitHub API 2026-11-09; [Claude connector listing](https://claude.com/connectors/excalidraw-app-demo)
- Community MCP servers, star counts on 2026-11-09 (GitHub API):
  - yctimlin/mcp_excalidraw: 2,631 (created Mar 2025)
  - lgazo/drawio-mcp-server: 1,498 (Apr 2025)
  - hustcc/mcp-mermaid: 649 (May 2025)
- tldraw "make-real" (sketch to working UI via LLM, Nov 2023) has 5,414 stars, an early viral AI demo for canvas tools. — GitHub API 2026-11-09

### Inferences
- An official MCP server is now table stakes. draw.io and Excalidraw each reached about 5.7k stars in roughly nine months, which is about 60% of draw.io's main repo (9.3k). Linework should ship an MCP server from day one, ideally as an MCP App that renders inline and writes YAML. The YAML-plus-validator design is a fit: an agent can write YAML, get schema or validation errors back, and iterate.
- For LLM reliability, a strict, documented JSON Schema for the YAML, with clear errors, matters more than how terse the syntax is. Publishing an llms.txt or a short "spec for agents" would help.
- Domain semantics (C4 rules, ODCS contracts, Kubernetes kinds) are where LLM-written generic Mermaid falls short. Typed diagram kinds can enforce them.

### Gaps
- I found no head-to-head benchmark of LLM reliability across Mermaid, D2, PlantUML and YAML formats.
- I couldn't find install or usage counts for the MCP servers, only stars.

## 5. What made OSS diagram tools grow (stars, integrations, licences, business models)

### Takeaway
Growth came from embedding and distribution, not standalone apps:
- Mermaid had GitHub native rendering and was everywhere in Markdown.
- Excalidraw had a zero-friction web app, a beloved look, an embeddable React component and an MIT licence.
- draw.io was free, offline, and on Confluence and desktop.

Monetisation is hard. Mermaid Chart went open core with VC funding. tldraw moved to a restrictive source-available licence. Terrastruct (D2) shut down in Sept 2026 and open-sourced its paid layout engine.

### Cited Findings
- GitHub stars on 2026-11-09 (GitHub API):

  | Repo | Stars | Created | Licence |
  |---|---|---|---|
  | excalidraw/excalidraw | 135,388 | Jan 2020 | MIT |
  | mermaid-js/mermaid | 91,051 | Nov 2014 | MIT |
  | jgraph/drawio-desktop | 63,910 | — | GPL-3.0 |
  | jgraph/drawio | 9,272 | — | Apache-2.0 |
  | tldraw/tldraw | 51,432 | — | custom licence |
  | mingrammer/diagrams | 42,800 | 2020 | MIT |
  | d2lang/d2 | 25,815 | Sept 2022 | MPL-2.0 |
  | plantuml/plantuml | 13,408 | — | LGPL-3.0 |
  | likec4/likec4 | 6,047 | Mar 2023 | MIT |
  | yuzutech/kroki | 4,402 | — | MIT |
  | structurizr/java | 1,136 | — | Apache-2.0 |
  | structurizr/structurizr | 525 | Nov 2025, new consolidated repo | Apache-2.0 |

- Mermaid's star count was cited as about 74k in early 2025 and is 91k now, roughly +17k in under two years. — [Wikiwand: Mermaid](https://www.wikiwand.com/en/articles/Mermaid_(software)) (early-2025 figure is secondary); GitHub API
- Mermaid Chart: open-core company around Mermaid.
  - $7.5M seed (announced 20 Mar 2024) from OCV, Sequoia, Microsoft M12 and angels.
  - Revenue was "basically none" when CEO Andrew Firestone joined. The open-source project had "hundreds of thousands of users".
  - Planned products: AI diagramming, automated documentation.
  - CB Insights lists $9.5M across 3 rounds, which conflicts with the $7.5M figure.
  — [TechCrunch](https://techcrunch.com/2024/03/20/mermaid-chart-a-markdown-like-tool-for-creating-diagrams-raises-5-5m/amp); [OCV, 7 May 2025](https://opencoreventures.com/insights/mermaid-chart-from-open-source-project-to-raising-a-7-5m-seed-round); [CB Insights](https://www.cbinsights.com/company/mermaid-chart/financials)
- tldraw licence history:
  - v3 (2024): free for any use with a visible "Made with tldraw" watermark; a business licence removed it.
  - SDK 4.0 (Sept 2025): production use requires a licence key. Commercial licences are required for commercial production. Hobby licences are discretionary. There is a 100-day trial.
  — [tldraw v3 release](https://tldraw.dev/releases/v3.0.0); [tldraw licence update blog](https://tldraw.dev/blog/license-update-for-the-tldraw-sdk); [AlternativeTo, Sept 2025](https://alternativeto.net/news/2025/9/tldraw-sdk-4-0-adds-five-new-starter-kits-cli-tool-and-enforces-licensing-changes); [tldraw licence](https://tldraw.dev/legal/tldraw-license)
- D2/Terrastruct:
  - D2 was funded as the open-core arm of Terrastruct, with revenue from the closed-source D2 Studio IDE and the proprietary TALA layout engine. TALA rendered with a watermark without a licence. A snapshot showed D2 Studio at about $20 and $30 per user per month.
  - 5 Sept 2026: "The company is shutting down". D2 became a non-profit project fiscally sponsored by Hack Club. D2 Studio is to become purely client-side and offline, with no servers or accounts.
  - 7 Sept 2026: TALA was open-sourced (MPL-2.0) and bundled into D2 v0.9.0. No business reasons were given.
  — [D2 is non-profit](https://d2lang.com/blog/d2-non-profit/); [TALA is open source](https://d2lang.com/blog/tala-is-open-source/); [RuntimeWire](https://runtimewire.com/article/terrastruct-open-sources-tala-alexander-wang-winds-down-business); [costbench (pricing, secondary)](https://costbench.com/software/diagramming/terrastruct/hidden-costs/)
- Thoughtworks Radar coverage (diagrams-as-code 2020, D2 2025) gave these tools credibility with architects. — [Radar](https://www.thoughtworks.com/radar/techniques/diagrams-as-code); [Radar D2](https://www.thoughtworks.com/en-gb/radar/tools/d2)

### Inferences
- The biggest OSS winners are MIT or permissive, and they are libraries or embeds as well as apps (Excalidraw component, Mermaid.js). An MIT licence plus an embeddable renderer package (`npm i @linework/render`) follows that pattern.
- Selling a proprietary layout engine or IDE on top of an OSS language (TALA, D2 Studio) did not sustain Terrastruct. Mermaid Chart (hosted collaboration and AI on top of a free format) is still the funded model. tldraw chose licence enforcement. Linework, as a personal project, can stay pure MIT. If it ever monetises, the evidence points to hosted collaboration or AI services, not closed layout engines.
- Opportunity: D2's commercial steward has gone. Users who want polished architecture layouts in text may be looking for an actively developed alternative. LikeC4 (6k stars, MIT) is a direct competitor on "model plus views, modern look".

### Gaps
- I didn't fetch a star-history time series (star-history.com), so growth curves are inferred only from two data points.
- I found no Excalidraw+ revenue or user data.
- Mermaid Chart's 2025–2026 status (revenue, further funding) wasn't found.

## 6. Features people repeatedly ask for

### Takeaway
The recurring asks:
- One model with many views
- Drill-down and zoom between levels (C4 context to container to component)
- Dynamic or flow, step-through diagrams (28% use them per IcePanel)
- Audience-specific views
- Stable layout, presentation-grade looks
- Less duplication across diagrams

There was weaker evidence for live data, search across diagrams and links between diagrams.

### Cited Findings
- Structurizr: "you write Structurizr DSL to create multiple software architecture diagrams from a single model". Its browser viewer offers double-click to zoom (drill-down). — [structurizr.com](https://structurizr.com/); [Structurizr features](https://docs.structurizr.com/features)
- Elements are defined once in the model, and when one changes, every diagram that includes it re-renders. — [Write the Docs 2020, Avi Flax](https://writethedocs-www.readthedocs.io/videos/portland/2020/set-your-data-free-with-model-based-architecture-diagramming-avi-flax/)
- Model reuse across views was added to D2 0.7 (`suspend`). — [D2 C4 blog](https://d2lang.com/blog/c4/)
- Dynamic diagrams / IcePanel Flows (step-through) are used by 28%, and system landscape diagrams by 27%. — [IcePanel 2025](https://icepanel.io/blog/state-of-software-architecture-survey-2025)
- "Pick one, draw its many children" instead of mega-diagrams; drill from global topology to local detail, including in slides. — [Visual Paradigm C4 guide](https://www.visual-paradigm.com/guide/mastering-software-architecture-the-c4-models-1-selective-decomposition-with-visual-paradigm-ai-vpascode-and-opendocs/)
- DRY across diagrams is the core critique of freeform tools. — [Simon Brown, dev.to](https://dev.to/simonbrown/visio-draw-io-lucidchart-gliffy-etc-not-recommended-for-software-architecture-diagrams-4bmm)
- Stable layout when adding edges is asked for, and there is an unmet ask for easy maths diagrams (niche). — [HN 43343473](https://news.ycombinator.com/item?id=43343473)

### Inferences
- Linework's nine typed diagram kinds are separate today. A shared element catalogue (for example, one Azure resource that appears in the network, roles and data-product diagrams), with cross-diagram links, drill-down and a step-through "flow" overlay, would hit the most-requested model-and-views features.
- Step-through or animation also serves the consultant presentation use case (walking a client through a flow).

### Gaps
- I found no source quantifying demand for live data (for example, diagrams bound to cloud inventory or Kubernetes cluster state), search across diagrams, or animation beyond IcePanel Flows. That would need GitHub issue mining (Mermaid, D2, Excalidraw feature-request upvotes), which wasn't done.
