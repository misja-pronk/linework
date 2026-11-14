# MCP server and agent skill

`linework-mcp` lets AI assistants (Claude Code, Claude Desktop, any MCP client) write Linework
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
| `render(yaml \| file, format?, theme?, path?, scale?, view?, focus?, hops?, direction?, layer?, step?)` | SVG or PNG. With `path` it writes the file; a PNG also comes back as an image, an SVG without `path` as text. The last options draw part of it, as `linework render --view --focus --layer --step` do |
| `edit_diagram(yaml \| file, edits, dryRun?)` | Edits by YAML path: `set`, `append`, `delete`, `rename`. The rest of the file keeps its exact text, comments included; a renamed id takes its pins in `<name>.layout.json` along. Validated and laid out before it is written: invalid means nothing is written and the problems come back, valid means the file is written and the layout quality comes back |
| `get_context()` | What the user has open in an editor (VS Code, or `linework serve` in the browser): the file, the ids of what is selected, the view, layers, stage and step, the problems, unsaved changes. Says so when no editor is connected |
| `propose(file, edits, summary?)` | Shows `edit_diagram`'s edits in the editor as a proposal: the drawing with the diff marks and the YAML diff. A file of the editor's folder that is not open is opened first (VS Code: the file and its preview; `linework serve`: the file in the browser editor). Returns `accepted` or `rejected` once the user decides; `no-editor` when no editor is connected, `not-open` when the editor cannot open the file (outside its folder, not there), so use `edit_diagram` then. Checked first: a change that does not validate is not shown |
| `describe(yaml \| file, view?, …)` | The diagram in words (Markdown), as `linework describe` |
| `diff(file, before? \| ref?, view?)` | What changed against another file or against the file at a git ref, element by element and in sentences, as `linework diff` |

Resources: `linework://types` and `linework://schema/{type}`. Prompt: `create-diagram`
(asks what to draw, picks a type, asks the type's questions, then runs the validate → render loop).

Paths: relative paths resolve against the server's working directory and may not leave it; absolute
paths are used as given. With `file`, contract files and `<name>.layout.json` next to it are used.

## The live link: your editor and your agent

When a diagram is open in an editor, the agent can see what you see and propose instead of write:

- `get_context` says which file is open and what is selected, so "make this one redundant" works;
- `propose` shows the change over the drawing, marked as `linework diff` marks it, with the YAML diff.
  **Accept** (⏎) applies it as one undo step; **Reject** (Esc) leaves it. The agent hears which. A
  file of the folder that is not open is opened first; one outside the folder, or not there, is
  `not-open`.

Two editors answer:

- **VS Code** with the Linework extension. Nothing to set up: the extension registers the MCP
  server with VS Code, listens on 127.0.0.1 with a random token, and the server finds it. An agent
  outside VS Code (Claude Code in a terminal) finds it too, with the server set up as below.
- **The web editor through `linework serve`** (see below).

How they find each other: each editor writes a small file (its address and token) into
`linework-live` in your temp folder while it runs, readable only by you. The MCP server picks the
editor that has the diagram's folder open. Nothing leaves your computer.

## linework serve

```sh
node packages/cli/dist/linework.mjs serve docs/architecture  # after pnpm build; or: pnpm linework serve <folder>
```

One local process for one folder: the web editor at `http://127.0.0.1:4317/`, reading and writing the
folder's files, and an MCP endpoint at `/mcp` (streamable HTTP). It prints the line to connect Claude
Code:

```sh
claude mcp add --transport http linework http://127.0.0.1:4317/mcp --header "Authorization: Bearer <token>"
```

The token is made once and kept in `~/.linework/serve-token`, so this works every time. Only
requests from this computer with the token get in. Files the agent writes show up in the editor,
marked; ⌘Z takes them back. `--port` picks another port. The bundle serves the copy of the web app
beside it (`dist/web`, made by `pnpm build`); `pnpm linework serve` from the source serves
`packages/web/dist` (`pnpm web:build` first).

## Setup (local, from a clone)

Nothing is on npm yet. Clone the repo, `pnpm install` and `pnpm build`: that bundles the server into
`packages/mcp/dist/server.mjs`, one file that runs on plain Node.js 24 (no tsx, no `node_modules`).
The folder beside it holds what it reads: `fonts/`, `examples/` and resvg's native binary for PNG,
built for the machine you built on. Copy the whole `dist` folder anywhere you like; below,
`/path/to/linework` is your clone. `pnpm smoke` checks the bundle from a folder outside the repo.

**Claude Code** (the server starts in your project, so `path: docs/arch.svg` lands there):

```sh
claude mcp add linework -- node /path/to/linework/packages/mcp/dist/server.mjs
# for every project: add --scope user before the name
```

Working on the server itself? Point the client at the source instead, run with tsx:
`/path/to/linework/node_modules/.bin/tsx /path/to/linework/packages/mcp/src/main.ts`.

**VS Code** (Copilot's agent mode and other VS Code agents): install the Linework extension
([vscode](vscode.md)); it registers the server with VS Code itself (VS Code 1.101 or later), run on
VS Code's own Node.js with the first workspace folder as its working directory. Nothing to write. It
shows as **Linework** under MCP servers (Command Palette → **MCP: List Servers**). That copy draws
SVG but not PNG (resvg is native code the extension does not ship); the CLI and the server below
draw both.

Without the extension, or in an editor built on VS Code that cannot register servers for an
extension, add `.vscode/mcp.json` to the project by hand:

```json
{
  "servers": {
    "linework": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/linework/packages/mcp/dist/server.mjs"]
    }
  }
}
```

**Cursor**: the same in `.cursor/mcp.json`, under `"mcpServers"` instead of `"servers"`.

**Claude Desktop**: Settings → Developer → Edit config (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "linework": {
      "command": "node",
      "args": ["/path/to/linework/packages/mcp/dist/server.mjs"]
    }
  }
}
```

Desktop does not start the server in a project folder, so ask for absolute output paths
(`/Users/me/Desktop/arch.png`), or just look at the PNG it shows in the chat. If Desktop cannot find
`node`, use the full path from `which node` (Node 24 or later).

**Other MCP clients**: any client that runs stdio servers. Command `node`, argument
`/path/to/linework/packages/mcp/dist/server.mjs`, working directory wherever diagrams should be
written. To poke at it by hand:

```sh
npx @modelcontextprotocol/inspector node /path/to/linework/packages/mcp/dist/server.mjs
```

## Setup (once published)

When `@linework/mcp` is on npm, the clone and the build go away:

```sh
claude mcp add linework -- npx -y @linework/mcp
```

```json
{ "mcpServers": { "linework": { "command": "npx", "args": ["-y", "@linework/mcp"] } } }
```

## Agent skill

[`skills/linework/SKILL.md`](../skills/linework/SKILL.md) teaches an agent how to pick a type,
the YAML rules, the validate → fix → render loop and the style that makes diagrams look good, with
CLI commands as a fallback when the MCP server is not connected. For Claude Code, link it into your
skills folder:

```sh
ln -s /path/to/linework/skills/linework ~/.claude/skills/linework               # all projects
ln -s /path/to/linework/skills/linework .claude/skills/linework                 # one project
```

Other agents that read the Agent Skills format can load the same folder.
