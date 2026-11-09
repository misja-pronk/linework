# Visual / canvas architecture diagramming tools (as of Nov 2026)

Scope: draw.io, Lucidchart/Lucidscale, Excalidraw, tldraw, Miro, Whimsical, Eraser (canvas side), IcePanel, Cloudcraft, Hava, Brainboard, Napkin AI, Visio, and live-infra / IaC diagram generators (Hava, Cloudcraft, Cloudockit, Pluralith, Rover, Inkdrop, TerraVision, Azure portal visualiser, AzViz). Research date 2026-11-09. Many price figures come from aggregators (toolradar, costbench, gappsy), because several vendor pricing pages hide prices behind JS or a contact form. Treat aggregator figures as approximate.

## Strengths, weaknesses, pricing and licence per tool

### Takeaway
The market splits three ways. Free or cheap general canvases (draw.io, Excalidraw, Visio, Lucidchart, Miro, Whimsical) are flexible but have no model behind them. Modelled architecture tools (IcePanel) are paid SaaS. Live-infra generators (Cloudcraft, Hava, Lucidscale, Brainboard) are tied to AWS/Azure and priced per seat or per resource. No tool covers many diagram domains (cloud + K8s + ERD + RBAC + git flow + journeys) with one consistent modern look and a text source of truth.

### Cited Findings
**draw.io / diagrams.net**
- Widely seen as free with no limits: "free forever, no account, no limits, offline desktop app" — [softwaremany comparison](https://softwaremany.pages.dev/blog/2025-10-20-diagramming-tools-comparison/); "hard to beat for solo users" — [dupple](https://dupple.com/learn/best-diagram-tools)
- Its UI is described as less modern than Lucidchart's (competitor-written) — [lucid.co blog](https://lucid.co/blog/reasons-to-use-lucidchart-vs-drawio); Lucid also claims draw.io lacks shape-specific comments and revision history (vendor claim) — [Lucidchart vs draw.io](https://www.lucidchart.com/pages/lucidchart-vs-draw-io)
- Official AI "Generate" tool announced 2026-01-15; prompts go to third-party AI, diagram data is not stored on draw.io servers — [drawio-app.com](https://drawio-app.com/blog/the-generate-tool-in-draw-io/). It uses Anthropic Claude models, which return mxGraph XML rendered as an editable diagram — [drawio.com AI models](https://www.drawio.com/docs/manual/generate/ai-models/). Admins can configure LLM backends and their own keys — [drawio.com config](https://www2.drawio.com/doc/faq/configure-ai-options)
- Community ecosystem: next-ai-draw-io (Apache-2.0) — [signpath](https://signpath.org/projects/next-ai-draw-io); an AWS sample draw.io MCP server with AWS icons — [aws-samples](https://aws-samples.github.io/sample-drawio-mcp/icons/AWS); an AWS Builder article on modernising legacy diagrams with Amazon Q CLI + MCP + draw.io — [builder.aws.com](https://builder.aws.com/content/2yDge5CvqamyM7IcgfK6el98tOc/modernize-legacy-aws-architecture-diagrams-with-amazon-q-cli-mcp-server-and-drawio)
- Licence: see Gaps (not verified this session).

**Lucidchart / Lucidscale**
- Individual about $9/mo, Team about $10/user/mo billed annually (May–Oct 2026 snapshots); Lucid AI is included in the Free plan — [costbench](https://costbench.com/software/diagramming/lucidchart/); Vendr says Lucidscale Team costs more than Lucidchart Team, with a $9–20/user/mo range across the line — [Vendr](https://www.vendr.com/marketplace/lucid-software)
- Lucidscale "Cloud Accelerator" connects to AWS accounts or a whole AWS organisation; "refresh the data and the models stay in sync" — [Lucid community](https://community.lucid.co/news-and-announcements-9/visualize-cloud-infrastructure-with-the-cloud-accelerator-10391). Miro says Lucidscale is "an added licensing cost" (competitor claim) — [Miro compare](https://miro.com/compare/miro-vs-lucidchart/diagramming)

**Excalidraw / Excalidraw+**
- Excalidraw+ about $6–7/user/mo (toolradar read the vendor page on 2026-10-06: $7 monthly, $6 yearly); costbench logs a June 2026 price cut to $6 — [toolradar](https://toolradar.com/compare/excalidraw-vs-miro); [costbench changelog](https://costbench.com/changelog/excalidraw-price-decrease-2026-06/)
- Weaknesses: no snap-to-grid by default, no browsable shape libraries, no UML notation modes; "for professional architecture documentation, it is not a fit… does not produce the polished output Lucidchart delivers" — [dupple](https://dupple.com/learn/best-diagram-tools); [Miro alternatives page](https://miro.com/al/excalidraw-alternatives/)

**tldraw**
- Since SDK 4.0 (Sept 2025) it ships under the "tldraw license", not MIT. Production use needs a commercial licence. There is a 100-day trial and a free hobby licence with a "made with tldraw" watermark — [tldraw.dev/pricing](https://tldraw.dev/pricing); [appdevelopermagazine](https://appdevelopermagazine.com/tldraw-sdk-4.0-release-new-starter-kits-and-licensing-model/)
- Commercial price is not published. One third-party claim says "from $6,000/year" (unverified) — [aitoolsatlas](https://aitoolsatlas.ai/tools/tldraw/pricing)

**Miro**
- Starter $8, Business $20 per member/mo (monthly billing, vendor page read 2026-10-30); Enterprise custom — [toolradar](https://toolradar.com/compare/miro-vs-excalidraw). Every editor on a paid tier is billed: "a team that pulls a lot of occasional contributors onto paid seats watches the bill climb fast" — [thefrontkit](https://thefrontkit.com/blogs/miro-alternatives-2026)
- The AWS shape pack and AWS templates require Business or Enterprise. "AWS Cloud View" auto-imports AWS data (vendor copy; sync model unclear) — [miro.com/cloud-visualization](https://miro.com/cloud-visualization/)
- IcePanel's view (competitor): Miro is not built for software architecture — [IcePanel blog](https://icepanel.io/blog/2025-11-25-best-alternatives-to-miro-for-software-architecture-diagramming)

**Whimsical**
- Pro $10/editor/mo, Business $20/editor/mo billed annually; free tier exists — [rework](https://resources.rework.com/tools/design-creative/best-whimsical-alternatives); [toolradar](https://toolradar.com/tools/whimsical/pricing). Ships an Azure icon template — [whimsical.com](https://whimsical.com/templates/microsoft-azure-icons)

**Eraser.io**
- Free plan: 3 files, 3 AI credits, 7-day history, unlimited guests — [eraser.io/pricing](https://eraser.io/pricing). Pro $10/editor/mo (toolradar, Oct 2026) — [toolradar](https://toolradar.com/tools/eraser-io/pricing). Usage-based AI credit top-ups on paid plans — [docs](https://docs.eraser.io/usage-based-pricing). API: $20 per 100 render calls; a prompt endpoint generates diagrams — [eraser docs](https://docs.eraser.io/usage-based-pricing)
- Named "top pick for technical diagrams" (Oct 2026); diagram-as-code on every plan — [dupple AI tools](https://dupple.com/learn/best-ai-diagram-tools)
- "Eraserbot" updates docs and diagrams on every PR — [eraser.io/product/eraserbot](https://www.eraser.io/product/eraserbot); a published "terraform-diagrams" agent skill — [tessl](https://tessl.io/registry/skills/github/eraserlabs/eraser-io/terraform-diagrams)

**IcePanel**
- Free tier; Growth about $50/mo and Scale about $77/mo (toolradar, checked 2026-10-26). Other directories list about $20/mo (likely stale). The official page shows a contact form only — [toolradar](https://toolradar.com/tools/icepanel/pricing); [icepanel.io/pricing](https://icepanel.io/pricing)
- Model-based C4: covers all levels "except for Level 4". There are no C4 dynamic diagrams; Flows replace them. PlantUML/Mermaid export only for Flows — [IcePanel vs Structurizr](https://icepanel.io/blog/2025-11-14-icepanel-vs-structurizr); [dynamic diagrams](https://icepanel.io/blog/2024-09-12-dynamic-diagrams-C4-model)
- Overlays (tags/status layers) reduce maintenance — [dev.to/icepanel](https://dev.to/icepanel/less-maintenance-of-software-diagrams-with-overlays-1kbb)
- Few independent reviews: Product Hunt shows 5.0 from 1 review; G2 is thin — [Product Hunt](https://www.producthunt.com/products/icepanel/reviews); [G2](https://www.g2.com/products/icepanel/reviews). A customer interview shows real modelling friction (shared DBs, topics/queues, vague boundaries) — [IcePanel blog](https://icepanel.io/blog/ice-breaker-jason-adopting-c4-model-at-scale)

**Cloudcraft (Datadog)**
- The current pricing page says "Cloudcraft is free in Datadog": unlimited users and diagrams with any Datadog subscription. Modules: Infrastructure, Monitors, Logs, Cloud Cost, Security. Some modules need the matching Datadog subscription — [cloudcraft.co/pricing](https://cloudcraft.co/pricing) (fetched 2026-11-09)
- Older or third-party standalone figures (Pro about $40.83/user/mo annually or $99 monthly; Enterprise about $100) may be outdated given the above — [gappsy](https://gappsy.com/tools/cloudcraft/). Live AWS sync is listed as a Cloudcraft feature — [G2 compare](https://www.g2.com/compare/cloudcraft-vs-lucid-software-inc-lucid-visual-collaboration-suite-vs-miro). Datadog positions it for cost and compliance overlays — [Datadog blog](https://www.datadoghq.com/blog/cloud-architecture-diagrams-cost-compliance-cloudcraft-datadog.md)

**Hava.io**
- From about $44–59/mo with a 14-day trial; exports are disabled in the trial (TechYorker, 2026-10-09). Figures conflict across aggregators — [techyorker](https://techyorker.com/products/hava/); [saasworthy](https://www.saasworthy.com/product/hava-io)
- Azure works through a read-only service principal and auto-generates network topology and security-group diagrams per VNet — [hava.io blog](https://www.hava.io/content/building-azure-cloud-diagrams). CI/CD (GitHub Actions, Terraform) auto-generation and a diagram API — [hava.io](https://hava.io/); [API blog](https://www.hava.io/blog/quickest-way-to-create-an-azure-diagram). Cost estimates match only standard pricing for detected resources — [docs](https://docs.hava.io/diagnose/cost-estimation)

**Brainboard**
- Free tier ($0, no card). Importing from cloud providers carries a separate per-resource fee — [brainboard.co/pricing](https://brainboard.co/pricing). Brainboard says draw.io is fine for one-off diagrams but has "no connection to the actual infrastructure" (vendor framing) — [Brainboard blog](https://www.brainboard.co/blog/how-to-reverse-engineer-your-existing-aws-infrastructure-into-a-visual-diagram)

**Napkin AI**
- Credit-based; the free tier gives about 500 credits/week but adds Napkin branding to exports; paid from about $10–12/mo (conflicting) — [fast.io review](https://fast.io/resources/napkin-ai-review-2026/); [dev.to review](https://dev.to/techsifted/napkin-ai-review-march-2026-turn-text-into-visuals-instantly-97i)
- Fast text-to-visual; auto-layouts "often need manual adjustment"; not for high-polish or complex customisation — [techpresso](https://academy.techpresso.co/reviews/is-napkin-ai-worth-it); [dupple](https://dupple.com/reviews/napkin)

**Microsoft Visio**
- Plan 1 $5/user/mo (web only), Plan 2 $15/user/mo (desktop); basic "Visio in Microsoft 365" free with M365 (costbench cross-check 2026-07-14). G2 lists $15/$20 (outlier) — [costbench](https://www.costbench.com/software/diagramming/visio/); [G2](https://www.g2.com/products/visio/pricing)
- Microsoft no longer ships Azure icons as Visio stencils, only SVG — [Azure icons page](https://learn.microsoft.com/en-us/azure/architecture/icons/)

**IaC / live-infra generators**
- Pluralith: Terraform-plan diagrams, drift detection, plan-change highlighting. `pluralith apply` is deprecated in favour of `pluralith graph`. Listed as Alpha around 2024 (YC company) — [pluralith-cli listing](https://awesome.ecosyste.ms/projects/github.com%2FPluralith%2Fpluralith-cli); [docs](https://docs.pluralith.com/docs/commands/graph)
- Rover: free, reads plan JSON; more setup and local resources than a hosted tool — [phoenixNAP (2026)](https://phoenixnap.com/kb/terraform-visualization)
- Inkdrop: CLI (`terraform plan -out plan.out && inkdrop plan.out`) opens an interactive local web UI on :3000. Install via brew/npm/Docker; supports multiple state dirs — [inkdrop-visualizer](https://hn.jakechampion.name/reader/https://github.com/inkdrop-org/inkdrop-visualizer)
- TerraVision: open-source CLI from Terraform code; outputs editable .drawio — [github.com/patrickchugh/terravision](https://github.com/patrickchugh/terravision)
- Azure: portal "Export template → Visualize template" draws an ARM-based diagram, rearrangeable and saveable as PNG — [Medium](https://medium.com/os-techblog/3-ways-to-visualise-your-azure-resources-2540742d8844). Legacy armviz.io — [MS archive blog](https://learn.microsoft.com/en-us/archive/blogs/azureedu/how-can-i-map-my-existing-azure-arm-resources-visually). AzViz PowerShell (`Export-AzViz -ResourceGroup … -Theme light -OutputFormat png`) — [dev.to](https://dev.to/prateeksingh/azure-visualizer-automated-diagrams-using-powershell-1m95). Microsoft's own "azure-resource-visualizer" agent skill queries a resource group and writes a Mermaid diagram plus an inventory table — [azure.github.io git-ape](https://azure.github.io/git-ape/docs/skills/azure-resource-visualizer)

### Inferences
- Per-seat pricing clusters at $6–20/editor/mo for canvases. Infra-sync tools cost more ($44–100+/mo) or are bundled (Cloudcraft is now effectively a Datadog feature, which is a lock-in vector).
- tldraw's licence change makes it a risky base for an OSS tool's editor. Excalidraw (MIT, per general knowledge) or a custom canvas is safer.
- The "generator" tools (Rover, Inkdrop, Pluralith, TerraVision, AzViz, portal visualiser) give accurate but ugly, dependency-graph-style output. They are not presentation-ready, which is the gap Cartography targets.

### Gaps
- draw.io core licence and contribution policy were not verified this session. From memory, jgraph/drawio is Apache-2.0 and "open source, not open contribution". Verify at https://github.com/jgraph/drawio.
- Excalidraw licence (MIT) was not re-verified this session.
- Cloudockit pricing and features: no results found.
- Official pricing pages for IcePanel, Hava and Lucidscale did not render. All their figures are from aggregators.
- Whether Pluralith and Rover are still maintained (GitHub archive status) was not confirmed.

## Recurring complaints (dated look, alignment drudgery, staleness, VCS, lock-in, seats, icon licensing)

### Takeaway
The strongest, most citable complaints are staleness ("diagrams never match reality") and alignment and polish drudgery in general canvases. Unreadable diffs and the lack of a model come next, as Simon Brown argues. Seat pricing (Miro) and icon terms are secondary but real.

### Cited Findings
- Simon Brown (2020-07-04) on general canvases: (1) no guidance or rule enforcement, "boxes and lines"; (2) content and presentation are mixed, so audience variants are hard; (3) no model, so copy-paste "violate[s] the DRY principle"; (4) files are hard to diff; (5) little automation; (6) "Creating good looking diagrams… is very time consuming", since text overflow breaks alignment. Commenters push back that canvases suit quick sketches — [dev.to/simonbrown](https://dev.to/simonbrown/visio-draw-io-lucidchart-gliffy-etc-not-recommended-for-software-architecture-diagrams-4bmm)
- Staleness: "architecture diagrams have a habit of going stale the moment you redraw them" — [dev.to diagram-as-code with drawio](https://dev.to/mrduguo/diagram-as-code-with-drawio-50ea); "I got tired of my AWS diagram and my CloudFormation being different documents" — [dev.to](https://dev.to/0xarchitect/i-got-tired-of-my-aws-diagram-and-my-cloudformation-being-different-documents-32bp); "Why are architecture diagrams never [up to date]" — [Living in Software](https://livinginsoftware.substack.com/p/why-are-architecture-diagrams-never); "The architecture diagram is dead" — [madewithlove](https://madewithlove.com/blog/the-architecture-diagram-is-dead.md); Product Hunt thread "when did your architecture diagram last match the code?" — [Product Hunt](https://www.producthunt.com/p/structly-architecture-as-code/be-honest-when-did-your-architecture-diagram-last-match-the-code)
- Messy look: a 2026 Reddit snapshot (r/AZURE-style) complains that draw.io diagrams look messy even when technically correct. Advice: separate generation from cleanup; draw.io AI + Mermaid + MCP — [reddit snapshot 2026-04-18](https://reddit.sentinel-team.org/posts/1soylau/snapshots/2026-04-18T16%3A23%3A18.625438Z)
- Excalidraw: the hand-drawn look is judged not professional enough for formal documentation — [dupple](https://dupple.com/learn/best-diagram-tools)
- Seat cost: Miro bills every editor, so costs rise with occasional contributors — [thefrontkit](https://thefrontkit.com/blogs/miro-alternatives-2026). Miro gates AWS shapes behind Business — [miro.com](https://miro.com/cloud-visualization/)
- Lock-in: Cloudcraft is now sold as part of Datadog subscriptions — [cloudcraft.co/pricing](https://cloudcraft.co/pricing). Hava disables exports during the trial — [techyorker](https://techyorker.com/products/hava/)
- Azure icon terms: Microsoft permits use "in architectural diagrams, training materials, or documentation". Other copying or distribution needs permission. Don't use them to represent your own product. The Entra set says not to crop, flip, rotate or distort. A GitHub issue raised that the terms seemed to bar bundling in tools; Microsoft said it removed language requiring the icons be used only in Azure diagrams. Latest update July 2026 (10+ new icons) — [learn.microsoft.com icons](https://learn.microsoft.com/en-us/azure/architecture/icons/); [GitHub issue #2251](https://www.github.com/MicrosoftDocs/architecture-center/issues/2251); [Entra icons](https://learn.microsoft.com/en-us/entra/architecture/architecture-icons)
- AWS icon terms: AWS "allows customers and partners to use these toolkits and assets to create architecture diagrams" and mentions third-party libraries (Miro, Lucidchart). Use current icons, since some libraries ship legacy sets — [aws.amazon.com/architecture/icons](https://aws.amazon.com/architecture/icons)

### Inferences
- An OSS tool that redistributes Azure/AWS icon packs inside its repo sits in a grey zone. Safer options: download the official packs at build or install time, or let the user supply them, and keep icons unmodified (no recolouring for Entra). Wording should be checked against the Terms PDF inside the download.
- Staleness and drudgery together are the strongest pitch: text source + auto-layout + import from IaC.

### Gaps
- No direct, readable Reddit or HN threads with vote counts; only mirrored snapshots. G2/Capterra review themes for draw.io and Lucidchart were not pulled in detail.
- Full text of the Azure icon Terms of Use PDF was not read.

## Most praised features

### Takeaway
Users praise draw.io for free/offline/no-account use, Excalidraw for its sketch aesthetic and speed, IcePanel for its model with reusable objects plus Flows and overlays, Cloudcraft and Hava for live sync with cost and security overlays, Miro and Lucid for real-time collaboration, and Eraser for diagram-as-code + AI on a canvas.

### Cited Findings
- draw.io free, offline, unlimited — [softwaremany](https://softwaremany.pages.dev/blog/2025-10-20-diagramming-tools-comparison/)
- Lucidchart: real-time collaboration, integrations, comments (vendor claim) — [lucidchart.com](https://www.lucidchart.com/pages/lucidchart-vs-draw-io)
- IcePanel G2 review praises customisability via model reuse — [G2](https://www.g2.com/products/icepanel/reviews)
- Cloudcraft live AWS sync — [G2 compare](https://www.g2.com/compare/cloudcraft-vs-lucid-software-inc-lucid-visual-collaboration-suite-vs-miro); cost/compliance overlays — [Datadog blog](https://www.datadoghq.com/blog/cloud-architecture-diagrams-cost-compliance-cloudcraft-datadog.md)
- Eraser called "top pick for technical diagrams" — [dupple](https://dupple.com/learn/best-ai-diagram-tools)
- Napkin praised for speed and simplicity — [techpresso](https://academy.techpresso.co/reviews/is-napkin-ai-worth-it)

### Inferences
- Users want both "code-like" properties (diffable, generated, consistent) and "canvas-like" ones (pinning, nudging, pretty output). Eraser and IcePanel each cover half. A YAML-first tool with a builder that writes YAML back and manual pins aims at the intersection.

### Gaps
- No quantitative satisfaction data (NPS, review-score breakdowns by feature).

## Keeping diagrams in sync with reality

### Takeaway
Sync is either (a) live cloud APIs (Cloudcraft for AWS/Azure, Hava for AWS/Azure/GCP via read-only principals, Lucidscale for AWS orgs, Brainboard import per resource fee, Miro AWS Cloud View) or (b) IaC plan/state parsing (Pluralith, Rover, Inkdrop, TerraVision, Eraser's terraform skill, Azure portal ARM visualiser). Kubernetes-manifest import is almost absent in the canvas tools surveyed. Generated output is usually not presentation-ready.

### Cited Findings
- Hava: read-only service principal; diagrams per VNet; CI/CD integration — [hava.io](https://www.hava.io/content/building-azure-cloud-diagrams); [hava.io home](https://hava.io/)
- Lucidscale: connect AWS org, refresh to stay in sync — [Lucid community](https://community.lucid.co/news-and-announcements-9/visualize-cloud-infrastructure-with-the-cloud-accelerator-10391)
- Brainboard: per-resource import fee — [brainboard.co/pricing](https://brainboard.co/pricing)
- Common practice: generate from Terraform state or plan, commit .drawio, regenerate in CI — [TerraVision](https://github.com/patrickchugh/terravision); [HackerNoon "state-driven diagrams"](https://hackernoon.com/stop-drawing-your-infrastructure-the-shift-to-state-driven-diagrams?source=rss)
- Eraserbot updates diagrams per PR — [eraser.io](https://www.eraser.io/product/eraserbot)
- Azure portal visualiser and AzViz, from ARM / resource groups — [Medium](https://medium.com/os-techblog/3-ways-to-visualise-your-azure-resources-2540742d8844); [AzViz](https://dev.to/prateeksingh/azure-visualizer-automated-diagrams-using-powershell-1m95)
- Microsoft agent skill writes Mermaid from a live resource group — [azure-resource-visualizer](https://azure.github.io/git-ape/docs/skills/azure-resource-visualizer)

### Inferences
- An importer from Bicep/ARM/Terraform plan JSON and K8s manifests into Cartography YAML, keeping user pins on re-import, would combine the sync of generators with the polish of hand-drawn diagrams. No surveyed tool does diff-preserving re-import into a human-editable text file.

### Gaps
- Bicep-specific import in commercial tools was not found. Cloudockit details are missing. Kubernetes-manifest visualisers were outside this search's results.

## Presentation and storytelling, embedding

### Takeaway
IcePanel Flows (step-through sequences over the model) is the stand-out storytelling feature. Most canvases rely on frames or presentation mode (Miro) or embeds (draw.io/Lucid in Confluence). No tool surveyed is known for exporting a ready 16:9 slide with consistent styling.

### Cited Findings
- IcePanel Flows replace C4 dynamic diagrams; Flows export to PlantUML/Mermaid — [IcePanel blog](https://icepanel.io/blog/2025-11-14-icepanel-vs-structurizr); [dynamic diagrams](https://icepanel.io/blog/2024-09-12-dynamic-diagrams-C4-model)
- draw.io is deeply embedded in the Atlassian ecosystem; AI smart templates were refreshed for Confluence — [Atlassian community](https://community.atlassian.com/forums/App-Central-discussions/draw-io-s-AI-smart-templates-just-got-a-makeover-check-out-the/m-p/3182866)
- Napkin targets "graphics before decks" (business visuals for slides) — [implicator.ai](https://www.implicator.ai/napkin-ai-bets-workers-need-graphics-before-they-need-full-decks/)

### Inferences
- A 16:9 slide export with a consistent theme, plus step-through (Flows-like) for git flow and developer journeys, would differentiate Cartography.

### Gaps
- Animation features (Miro presentation, Excalidraw/tldraw slides, Eraser presentation) were not researched in depth. Notion/Confluence embed specifics per tool were not verified.

## AI features and quality

### Takeaway
By 2026 nearly every tool has prompt-to-diagram: draw.io Generate on Claude, Lucid AI on the free plan, Eraser credits plus an API, Napkin credits. Reviewers say the output needs manual cleanup. Text-backed formats (draw.io XML, Eraser DSL, Mermaid) make AI generation easier to edit afterwards.

### Cited Findings
- draw.io Generate (2026-01-15) on Claude → mxGraph XML — [drawio-app.com](https://drawio-app.com/blog/the-generate-tool-in-draw-io/); [drawio.com](https://www.drawio.com/docs/manual/generate/ai-models/)
- Eraser AI credits; free 3 credits; prompt API — [eraser.io/pricing](https://eraser.io/pricing); [docs](https://docs.eraser.io/usage-based-pricing)
- Napkin auto-layouts "often need manual adjustment" — [techpresso](https://academy.techpresso.co/reviews/is-napkin-ai-worth-it)
- Agent-skill and MCP trend: Microsoft azure-resource-visualizer skill, Eraser terraform-diagrams skill, AWS draw.io MCP — [azure.github.io](https://azure.github.io/git-ape/docs/skills/azure-resource-visualizer); [tessl](https://tessl.io/registry/skills/github/eraserlabs/eraser-io/terraform-diagrams); [aws-samples](https://aws-samples.github.io/sample-drawio-mcp/icons/AWS)

### Inferences
- A compact, schema-validated YAML is an ideal target for LLM/agent generation. Shipping a JSON Schema plus an MCP server or agent skill matches where the market is going.

### Gaps
- No independent benchmark of AI diagram quality across tools.

## Accessibility, dark mode, theming/branding

### Takeaway
Little citable evidence was found. AzViz offers light/dark themes; most canvases offer per-shape styling rather than global themes. This is an under-documented area and a possible differentiator.

### Cited Findings
- AzViz `-Theme light` option — [dev.to AzViz](https://dev.to/prateeksingh/azure-visualizer-automated-diagrams-using-powershell-1m95)

### Inferences
- Global tokens (light/dark/brand), WCAG-contrast-checked palettes, and SVG `<title>`/`<desc>` for screen readers would stand out, because no surveyed tool advertises them.

### Gaps
- Dark mode, brand themes and accessibility (keyboard nav, alt text, contrast) for draw.io, Lucid, Miro, Excalidraw and IcePanel were not researched with sources in this pass.
