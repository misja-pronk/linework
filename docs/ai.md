# Use your own AI

Cartography has no AI of its own. Your own AI changes your diagrams: Claude Code, Copilot, Cursor,
Codex, Claude Desktop or any other agent that speaks MCP. It does so through Cartography's MCP
server, which checks every change against the type's schema and lays it out before anything is
written.

The files on disk are the contract. The agent reads and writes the YAML (and the pins next to it);
the editor shows what changed. When you have the diagram open, the agent can also see what you have
selected, and show its change as a proposal you accept or reject.

## Set up the MCP server

**In VS Code**, install the Cartography extension ([vscode](vscode.md)) and you are done: it
registers the MCP server with VS Code (1.101 or later), so Copilot's agent mode and other agents that
use VS Code's MCP servers have the tools. See [In VS Code](#in-vs-code) below.

Everywhere else, set the server up once. It is `packages/mcp`; [mcp.md](mcp.md) has every tool. From
a clone, after `pnpm install` and `pnpm build` (which bundles it into
`packages/mcp/dist/server.mjs`, run with plain Node.js 24; `/path/to/cartography` is your clone):

**Claude Code** (in a terminal or in its VS Code extension):

```sh
claude mcp add cartography -- node /path/to/cartography/packages/mcp/dist/server.mjs
```

**Cursor**: add `.cursor/mcp.json` to the project:

```json
{
  "mcpServers": {
    "cartography": {
      "command": "node",
      "args": ["/path/to/cartography/packages/mcp/dist/server.mjs"]
    }
  }
}
```

**VS Code without the extension** (or an editor built on VS Code that does not take servers from
extensions): the same in `.vscode/mcp.json`, under `"servers"`, with `"type": "stdio"`.

**Claude Desktop**: Settings → Developer → Edit config; see [mcp.md](mcp.md#setup-local-from-a-clone).

Then ask: "draw our order platform as an Azure diagram in docs/arch.yaml", "add a cache in front of the
orders database", "make the selected service redundant".

## In VS Code

Install the extension; there is nothing more to set up. The flow:

1. **Select**: open a diagram's preview (`⌘K V`) and click the element you mean, or put the cursor
   in its YAML.
2. **Ask** your agent in the chat (Copilot in Agent mode, or Claude Code): "make this one
   redundant", "put a cache in front of the selected database".
3. **Proposal**: the agent reads what you selected with `get_context` and calls `propose`. The change
   shows over the preview: what is added, changed and removed marked, and the YAML diff. A diagram of
   the workspace that is not open is opened first, with its preview.
4. **Accept** (⏎) applies it as one undo step (pins stay; a renamed id takes its pins along), or
   **Reject** (Esc). The agent hears which and goes on from there.

A file the agent writes with `edit_diagram` instead reloads (VS Code does that), and the preview shows
what changed, with **Undo** to take it back. The extension listens on this computer only, and the MCP
server finds it through a small file in the temp folder.

## In the browser: carto serve

```sh
pnpm build                                              # once: the web app and the bundles
node packages/cli/dist/carto.mjs serve docs/architecture  # or from the source: pnpm carto serve <folder>
```

The bundle serves the web app copied beside it (`packages/cli/dist/web`), so the `dist` folder can
live anywhere; from the source, `carto serve` needs `pnpm web:build` once.

`carto serve` opens one folder in the web editor at `http://127.0.0.1:4317/`, and gives an MCP
endpoint at `/mcp`. It prints the line to connect Claude Code; the token stays the same, so you add
it once:

```sh
claude mcp add --transport http cartography http://127.0.0.1:4317/mcp --header "Authorization: Bearer <token>"
```

The editor then reads and writes the folder through `carto serve`, and the **Your AI** panel (⌘J,
Ctrl+I off a Mac) shows:

- a **proposal** from the agent, with the diff marks and the YAML diff: **Accept** (⏎) is one undo
  step, and pins stay (a renamed id takes its pin along); **Reject** (Esc) leaves the diagram as it
  was. The agent hears which;
- a **file changed on disk** (the agent's `edit_diagram`, git, another editor): it comes in as one
  undoable edit, marked the same way. **Keep**, or **Undo** (⌘Z). With unsaved changes it does not
  come in; the editor warns, and saving asks first.

A proposal for another file of the folder opens that file in the editor first.

A folder opened in the browser itself (Chrome, Edge) notices changed files too, by asking the browser
or checking every two seconds while the tab is visible. Proposals need `carto serve` or VS Code.

## Copy for your AI

Only a chat window? **Copy for your AI** (command palette, or the Your AI panel) copies the open
diagram, its type's JSON Schema and short instructions. Paste it into any chat, say what to change,
and paste the YAML it answers back into the editor.

For a new diagram, the start dialog's **Your AI** asks a few questions about what to draw, copies
them as a prompt with the schema and an example, and takes the answer back: paste it, see it drawn,
open it.

## From other tools

Cartography has no importers. Your own AI converts a Mermaid, D2, PlantUML, Structurizr, draw.io,
Excalidraw or Terraform file, a Kubernetes manifest or a Compose file well: give it the file and say
which type to draw. It reads the type's schema with `get_schema`, writes the YAML, and checks it with
`validate` (problems, and how the layout reads) until it is clean. Ask it to keep the ids, to pick
real kinds instead of generic boxes, and to say what it left out.

```text
Convert docs/checkout.mmd into a Cartography systems diagram in docs/checkout.yaml.
Keep the ids, group by subgraph, and validate it.
```

Without MCP, **Copy for your AI** with the file pasted under it does the same in any chat.

## Privacy

Cartography never talks to the network. Nothing is sent anywhere by the editor, the VS Code
extension, the MCP server or `carto serve`:

- `carto serve` and the VS Code extension listen on 127.0.0.1 only, and only answer requests with
  their token;
- your agent sends what it reads to its own provider, under your agreement with them. That is your
  agent's business, not Cartography's: choose an agent you may share the diagram with.

Earlier versions had a built-in Claude client with an API key kept in the browser. It is gone, and a
key it kept is removed from the browser's storage the first time the editor opens.
