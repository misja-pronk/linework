# Layout and edge routing for architecture diagrams: state of the art (Nov 2026)

## How do ELK, yFiles, TALA, libavoid, MSAGL, Dagre, WebCola, OGDF and the canvas tools handle the open problems?

### Takeaway
ELK Layered is the most complete open layered engine (ports, sides, hierarchy, interactive modes, label placement, compaction, wrapping), and ELK also wraps libavoid for routing. yFiles (commercial) adds bus/edge-grouping routing and port candidates. TALA, D2's orthogonal engine, became open source under MPL-2.0 in September 2026. It is multi-seed and score-based, which makes it unstable. Its pinning model (locked coordinates plus hybrid placement) is the feature people like most. MSAGL.js (MIT, TypeScript) is the only permissively licensed package that ships a full rectilinear router with nudging, plus Sugiyama, MDS and IPSep-CoLa layouts.

### Cited Findings
**ELK Layered (options that map onto Linework's open problems)**
- Ports: "Port Constraints" (default UNDEFINED), "Port Side", "Allow Non-Flow Ports To Switch Sides", "Consider Port Order", "Port Sorting Strategy" — [ELK Layered reference](https://eclipse.dev/elk/reference/algorithms/org-eclipse-elk-layered.html)
- Edge routing: default `EdgeRouting.ORTHOGONAL`, with polyline and spline modes ("Spline Routing Mode" SLOPPY by default) — [ELK Layered reference](https://eclipse.dev/elk/reference/algorithms/org-eclipse-elk-layered.html)
- Hierarchy: "Hierarchy Handling" (default INHERIT) and "Merge Hierarchy-Crossing Edges" (default true) — [ELK Layered reference](https://eclipse.dev/elk/reference/algorithms/org-eclipse-elk-layered.html)
- Stability and interactivity: "interactive Layout", "Interactive Reference Point", "Semi-Interactive Crossing Minimization", "Force Node Model Order". These keep input or model order and existing positions as constraints, which is ELK's mental-map mechanism — [ELK Layered reference](https://eclipse.dev/elk/reference/algorithms/org-eclipse-elk-layered.html)
- Node placement: BRANDES_KOEPF is the default; options include "BK Edge Straightening", "BK Fixed Alignment", "Favor Straight Edges Over Balancing", and network-simplex node flexibility — [ELK Layered reference](https://eclipse.dev/elk/reference/algorithms/org-eclipse-elk-layered.html)
- Trunks: "Merge Edges" (default false) merges edges at the same port into one. ELK Layered itself has no hyperedge option; that option exists only in the libavoid algorithm — [ELK Layered reference](https://eclipse.dev/elk/reference/algorithms/org-eclipse-elk-layered.html)
- Labels: "Edge Label Placement" (CENTER), "Edge Center Label Placement Strategy" (MEDIAN_LAYER), "Edge Label Side Selection" (SMART_DOWN), "Inline Edge Labels". Labels are treated as dummy nodes inside the layering — [ELK Layered reference](https://eclipse.dev/elk/reference/algorithms/org-eclipse-elk-layered.html)
- Direction: "Direction" (UNDEFINED by default), "Direction Congruency", "Direction Priority". No automatic direction choice is documented — [ELK Layered reference](https://eclipse.dev/elk/reference/algorithms/org-eclipse-elk-layered.html)
- Compaction and wrapping: "Post Compaction Strategy" (scanline constraints), "Connected Components Compaction", and "Graph Wrapping Strategy" with cutting and validification strategies. Wrapping fixes the aspect ratio of long chains — [ELK Layered reference](https://eclipse.dev/elk/reference/algorithms/org-eclipse-elk-layered.html)

**ELK libavoid integration**
- `org.eclipse.elk.alg.libavoid` is "only route the edges without touching the node's positions". It exposes penalties (Segment Penalty default 10; Crossing, Angle, Cluster Crossing, Fixed Shared Path, Port Direction and Reverse Direction, all 0 by default) and nudging options ("Nudge Orthogonal Segments", "Nudge Orthogonal Touching Colinear Segments", "Nudge Shared Paths With Common Endpoint" default true, "Perform Unifying Nudging Preprocessing" default true, "Ideal Nudging Distance" default 4). It also has hyperedge options ("Enable Hyperedges From Common Source", "Improve Hyperedge Routes" default true, "Improve Hyperedge Routes Add/Delete"), plus "Shape Buffer Distance" and `isCluster`. A `processTimeout` (10000) option suggests it runs as an external process, but the page does not say so — [ELK libavoid reference](https://eclipse.dev/elk/reference/algorithms/org-eclipse-elk-alg-libavoid.html)

**libavoid / Adaptagrams**
- A C++ library for "fast, object-avoiding orthogonal and polyline connector routing" in interactive editors. It has no official releases but is described as stable. Inkscape, Dunnart, Gaphas and BRL-CAD use it. The key papers are Orthogonal connector routing (GD 2009), Incremental connector routing (GD 2005), Orthogonal hyperedge routing (Diagrams 2012) and Seeing Around Corners: Fast Orthogonal Connector Routing (Diagrams 2014) — [libavoid docs](https://www.adaptagrams.org/documentation/libavoid.html)
- Hyperedge improvement moves junctions by default. Better routes come from `improveHyperedgeRoutesMovingAddingAndDeletingJunctions`. The unifying nudging preprocessing step "tries to unify segments and centre them in free space", which gives better ordering and nudging — [Avoid namespace docs](https://www.adaptagrams.org/documentation/namespaceAvoid.html)
- Wybrow et al.'s 2009 nudging uses the available space to spread edges as far apart as possible, and a global strategy to minimise crossings between them — [Gladisch et al., EditLens](https://arxiv.org/pdf/1612.05064)
- Known bug: an assertion in `nudgeOrthogonalRoutes()` fails when `nudgeSharedPathsWithCommonEndPoint=false` — [adaptagrams issue #67 (mirror)](https://github.hscsec.cn/mjwybrow/adaptagrams/issues/67)
- Licence: "All code in the Adaptagrams repository is released as open source under the terms of the LGPL". Monash sells a less restrictive commercial licence. HOLA (human-like orthogonal layout, Kieffer, Dwyer et al.) now lives in Adaptagrams and is under the same terms — [adaptagrams.org](https://www.adaptagrams.org/); [skieffer/hola](https://github.com/skieffer/hola); [HOLA paper](https://ialab.it.monash.edu/~dwyer/papers/hola2015.pdf)

**yFiles (commercial, proprietary)**
- yFiles says EdgeRouter "offers a newer, improved bus-style support (also see BusDescriptor)" and recommends it over BusRouter. Each edge's bus ID comes from a BusDescriptor, and edges without an ID form their own single-edge bus — [yFiles BusRouter API](https://docs.yworks.com/yfiles-html/api/BusRouter.html)
- Port candidates: edge-side and node-side candidate sets are matched, and the edge's own candidate is preferred when none match — [yFiles OrthogonalEdgeRouter](https://docs.yworks.com/yfiles/doc/api/y/layout/router/OrthogonalEdgeRouter.html)
- Edge grouping lets several edge ends share one anchor location, on source ends and on target ends. The old 2.13 docs note it cannot be set at both ends at once — [yFiles polyline router guide (2.13, outdated)](https://docs.yworks.com/yfilesajax/yfiles-for-java/doc/developers-guide/polyline_edge_router.html)
- I could not read the current EdgeRouter guide (404 at docs.yworks.com/yfiles-html/dguide/orthogonal_edge_router/).

**D2 TALA**
- "TALA (Terrastruct's AutoLayout Algorithm) is now open-source under the same license as D2 (MPL-2.0)", dated 7 September 2026 and shipped in D2 v0.9.0 via `--layout=tala` — [D2 blog: TALA is open-source](https://d2lang.com/blog/tala-is-open-source/); [D2 blog index](https://d2lang.com/blog/)
- Two days earlier, 5 September 2026, D2 moved to non-profit stewardship. D2's development had been funded by D2 Studio and the closed-source TALA — [D2 blog: D2 is non-profit](https://d2lang.com/blog/d2-non-profit/)
- The old terrastruct/TALA GitHub repo still says "TALA is closed-source" and that it needs a licence. It is an archived install/issue repo, so the README is stale and contradicts the blog — [terrastruct/TALA](https://github.com/terrastruct/TALA)
- D2's release notes say TALA is bundled, including the JS/WASM package, and is configured with `--tala-seeds` / `D2_TALA_SEEDS` — [d2 releases](https://github.com/terrastruct/d2/releases) (via search summary; I did not pin the exact version text)

**MSAGL / MSAGL.js (MIT)**
- MSAGL.js is a TypeScript port of MSAGL under the MIT licence: 1,028 commits, about 175 stars — [microsoft/msagljs](https://github.com/microsoft/msagljs)
- `@msagl/core` (1.1.23 on jsDelivr, with `src/routing/rectilinear/`) supports layered Sugiyama, Pivot MDS and IPSep-CoLa. Routing modes include Rectilinear and RectilinearToCenter. The docs say "constraint functionality for Sugiyama scheme is not implemented yet" — [msagljs configuration docs](https://microsoft.github.io/msagljs/docs/configuration); [@msagl/core rectilinear source](https://cdn.jsdelivr.net/npm/@msagl/core@1.1.23/src/routing/rectilinear/)
- JointJS wraps it as `@joint/layout-msagl`, with `edgeRoutingMode` set to Rectilinear (the default) or SplineBundling. The `msagl-js` npm package is deprecated. A Rust port of the rectilinear router (`msagl-wasm`) exists, but I did not verify its repo or licence — [JointJS MSAGL docs](https://docs.jointjs.com/learn/features/automatic-layouts/msagl); [msagl-js npm](https://www.npmjs.com/package/msagl-js)
- Nachmanson and Chen (arXiv 2605.17498, May 2026) add "sleeve routing" to MSAGL.js: a corridor search over a Constrained Delaunay Triangulation, then the funnel algorithm. On their Game of Thrones example, total length came within 2.8% of the visibility-graph optimum. Batched per-source Dijkstra beat per-edge A* by up to 63% — [arXiv 2605.17498](https://arxiv.org/html/2605.17498v1)

**Canvas tools**
- Excalidraw's elbow arrows (blog series by Márk Tolmács, Oct and Dec 2025) moved from BFS to Dijkstra with a weight of distance plus bend count. They add exclusion zones and a binary heap, targeting smooth re-routing of about 50 arrows per frame — [Excalidraw elbow arrows part 2](https://plus.excalidraw.com/blog/building-elbow-arrows-part-two); [part 1](https://plus.excalidraw.com/blog/building-elbow-arrows-part-one)
- tldraw has elbow arrows (`ElbowArrowRoute` API, v3.13+) — [tldraw ElbowArrowRoute](https://tldraw.dev/reference/tldraw/ElbowArrowRoute); [tldraw v3.13.0](https://tldraw.dev/releases/v3.13.0). I did not research the algorithm.

### Inferences
- Linework's A* router with bend and length weights is about where Excalidraw and tldraw are. The gap to libavoid, yFiles and MSAGL is the **post-routing stage**: segment ordering through shared channels, then nudging (spreading segments in free space). The router can stay as it is; that stage is the missing piece.
- ELK's "Merge Edges" and libavoid's "hyperedges from common source" are both cheap trunk approaches: route one edge, then attach siblings at junctions. yFiles' BusDescriptor is the more complete model, with explicit bus IDs.
- TALA is now MPL-2.0. That is file-level copyleft, so its code could be studied or ported, with ported files staying MPL. Its main weakness, instability between seeds, is exactly the stability problem on Linework's list. Its pinning (hybrid locked coordinates) is the feature worth copying.

### Gaps
- I did not fetch Dagre (believed MIT), WebCola (believed MIT; the ialab page returned 403), OGDF (believed GPL v2/v3, not permissive) or elkjs (believed EPL-2.0, as the brief says) licence files in this pass. These are from memory and need checking against each repo's LICENSE.
- yFiles' current EdgeRouter and incremental hierarchic layout docs (fromSketch mode, incremental hints) could not be fetched.
- The language TALA is implemented in, its algorithm details, and whether it is usable outside D2 are not stated in the blog.

## Which algorithms give nudging, hyperedge/trunk routing, port constraints, stable layout and constraint-based pinning?

### Takeaway
The proven pipeline is: place nodes, remove overlaps, choose ports, route on an orthogonal visibility or channel graph (bend-penalised shortest path), order paths per channel (Pupyrev-style metro-line ordering), then nudge with an LP or QP separation solve. Hegemann and Wolff (2023) document this exact pipeline with open code. Pinning and stability come from constraint layout (IPSep-CoLa / VPSC in WebCola, Adaptagrams and MSAGL) or from ELK's interactive and model-order modes.

### Cited Findings
- Hegemann and Wolff, "A Simple Pipeline for Orthogonal Graph Drawing" (arXiv 2309.01671, 2023). The pipeline is: initial layout (force-based, or vertex positions from Praline); GTree overlap removal (Nachmanson et al.); port assignment on the box sides crossed by the centre-to-centre segment, with rules that avoid Z-shapes and put self-loops on the least-populated side; a routing graph built from horizontal and vertical channels with Dijkstra minimising bends, as in Wybrow et al. but with Dijkstra instead of A*; crossing-reduction post-processing; path ordering with a modified Pupyrev et al. algorithm, presetting segment directions; and **LP nudging** solved with GLOP. Nudging has a constrained mode (vertices and ports fixed) and a full mode (enforces a minimum object distance and may enlarge boxes). Code is at github.com/hegetim/wueortho; I did not check its licence — [arXiv 2309.01671](https://arxiv.org/html/2309.01671v2)
- Results from the same paper: HOLA was best on crossings and bends but produced very large areas and long edges. Hybrid2 (Praline routing plus their nudging) "surpass[es] Praline in all quality metrics" and leads on area, total length and length variance — [arXiv 2309.01671](https://arxiv.org/html/2309.01671v2)
- HOLA (Kieffer, Dwyer, Marriott, Wybrow) aims at "human-like" orthogonal layouts. A cited user study found HOLA beat yFiles — [arXiv 2309.01671](https://arxiv.org/html/2309.01671v2); [HOLA paper](https://ialab.it.monash.edu/~dwyer/papers/hola2015.pdf)
- libavoid's hyperedge routing (Diagrams 2012) and incremental connector routing (GD 2005) are the reference works for trunks and for incremental re-routing — [libavoid docs](https://www.adaptagrams.org/documentation/libavoid.html)
- Overview+Detail compound layout (arXiv 2408.04045, 2024) uses explicit ports on compound nodes, so each group's members can be laid out independently of the outer context, with outer edges entering through the ports — [arXiv 2408.04045](https://arxiv.org/pdf/2408.04045)
- Stress-minimizing orthogonal layout of data flow diagrams with ports (Rüegg et al., arXiv 1408.4626) is a constraint and stress approach to port-based orthogonal layout — [arXiv 1408.4626](https://arxiv.org/pdf/1408.4626)
- MSAGL.js ships IPSep-CoLa, the separation-constraint stress layout behind user pins and alignment, under MIT — [msagljs configuration docs](https://microsoft.github.io/msagljs/docs/configuration)

### Inferences
- A concrete upgrade path for Linework:
  1. After A*, build a "channel segment" structure: maximal collinear segment runs per channel.
  2. Order the edges sharing a channel consistently, Pupyrev metro-line style, so they do not cross inside a bundle.
  3. Solve a 1-D separation problem per axis (VPSC or a small LP/QP) that pushes segments apart to an ideal gap while keeping them inside free space. Port positions along node sides then fall out of the same solve, which also solves port distribution.
- For fan-in trunks: when k edges share a target, route a single trunk from the target outward, then let the others join at the first junction (libavoid-style junction moving), instead of nudging them apart.
- For pins: keep dot for the unpinned case. For pinned nodes, run a constraint stress layout (IPSep-CoLa from @msagl/core, or WebCola) seeded with the previous drawing, with fixed-position constraints on pinned nodes. This is also the stability mechanism: start from the old coordinates, add a stress term that pulls toward previous positions.

### Gaps
- I did not verify the Pupyrev et al. ordering paper URL (MSAGL's "metro-line crossing minimization" / path ordering work) in this pass.
- I did not find a direct source on yFiles' incremental hierarchic ("from sketch") behaviour.

## Are there permissively licensed implementations usable in TypeScript/WASM?

### Takeaway
MSAGL.js (`@msagl/core`, MIT, pure TypeScript) is the strongest permissive candidate: a rectilinear router with obstacle avoidance and nudging, Sugiyama, MDS and IPSep-CoLa. libavoid and HOLA are LGPL (commercial licence available). TALA is MPL-2.0. ELK is EPL-2.0 (weak copyleft). yFiles is proprietary.

### Cited Findings
- MSAGL.js: MIT, TypeScript — [microsoft/msagljs](https://github.com/microsoft/msagljs); routing modes Rectilinear / RectilinearToCenter — [configuration docs](https://microsoft.github.io/msagljs/docs/configuration)
- Adaptagrams (libavoid, libcola, libvpsc, HOLA): LGPL, with a paid commercial licence option — [adaptagrams.org](https://www.adaptagrams.org/)
- TALA: MPL-2.0 since 7 September 2026 — [D2 blog](https://d2lang.com/blog/tala-is-open-source/)
- yFiles: commercial. The BusRouter and EdgeRouter docs are vendor API documentation — [yFiles API](https://docs.yworks.com/yfiles-html/api/BusRouter.html)
- Excalidraw is MIT on GitHub, so its elbow-arrow Dijkstra router is a permissive reference — [excalidraw/excalidraw](https://github.com/excalidraw/excalidraw/) (MIT from repo; I did not quote the LICENSE file this session)

### Inferences
- Using LGPL libavoid compiled to WASM inside an MIT TypeScript tool is legally possible (dynamic-linking-style separation, with users able to replace the module), but awkward. Porting MSAGL.js's rectilinear nudging code (MIT) into Linework, or depending on `@msagl/core` directly, has no licence friction.
- EPL-2.0 (elkjs) is acceptable as a dependency in an MIT project, but modified ELK files must stay EPL.

### Gaps
- Licences of Dagre (MIT expected), WebCola (MIT expected), OGDF (GPL expected), wueortho (unknown) and msagl-wasm/msagl-rust (unknown) were not verified this session.

## What layout quality metrics and benchmarks are used?

### Takeaway
Research and industry share a core set of metrics: crossings, bends, total edge length, edge-length variance, area, aspect ratio and minimum object distance. TALA adds symmetry, median distance, flow and clustering of like nodes. Public benchmarks are research sets (Topology Zoo, pseudo-cableplans, Rome/North graphs), not architecture-diagram corpora.

### Cited Findings
- Hegemann and Wolff evaluate edge crossings, bends, edge-length variance, total edge length, bounding-box area, aspect ratio and minimum object distance δmin on the Topology Zoo and pseudo-cableplans sets — [arXiv 2309.01671](https://arxiv.org/html/2309.01671v2)
- TALA's objectives are symmetry, median distance, flow and clustering of like nodes. It runs 3 seeds by default and keeps the best-scoring layout — [D2 blog](https://d2lang.com/blog/tala-is-open-source/)
- Nachmanson and Chen measure route length against the visibility-graph optimum, routing time and frame-time percentiles on nine graphs (up to 32,768 nodes and 236,978 edges) — [arXiv 2605.17498](https://arxiv.org/html/2605.17498v1)
- Didimo, Montecchiani and Piselli (arXiv 2505.03678, 2025) test how layout choice affects multimodal LLMs (GPT-4o, Claude 3.7 Sonnet) reading graphs. Better human readability improves model accuracy; orthogonal layouts helped on local-connectivity tasks, straight-line layouts on global tasks — [arXiv 2505.03678](https://arxiv.org/abs/2505.03678v1)

### Inferences
- Linework's score (bends, crossings, length) matches the research core. Adding area or aspect ratio, δmin (clearance), edge-length variance and a group-compactness term would match the Hegemann–Wolff and TALA sets. A stability term (displacement from the previous layout) is what neither TALA nor dot has.
- No standard architecture-diagram benchmark was found. Linework could publish one (C4/AWS-style samples, scored on these metrics) as a differentiator.

### Gaps
- No industry benchmark comparing Mermaid, PlantUML, D2/TALA, ELK and Structurizr on the same diagrams was found.

## What makes TALA layouts praised or criticised?

### Takeaway
Praise: orthogonal, whiteboard-like layouts for architecture diagrams, often clearly better than dagre, and pinning or hybrid placement. Criticism, admitted by the author: randomness, so adding a node can change everything; weaker on DAGs; non-linear runtime.

### Cited Findings
- The author describes TALA as "primarily an orthogonal layout engine" aimed at software architecture, made to look like whiteboard sketches rather than DAGs that grow in one direction — [D2 blog](https://d2lang.com/blog/tala-is-open-source/)
- Self-reported weaknesses: adding one node can make the diagram "look completely different" (Dagre and ELK usually stay mostly stable); it is worse on DAGs (the author often prefers Dagre or ELK for long flowing graphs); runtime grows non-linearly — [D2 blog](https://d2lang.com/blog/tala-is-open-source/)
- An HN commenter said the default engine is "pretty terrible for some types of graphs", that ELK is a big improvement, and that TALA was "sometimes a big improvement". Others praised locked-coordinate and hybrid modes, for example for LLM-proposed positions — [secondary summary of the HN thread](https://news.hada.io/topic?id=23934); [zeli.app mirror](https://zeli.app/story/49604150) (I could not open the HN thread itself)
- Node placement is described as NP-hard and heuristic with randomness; seeds change the result a lot — [terrastruct/TALA README](https://github.com/terrastruct/TALA)

### Inferences
- Linework can beat TALA on its admitted weakness by making candidate selection deterministic and stability-aware: score the distance to the previous layout, keep the previous winner unless the new one is clearly better.

### Gaps
- I found no independent quantitative comparison of TALA against ELK or dot.

## Recent research (2022–2026) on orthogonal routing, compound layout and LLM-assisted layout

### Takeaway
Recent work is incremental. Practical orthogonal pipelines (Hegemann and Wolff 2023), port-based compound layout (2024) and browser-scale MSAGL routing (2026) are the most usable. On the LLM side, studies show readable layouts help LLMs, LLM layout generation is weak, and LLM-proposed rough positions refined by an engine (TALA hybrid) are the practical pattern.

### Cited Findings
- A Simple Pipeline for Orthogonal Graph Drawing (2023) — [arXiv 2309.01671](https://arxiv.org/abs/2309.01671)
- Overview + Detail Layout for Visualizing Compound Graphs (2024) — [arXiv 2408.04045](https://arxiv.org/pdf/2408.04045)
- Unbent Collections of Orthogonal Drawings (WG 2025): every plane 4-graph can be represented by a collection of at most three drawings, which is tight. Theoretical — [arXiv 2502.18390](https://arxiv.org/abs/2502.18390)
- Browsing Large Graphs with Tile Pyramids and Sleeve Routing in the Browser (Nachmanson and Chen, 2026) — [arXiv 2605.17498](https://arxiv.org/html/2605.17498v1)
- Graph Drawing for LLMs: An Empirical Evaluation (2025) — [arXiv 2505.03678](https://arxiv.org/abs/2505.03678v1)
- Fan et al., "How well will LLMs perform for graph layout tasks?" (Visual Informatics 2025) tests GPT-4o, Gemini 2.0 and DeepSeek-V3. Visual input improves LLM layout judgment; text-only prompts are unreliable — [aggregator page](https://www.bohrium.com/paper-details/how-well-will-llms-perform-for-graph-layout-tasks/1179500135214743553-2935) (full text not read)
- The GD 2023 talk slides that came up in the libavoid search are at [gd2023 talk 08.5](https://gd2023.ing.unipg.it/talks/08.5.pdf) (content not read)

### Inferences
- An "LLM as layout critic" loop is supported by the Fan et al. finding: render to an image, ask a vision model to judge or choose candidates. It should complement, not replace, the numeric score.

### Gaps
- I did not survey GD 2024/2025 proceedings systematically, so other relevant routing and compound-layout papers may exist.
- arXiv 2603.29618 (March 2026) surfaced in a HOLA-related search, but I did not read it.
- No 2022–2026 paper on automatic choice of layout direction was found.
