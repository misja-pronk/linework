# MCP server and agent skill

`cartography-mcp` lets AI assistants (Claude Code, Claude Desktop, any MCP client) write Cartography
diagrams on their own: pick a type, read its schema, validate, fix, render, and change existing
diagrams with small edits that keep comments and pins. Unlike the draw.io,
Excalidraw or Mermaid servers, `validate` checks the YAML against the type's JSON Schema with a fix
hint per problem, and lays the diagram out to report its quality (crossings, lines through boxes,
label overlaps, bends, empty space, aspect) with concrete suggestions. The assistant fixes its own
drawing before you see it.

## Tools

| Tool | What it does |
|---|---|
| `list_types` | Diagram types with what each is for |
| `get_schema(type)` | JSON Schema, starter template and a fuller example from `examples/` |
| `new_diagram(type)` | The starter template |
| `validate(yaml \| file)` | Problems with line, column and hint; when valid, layout quality: `verdict`, `score`, metrics and `suggestions` (badges for hub nodes, the other `direction` when it measures clearly better, shorter labels…) |
| `render(yaml \| file, format?, theme?, path?, scale?, view?, focus?, hops?, direction?, layer?, stage?, step?)` | SVG or PNG. With `path` it writes the file; a PNG also comes back as an image, an SVG without `path` as text. The last options draw part of it, as `carto render --view --focus --layer --stage --step` do |
| `edit_diagram(yaml \| file, edits, dryRun?)` | Edits by YAML path: `set`, `append`, `delete`, `rename`. The rest of the file keeps its exact text, comments included; a renamed id takes its pins in `<name>.layout.json` along. Validated and laid out before it is written: invalid means nothing is written and the problems come back, valid means the file is written and the layout quality comes back |
| `describe(yaml \| file, view?, …)` | The diagram in words (Markdown), as `carto describe` |
| `review(yaml \| file, view?, packs?)` | The review rules' findings (rule, severity, what it is about, line, fix), as `carto review` |
| `threats(yaml \| file, view?)` | The threat model as Markdown, as `carto threats` |
| `diff(file, before? \| ref?, view?)` | What changed against another file or against the file at a git ref, element by element and in sentences, as `carto diff` |
| `trace(yaml \| file, from?, to?, steps?, view?)` | The routes a request takes, as `carto trace` |
| `import_mermaid(text)` | Mermaid flowchart, stateDiagram, architecture-beta, erDiagram, sequenceDiagram and the others `carto import` reads → Cartography YAML, plus warnings |

Resources: `cartography://types` and `cartography://schema/{type}`. Prompt: `create-diagram`
(asks what to draw, picks a type, asks the type's questions, then runs the validate → render loop).

Paths: relative paths resolve against the server's working directory and may not leave it; absolute
paths are used as given. With `file`, contract files and `<name>.layout.json` next to it are used.

## Setup (local, from a clone)

Nothing is on npm yet. Clone the repo and `pnpm install`, then point your client at the server
source, run with tsx. Below, `/path/to/cartography` is your clone.

**Claude Code** (the server starts in your project, so `path: docs/arch.svg` lands there):

```sh
claude mcp add cartography -- /path/to/cartography/node_modules/.bin/tsx /path/to/cartography/packages/mcp/src/main.ts
# for every project: add --scope user before the name
```

**Claude Desktop**: Settings → Developer → Edit config (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "cartography": {
      "command": "node",
      "args": [
        "/path/to/cartography/node_modules/tsx/dist/cli.mjs",
        "/path/to/cartography/packages/mcp/src/main.ts"
      ]
    }
  }
}
```

Desktop does not start the server in a project folder, so ask for absolute output paths
(`/Users/me/Desktop/arch.png`), or just look at the PNG it shows in the chat. If Desktop cannot find
`node`, use the full path from `which node` (Node 24 or later).

**Other MCP clients**: any client that runs stdio servers. Command `node`, arguments
`/path/to/cartography/node_modules/tsx/dist/cli.mjs /path/to/cartography/packages/mcp/src/main.ts`,
working directory wherever diagrams should be written. To poke at it by hand:

```sh
npx @modelcontextprotocol/inspector /path/to/cartography/node_modules/.bin/tsx /path/to/cartography/packages/mcp/src/main.ts
```

## Setup (once published)

When `@cartography/mcp` is on npm, the clone and tsx go away:

```sh
claude mcp add cartography -- npx -y @cartography/mcp
```

```json
{ "mcpServers": { "cartography": { "command": "npx", "args": ["-y", "@cartography/mcp"] } } }
```

## Agent skill

[`skills/cartography/SKILL.md`](../skills/cartography/SKILL.md) teaches an agent how to pick a type,
the YAML rules, the validate → fix → render loop and the style that makes diagrams look good, with
CLI commands as a fallback when the MCP server is not connected. For Claude Code, link it into your
skills folder:

```sh
ln -s /path/to/cartography/skills/cartography ~/.claude/skills/cartography      # all projects
ln -s /path/to/cartography/skills/cartography .claude/skills/cartography        # one project
```

Other agents that read the Agent Skills format can load the same folder.
