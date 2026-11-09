# Specialist diagram niches (as of 2026-11-09)

Scope: ERD, data products/contracts, IAM, git branching, journeys, Kubernetes/network. Researched 2026-11-09 with about 18 web searches and fetches. Many sources are vendor-written (ChartDB, DrawSQL and TheyDo comparing themselves with competitors), so treat their claims as directional. Anything I could not source is under Gaps or labelled as an inference.

## Niche 1: ERD / database design

### Takeaway
The field is crowded and mature. dbdiagram.io (DBML, code-first) and ChartDB (open source, reverse-engineers a live database) lead. Users complain most about **auto-layout on large schemas**: tables packed too tightly, wasted canvas, and connector lines running under tables. Azimutt is the one tool that solves scale, and it does it with a different UX: start from an empty layout and explore outward, instead of drawing everything at once.

### Cited Findings
- dbdiagram.io is code-first: you write DBML or SQL and it renders the ERD. A competitor's comparison calls it fast for solo developers but weak on collaboration and AI — [ChartDB blog, 2025-12-03](https://chartdb.io/blog/dbdiagram-vs-drawsql-vs-chartdb)
- dbdiagram free tier allows 10 diagrams. Solo Pro is about $14/mo versus DrawSQL $19/mo, and the DrawSQL team plan is $59/mo for 5 seats. These figures come from a DrawSQL-authored page, so verify them — [DrawSQL compare page](https://drawsql.app/compare/drawsql-vs-dbdiagram)
- On the dbdiagram free plan you get one diagram view, no table groups and no version history — [DbSchema blog (competitor)](https://dbschema.com/blog/design/dbdiagram-io-alternatives-that-connect-to-a-real-database/)
- dbdiagram auto-arrange complaints from users:
  - left-to-right packs tables too tightly
  - tables in the same schema don't line up
  - a spacing control is wanted
  - everything bunches on the left side of the canvas
  - arrange should avoid lines running under tables. The team said "already on our backlog" and I found no confirmed fix.

  Sources: [dbdiagram community: Improvements to auto-arrange](https://community.dbdiagram.io/t/improvements-to-auto-arrange-feature/2551), [Improved Auto Arrange](https://community.dbdiagram.io/t/improved-auto-arrange/2602), [Possible improvements to interface/visualization](https://community.dbdiagram.io/t/possible-improvements-to-interface-visualization/780)
- Poor auto-layout on large schemas is an old problem across the category: MySQL Workbench bug #42600 "Autolayout gives poor layout for large schemas", and a Toad Data Modeler KB entry "tables overlap even after autolayout" — [MySQL bug 42600](https://bugs.mysql.com/bug.php?id=42600), [Quest KB](https://support.quest.com/toad-data-modeler/kb/4328265/tables-overlap-even-after-autolayout)
- DrawSQL is positioned as the polished, collaborative visual editor, with in-canvas comments, framework migration export and a template gallery. These are self-published claims. DrawSQL had zero G2 reviews as of July 2026 — [DrawSQL compare](https://drawsql.app/compare/drawsql-vs-dbdiagram); [ER/Studio blog](https://erstudio.com/blog/database-design-software-and-diagram-tools-compared/)
- ChartDB facts:
  - 23.1k GitHub stars, AGPL-3.0
  - imports by running one "Smart Query" against a live database (Postgres incl. Supabase/Timescale, MySQL, SQL Server, MariaDB, SQLite/D1, CockroachDB, ClickHouse) and pasting the JSON result
  - AI-driven DDL export across dialects
  - Docker self-host
  - AI features need an OpenAI-compatible key

  Source: [github.com/chartdb/chartdb](https://github.com/chartdb/chartdb), fetched 2026-11-09
- ChartDB documents layouts, colours and filters for diagrams — [ChartDB docs](https://docs.chartdb.io/docs/diagrams/layouts-colors-filters)
- Azimutt:
  - MIT-licensed open source, aimed at "big and messy" real-world schemas
  - handles about 1,000 tables per AlternativeTo; the vendor says its biggest customers have about 3,000 entities
  - starts from an empty layout that you explore outward from, because "most diagram tools show one view with all the entities, which becomes unusable on larger databases"
  - supports multiple layouts and entity groups
  - its own schema language is AML

  Sources: [Azimutt layouts docs](https://azimutt.pubstack.io/docs/layouts), [azimutt README](https://github.com/azimuttapp/azimutt/blob/main/README.md), [AlternativeTo](https://alternativeto.net/software/azimutt/about), [@azimutt/serde-aml](https://libraries.io/npm/@azimutt%2Fserde-aml)
- Prisma: `prisma-erd-generator` (keonik, MIT, v2.4.4) runs in `prisma generate` and renders **Mermaid** ER diagrams through mermaid-cli/puppeteer to SVG, PNG, PDF or Markdown. Options include themes, `ignoreEnums`, `tableOnly` and `includeRelationFromFields`. Alternatives are `@nonsoo/prisma-mermaid` and `prisma-erd-generator-markdown`. I found no Prisma-to-DBML generator in the results — [prisma-erd-generator README](https://cdn.jsdelivr.net/npm/prisma-erd-generator@2.4.4/README.md), [@nonsoo/prisma-mermaid](https://www.pkgstats.com/pkg:@nonsoo/prisma-mermaid)
- DBeaver has built-in ER diagrams for live connections — [DBeaver docs](https://dbeaver.com/docs/dbeaver/Database-Structure-Diagrams/)
- Bytebase lists Azimutt among its top open-source schema diagram tools — [Bytebase blog](https://www.bytebase.com/blog/top-database-schema-diagram-tools/)

### Inferences
- Cartography can win on ERD only on **layout quality plus looks**: orthogonal edges that never pass under tables, consistent spacing, alignment by schema or group, and good results at hundreds of tables. That is the top complaint about the code-first leader, and dbdiagram has not fixed it.
- Input formats that matter: SQL DDL in several dialects, DBML (the de facto ERD-as-code language), Prisma schema, and ODCS (which got `relationships` in v3.1, see Niche 2). A "subset view" (focus on table X plus N hops), like Azimutt's, is the scalable answer for big schemas.
- Prisma users currently go through Mermaid, which has a weak layout for big ERDs. A Prisma importer with a better layout fills a real gap.

### Gaps
- I did not verify current dbdiagram, DrawSQL or dbdocs pricing on vendor pages. dbdocs, SchemaSpy and Atlas ERD output (`atlas schema inspect --web`) were not researched in this pass. I did not get ChartDB's latest release date.

## Niche 2: Data products / data mesh / data contracts

### Takeaway
The standards are now stable: **ODCS v3.1.0** (Dec 2025) and **ODPS v1.0.0** (Sep 2025), both from Bitol/Linux Foundation, with ODCS 3.2 and ODPS 1.1 in progress. Tooling, however, draws data products as **lineage graphs or catalog widgets** inside heavy commercial platforms. Data Mesh Manager/Entropy Data's paid tiers start at €20k/yr. The only diagram-as-code output in this space is datacontract-cli's Mermaid `erDiagram` export, which covers schema only, not ports or the product map. **I found no open-source diagram-as-code tool that renders a data mesh map** (domains, source-aligned/aggregate/consumer-aligned products, input/output ports, contracts as edges) from ODPS/ODCS. This is the clearest gap Cartography can fill.

### Cited Findings
- ODCS v3.1.0 is fully backward compatible with v3.0. It adds relationships and richer metadata, applies stricter validation, and deprecates the top-level `dataProduct` field because product information belongs in ODPS. Announced 2025-12-11 — [Bitol announcement](https://bitol.io/bitol-announces-odcs-v3-1-0-stronger-smarter-and-stricter/), [jgp.ai 2025-12-11](https://jgp.ai/2025/12/11/odcs-v3-1-0-is-here-relationships-richer-metadata-and-stricter-validation/)
- ODPS v1.0.0 is the first full release of the Open Data Product Standard, aligned with ODCS v3.1.0. The changelog dates v1.0.0 to 2025-09-24 and v0.9.0 to 2025-07-15. It is built on JSON Schema and governed by the Bitol TSC (Linux Foundation) — [Bitol ODPS v1.0.0 announcement](https://bitol.io/announcing-odps-v1-0-0-building-the-language-of-data-products/)
- ODCS 3.2 and ODPS 1.1 (draft) are in progress and add a shared optional `context` block (RFC-0038) aimed at AI use — [Data Intelligence Platform substack](https://dataintelligenceplatform.substack.com/p/odcs-32-and-odps-11-making-ai-smart)
- DataHub has an ODCS ingestion source, and OpenMetadata has an ODCS API — [DataHub docs](https://docs.datahub.com/docs/generated/ingestion/sources/odcs), [OpenMetadata ODCS API](https://docs.open-metadata.org/v1.13.x/api-reference/data-contracts/odcs)
- Entropy Data (formerly Data Mesh Manager / Data Contract Manager):
  - a data product marketplace with a "visual map showing data product relationships and dependencies" and a semantics graph view
  - supports ODCS and ODPS
  - pricing: Free Starter Cloud and Community self-hosted; Team from €20,000/yr, Business from €75,000/yr, Enterprise from €200,000/yr
  - open-source parts: datacontract-cli, the Community Edition, and a dataproduct-builder-dbt skill

  Source: [entropy-data.com](https://www.entropy-data.com/), fetched 2026-11-09
- datacontract-cli `export mermaid` turns an ODCS file into a Mermaid **erDiagram** of the contract's schemas: entities, fields, types and key markers. ODCS-native mapping arrived in 0.10.28 (June 2025), and a later fix handled references — [datacontract docs: Mermaid export](https://docs.datacontract.com/docs/exports/mermaid.md), [CHANGELOG](https://cli.datacontract.com/CHANGELOG.html)
- OpenMetadata data products define input ports (assets consumed) and output ports (assets exposed). A "Ports Lineage" view draws them as a lineage-style graph beside the product — [OpenMetadata data products docs](https://docs.open-metadata.org/latest/how-to-guides/data-governance/domains-&-data-products/data-products)
- Collibra models ports as assets linked by "exposes data as" (output port) and "consumes data through" (input port) relations, shown in a generic Diagram widget — [Collibra docs 2026.02](https://productresources.collibra.com/docs/collibra/2026.02/Content/Assets/DataProducts/ta_conf-data-product.htm)
- Atlan's data-mesh model treats output ports as relationships from a data product to its assets — [Atlan developer docs](https://developer.atlan.com/snippets/datamesh)
- INNOQ recommends publishing data product metadata from CI/CD to a catalog or inventory such as Data Mesh Manager — [INNOQ, 2023-07](https://www.innoq.com/en/blog/2023/07/what-is-a-data-product/)
- dbt lineage:
  - large DAGs "become overwhelming" as models grow into the thousands (Dagster guide)
  - dbt column-level lineage follows only `select` statements, not joins or filters
  - column-level lineage is Enterprise/Enterprise+ only; **dbt Core has table-level lineage only**
  - on Snowflake, column lineage shows gaps when intermediate views are dropped

  Sources: [Dagster guide](https://dagster.io/guides/dbt-lineage-in-action-3-use-cases-challenges-and-best-practices), [dbt docs: column-level lineage](https://docs.getdbt.com/docs/explore/column-level-lineage), [Snowflake dbt limitations](https://docs.snowflake.com/user-guide/data-engineering/dbt-projects-on-snowflake-limitations)

### Inferences
- Every tool here draws products as nodes in a lineage graph. None draws the **Data Mesh vocabulary** as a first-class notation: domain swimlanes, product type (source-aligned/aggregate/consumer-aligned), ports as connectors on the product box, and contracts as labelled edges with SLA/quality badges. Cartography could own this as a diagram type, with ODPS for products and ports plus ODCS for contract and schema detail. It is also a natural fit for YAML-first users, since both standards are YAML.
- A second diagram from the same input: the **contract detail view**. This is the ODCS schema shown as an ERD using the v3.1 `relationships`, plus quality and SLA panels. It would be richer than datacontract-cli's plain Mermaid erDiagram.
- dbt `manifest.json` import would serve dbt Core users who lack Explorer's paid features. Grouping by folder or `group`/`domain` meta tames large DAGs.

### Gaps
- I could not view Entropy Data's actual map rendering or confirm it shows ports. I did not research the Alation or DataHub lineage UI specifics, or whether datacontract-cli now has an ODPS export. I found no user complaints (Reddit/HN) specifically about data mesh visualisation, so the gap is inferred from feature surveys, not from user demand.

## Niche 3: Roles & permissions / IAM visualisation

### Takeaway
The tools fall into two groups. **Security graph tools** (BloodHound CE plus AzureHound, an attack-path view on Neo4j) are excellent for attackers and defenders but are not documentation diagrams. **Governance reports** (Azure Governance Visualizer, PIMSCAN, EntraFalcon) are mostly HTML tables. In between sit small single-author graph tools (Pyvis-based). I found no tool that produces a clean, documentation-grade **"who can do what where"** diagram (scope hierarchy × principals × roles, or an access matrix) from an Entra/Azure or GitHub export.

### Cited Findings
- BloodHound CE:
  - open-source attack-path analysis across AD, Entra ID and Azure
  - v8 (2025-07-29) added **OpenGraph**, which allows arbitrary node and edge types beyond AD/Entra
  - stores the graph in Neo4j and app metadata in PostgreSQL
  - AzureHound collects Entra/Azure (users, groups, apps, service principals, subscriptions, role assignments, resources) into a JSON file for ingest

  Sources: [SpecterOps blog: BloodHound CE v8 OpenGraph, 2025-07-29](https://specterops.io/blog/2025/07/29/bloodhound-community-edition-v8-launches-with-opengraph/), [BloodHound docs](https://bloodhound.specterops.io/get-started/introduction), [Wiz overview](https://www.wiz.io/academy/bloodhound-overview)
- Azure Governance Visualizer (AzGovViz, Microsoft-hosted repo) reports on RBAC across the management group/subscription hierarchy, including inheritance and PIM eligibility. It is report-style, not a diagram — [github.com/azure/azure-governance-visualizer](https://github.com/azure/azure-governance-visualizer)
- Azure Role Assignment Auditor (SJimenez44): FastAPI, NetworkX and Pyvis, with an interactive network graph of app and RBAC role assignments — [ecosyste.ms entry](https://awesome.ecosyste.ms/projects/github.com%2Fsjimenez44%2Fazureroleassignmentauditor)
- PIM Manager visualises PIM assignments with charts, client-side — [PIM-Manager](https://gh.r-mj.com/0125joel/PIM-Manager)
- PIMSCAN produces HTML reports of Entra role assignments — [github.com/canix1/PIMSCAN](https://github.com/canix1/PIMSCAN)
- EntraFalcon (Compass Security, 2025-04) is a PowerShell tool that enumerates Entra objects and assignments and flags privileged objects — [Compass Security blog](https://blog.compass-security.com/2025/04/introducing-entrafalcon-a-tool-to-enumerate-entra-id-objects-and-assignments/)
- Quarkslab QAZPT computes and visualises effective app permissions in Entra — [Quarkslab blog](https://blog.quarkslab.com/auditing-application-permissions-in-microsoft-entra-id-hidden-risks-pitfalls-and-quarkslabs-qazpt-tool.html)
- Other projects: EntraOps (privileged-access classification), OID-See, and IdentityAtlas (role-mining UI) — [EntraOps](https://awesome.ecosyste.ms/projects/github.com%2Fcloud-architekt%2Fentraops), [OID-See](https://github.com/secdev02/OID-See), [IdentityAtlas](https://fortigi.github.io/IdentityAtlas/ui/overview/)

### Inferences
- An opening for Cartography: an **access diagram type** with:
  - a scope tree (tenant → management group → subscription → resource group, or org → team → repo)
  - principals and groups on the other side
  - role assignments as edges coloured by role, with dashed edges for PIM-eligible
  - an **access-matrix** rendering option from the same model
- Useful importers: `az role assignment list` JSON, AzureHound JSON (its schema is already the de facto export), and the GitHub REST API (org teams, repo collaborators, permission levels).
- Not a security tool: the pitch is "explain permissions in docs and audits", not attack paths.

### Gaps
- I did not search for GitHub org/team permission visualisers specifically (no results gathered), and found no Reddit r/AZURE threads on what people want. I did not confirm the current BloodHound CE or AzureHound versions for 2026. The demand side is unverified.

## Niche 4: Git flow / branching diagrams

### Takeaway
**Mermaid gitGraph is now the default by elimination.** gitgraph.js was archived on 2024-07-13, and its maintainer points to Mermaid. Mermaid's gitGraph is functional but limited: commits are ordered strictly by source order, branch order needs a manual `order:`, there was a bottom-to-top direction bug, and requests for squash and custom commit icons are open. No tool draws **branching strategies** (GitFlow, trunk-based, release trains) as conceptual lanes with environments, tags and release timing. People still draw those by hand in slides.

### Cited Findings
- gitgraph.js (nicoespeon) was archived on 2024-07-13 and is read-only. The maintainer points users to Mermaid. The npm `gitgraph.js` package is deprecated in favour of `@gitgraph/js`, which lives in the same archived monorepo — [github.com/nicoespeon/gitgraph.js](https://github.com/nicoespeon/gitgraph.js), [npm gitgraph.js](https://npmjs.com/package/gitgraph.js)
- DoltHub dropped gitgraph.js for its own commit graph because it had not been updated since 2019 and was limited — [DoltHub blog, 2024-08-07](https://dolthub.com/blog/2024-08-07-drawing-a-commit-graph)
- Mermaid gitGraph:
  - commits are drawn in order of occurrence in code
  - branch order is by appearance unless you use the `order` keyword
  - merging into a non-existent branch is a console error
  - TB and BT orientations exist

  Source: [mermaid.js.org gitgraph syntax](https://mermaid.js.org/syntax/gitgraph.html)
- A bottom-to-top direction bug (the parser did not retain direction) was addressed in PR #5259 — [mermaid PR 5259](https://redirect.github.com/mermaid-js/mermaid/pull/5259), [task summary](https://hub.harborframework.com/tasks/abundant/mermaid-js__mermaid-5259)
- In January 2026 an enhancement request for squash merges and custom commit icons in gitGraph was still awaiting grooming — [Weekly GitHub report for Mermaid, 2026-01-16](https://buttondown.com/weekly-project-news/archive/weekly-github-report-for-mermaid-january-16-2026)
- Schematex has its own gitgraph diagram type, a sign that new multi-type tools add this — [schematex.js.org/docs/gitgraph](https://schematex.js.org/docs/gitgraph)

### Inferences
- Mermaid already covers this niche well enough that Cartography should match its syntax semantics: branch, commit, merge, cherry-pick and tag. It can stand out with:
  - a **strategy mode**: lanes per long-lived branch, environment and deploy markers, and release/hotfix flows shown as patterns, not concrete commits
  - squash, rebase and revert glyphs
  - nicer typography and lane colours
- Optional import of real history (`git log --graph` or the GitHub API) to show a real repo excerpt is a differentiator. I found no evidence that a doc-quality tool does this.

### Gaps
- I found no Reddit or HN threads on how people draw branching strategies for slides. The "drawn by hand" claim is an inference.

## Niche 5: Developer journey / user journey / storytelling

### Takeaway
Journey mapping is dominated by **commercial CX/service-design SaaS** (TheyDo, Smaply, UXPressia) and Miro templates. All target customer experience, are seat-priced, and are canvas-first. Mermaid's `journey` is the only diagram-as-code option, and it is very basic. I found **nothing specific to developer experience journeys**, such as onboarding to first deploy with touchpoints like docs, CLI, CI and portal, linked to the systems involved.

### Cited Findings
- TheyDo positions itself as an enterprise "single source of truth" journey management platform and claims a Forrester Wave Leader position (vendor claim). It also publishes competitor comparisons — [TheyDo: Smaply alternatives](https://www.theydo.com/blog/articles/we-tried-best-smaply-alternatives-for-journey-mapping-and-collaboration), [TheyDo: UXPressia alternatives](https://www.theydo.com/blog/articles/we-found-the-best-uxpressia-alternatives-for-every-use)
- UXPressia pricing per a TheyDo article: Free (1 journey map), Starter $16/user/mo, Pro $36/user/mo, Enterprise custom. Unverified on the vendor site — [TheyDo article](https://www.theydo.com/blog/articles/we-found-the-best-uxpressia-alternatives-for-every-use)
- Smaply can map multiple archetypes on one canvas to show where journeys converge or diverge. It also has AI map generation, opportunities and pain points, portfolio graphs and KPIs — [Renascence comparison](https://www.renascence.io/journal/journey-mapping-platforms-visualization-features-compared), [Capterra](https://www.capterra.co.uk/compare/172668/177161/uxpressia/vs/smaply)
- Users are loyal to UXPressia for journey maps, personas and empathy maps — [TrustRadius](https://www.trustradius.com/compare-products/smaply-vs-uxpressia)
- Thoughtworks writes about the developer experience of data mesh platforms, a related DX-journey framing — [Thoughtworks blog](https://www.thoughtworks.com/en-gb/insights/blog/data-strategy/dev-experience-data-mesh-platform)

### Inferences
- Opening for Cartography: a **journey diagram type** in YAML:
  - stages → steps → touchpoints, with an emotion/score curve, pain points and owners
  - the twist: steps can **reference nodes in other Cartography diagrams** (the CLI, portal or service a developer touches). That links storytelling to architecture, which CX tools cannot do.
  - render in the same look as the other types, slide-ready
- Mermaid `journey` (sections, tasks, 1–5 scores, actors) is the baseline syntax to exceed. I know its feature set from training, not from a source fetched here.

### Gaps
- I did not fetch Mermaid journey docs or open issues. No DX-specific journey tooling or demand evidence (Reddit/HN) was found. Miro template details were not researched.

## Niche 6: Kubernetes and network diagrams

### Takeaway
For Kubernetes, **KubeDiagrams** (Apache-2.0, Python, Graphviz via the `diagrams` library) is the leading as-code generator. It takes manifests, Kustomize, Helm charts (incl. OCI), helmfile or live cluster output, and has an arXiv paper (May 2025). Output is the classic "diagrams" icon look, with limited styling. k8sviz covers namespace snapshots. A curated list surveys about 20 such tools, which shows a fragmented field. For networks, **netbox-topology-views** (active, last push 2026-10-16) gives interactive topology from NetBox. PlantUML nwdiag is the as-code option. Vendor stencils (Cisco/Visio) remain the norm for formal docs.

### Cited Findings
- KubeDiagrams:
  - generates architecture diagrams from manifests, kustomization files, Helm charts, helmfile descriptors and actual cluster state (e.g. `kubectl get all -o yaml | kube-diagrams -`)
  - `helm-diagrams <chart-url>` supports remote and OCI charts
  - PNG/SVG output and a Docker image
  - declarative custom clusters, nodes and edges
  - Apache-2.0
  - arXiv paper 2505.22879 (May 2025)
  - PyPI 0.4.0 seen in results, current version not verified

  Sources: [arXiv 2505.22879](https://arxiv.org/html/2505.22879v1), [README](https://cdn.jsdelivr.net/gh/philippemerle/kubediagrams@main/README.md), [PyPI](https://pypi.org/project/KubeDiagrams/), [discuss.kubernetes.io 0.2.0](https://discuss.kubernetes.io/t/kubediagrams-0-2-0-is-out/31966)
- k8sviz generates diagrams from the actual state of a namespace. The "Awesome Kubernetes Architecture Diagrams" list surveys 20 tools that auto-generate Kubernetes diagrams from manifests, Helm or cluster state — [dev.to summary](https://dev.to/techresolve/solved-awesome-kubernetes-architecture-diagrams-4nh), [support.tools](https://support.tools/auto-generating-kubernetes-architecture-diagrams/)
- netbox-topology-views (netbox-community) is a NetBox plugin for topology maps. Its compatibility table runs up to plugin 4.1.x for NetBox 4.1, and the default branch was last pushed 2026-10-16 — [GitHub](https://github.com/netbox-community/netbox-topology-views), [PyPI](https://pypi.org/project/netbox-topology-views), [ecosyste.ms](https://awesome.ecosyste.ms/projects/github.com%2Fnetbox-community%2Fnetbox-topology-views)

### Inferences
- KubeDiagrams proves there is demand for "manifests/Helm → diagram". Its weaknesses are a fixed icon-heavy style, Graphviz cluster layout with no orthogonal routing control, and diagrams that get busy because every resource is drawn. Cartography could win with:
  - **abstraction levels**: app view (Deployments/Services/Ingress only) versus full resource view
  - grouping by namespace or app label
  - a consistent modern look
  - the same importers: rendered `helm template` output, Kustomize build, `kubectl get -o yaml`
- Network: nwdiag's model (networks as horizontal buses, nodes attached with addresses) is simple and well liked. A modern nwdiag-style type plus NetBox API import (devices, cables, VLANs, prefixes) is a credible niche. Few open tools render NetBox to static, doc-ready SVG; the topology-views plugin is interactive inside NetBox.
- Terraform/Bicep: not researched here. Likely covered by the cloud-architecture researcher.

### Gaps
- I did not fetch the nwdiag/PlantUML docs, the k8sviz repo status, Kubeview status, or r/kubernetes and r/networking complaint threads. The Reddit hits were mirror snapshots with no usable content. I have no source-backed user complaints about KubeDiagrams specifically.

## Cross-cutting: where Cartography can win, missing as-code options, and imports

### Takeaway
Ranked by how open the field is:
1. **Data mesh / data product maps from ODPS + ODCS**: no as-code tool; platforms are commercial (€20k+/yr) and lineage-shaped.
2. **IAM / access diagrams from Entra/Azure/GitHub exports**: only security graphs or HTML reports.
3. **Developer journey maps**: only CX SaaS and basic Mermaid journey.
4. **Branching strategies**: Mermaid gitGraph only, archived gitgraph.js.
5. **K8s and network**: KubeDiagrams and nwdiag exist but look dated.
6. **ERD**: crowded, and the only way to win is layout quality at scale.

### Cited Findings
- See the niche sections above. Key anchors:
  - ODCS v3.1 / ODPS v1.0 are stable YAML/JSON-Schema standards — [Bitol](https://bitol.io/bitol-announces-odcs-v3-1-0-stronger-smarter-and-stricter/), [Bitol ODPS](https://bitol.io/announcing-odps-v1-0-0-building-the-language-of-data-products/)
  - the only ODCS diagram export is a Mermaid erDiagram — [datacontract docs](https://docs.datacontract.com/docs/exports/mermaid.md)
  - dbdiagram's layout complaints are unresolved — [dbdiagram community](https://community.dbdiagram.io/t/improvements-to-auto-arrange-feature/2551)
  - gitgraph.js is archived — [GitHub](https://github.com/nicoespeon/gitgraph.js)
  - KubeDiagrams accepts manifests, Helm and Kustomize — [arXiv](https://arxiv.org/html/2505.22879v1)
  - AzureHound JSON feeds BloodHound — [Wiz](https://www.wiz.io/academy/bloodhound-overview)

### Inferences
Import priority by value per effort:

| Priority | Source | Diagram type |
|---|---|---|
| 1 | ODCS YAML | contract ERD + quality/SLA panel |
| 1 | ODPS YAML | product/port map |
| 2 | SQL DDL (Postgres/MySQL first) | ERD |
| 2 | DBML | ERD (lets dbdiagram users migrate) |
| 2 | Prisma schema | ERD |
| 3 | dbt `manifest.json` | lineage, grouped by domain/group |
| 3 | Kubernetes YAML (incl. `helm template`, `kustomize build` output) | K8s |
| 4 | `az role assignment list` JSON / AzureHound JSON | access diagram |
| 4 | GitHub REST (teams/repos) | access diagram |
| 5 | NetBox API | network |
| 5 | `git log` | branching |

- Terraform and Bicep matter for cloud architecture diagrams, a different niche not covered here.
- The common thread across niches: incumbents are either code-first with poor layout (Mermaid, DBML, KubeDiagrams) or polished but canvas-only, commercial and siloed (DrawSQL, TheyDo, Collibra). "One consistent modern look across types, with cross-diagram references" is the unifying pitch.

### Gaps
- I gathered no direct user-voice evidence (Reddit/HN/GitHub issues) except for dbdiagram layout and the Mermaid gitGraph feature request. Demand in niches 2, 3 and 5 is inferred from missing supply, not from documented requests. That should be validated before prioritising them.
