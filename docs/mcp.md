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
| `get_context()` | What the user has open in an editor (VS Code, or `carto serve` in the browser): the file, the ids of what is selected, the view, layers, stage and step, the problems, unsaved changes. Says so when no editor is connected |
| `propose(file, edits, summary?)` | Shows `edit_diagram`'s edits in the open editor as a proposal: the drawing with the diff marks and the YAML diff. Returns `accepted` or `rejected` once the user decides; `not-open` or `no-editor` when the file is not open, so use `edit_diagram` then. Checked first: a change that does not validate is not shown |
| `describe(yaml \| file, view?, …)` | The diagram in words (Markdown), as `carto describe` |
| `diff(file, before? \| ref?, view?)` | What changed against another file or against the file at a git ref, element by element and in sentences, as `carto diff` |

Resources: `cartography://types` and `cartography://schema/{type}`. Prompt: `create-diagram`
(asks what to draw, picks a type, asks the type's questions, then runs the validate → render loop).

Paths: relative paths resolve against the server's working directory and may not leave it; absolute
paths are used as given. With `file`, contract files and `<name>.layout.json` next to it are used.

## The live link: your editor and your agent

When a diagram is open in an editor, the agent can see what you see and propose instead of write:

- `get_context` says which file is open and what is selected, so "make this one redundant" works;
- `propose` shows the change over the drawing, marked as `carto diff` marks it, with the YAML diff.
  **Accept** (⏎) applies it as one undo step; **Reject** (Esc) leaves it. The agent hears which.

Two editors answer:

- **VS Code** with the Cartography extension. Nothing to set up beyond the MCP server below: the
  extension listens on 127.0.0.1 with a random token, and the server finds it.
- **The web editor through `carto serve`** (see below).

How they find each other: each editor writes a small file (its address and token) into
`cartography-live` in your temp folder while it runs, readable only by you. The MCP server picks the
editor that has the diagram's folder open. Nothing leaves your computer.

## carto serve

```sh
carto serve docs/architecture      # or: pnpm carto serve <folder>
```

One local process for one folder: the web editor at `http://127.0.0.1:4317/`, reading and writing the
folder's files, and an MCP endpoint at `/mcp` (streamable HTTP). It prints the line to connect Claude
Code:

```sh
claude mcp add --transport http cartography http://127.0.0.1:4317/mcp --header "Authorization: Bearer <token>"
```

The token is made once and kept in `~/.cartography/serve-token`, so this works every time. Only
requests from this computer with the token get in. Files the agent writes show up in the editor,
marked; ⌘Z takes them back. `--port` picks another port. Build the web app first (`pnpm web:build`).

## Setup (local, from a clone)

Nothing is on npm yet. Clone the repo and `pnpm install`, then point your client at the server
source, run with tsx. Below, `/path/to/cartography` is your clone.

**Claude Code** (the server starts in your project, so `path: docs/arch.svg` lands there):

```sh
claude mcp add cartography -- /path/to/cartography/node_modules/.bin/tsx /path/to/cartography/packages/mcp/src/main.ts
# for every project: add --scope user before the name
```

**VS Code** (Copilot's agent mode and other VS Code agents): add `.vscode/mcp.json` to the project.
The extension's engine version (1.90) is too old to register the server by itself, so this is by hand:

```json
{
  "servers": {
    "cartography": {
      "type": "stdio",
      "command": "/path/to/cartography/node_modules/.bin/tsx",
      "args": ["/path/to/cartography/packages/mcp/src/main.ts"]
    }
  }
}
```

**Cursor**: the same in `.cursor/mcp.json`, under `"mcpServers"` instead of `"servers"`.

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
