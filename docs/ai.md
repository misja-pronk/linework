# Claude in the editor

Cartography can use Claude in two places in the web editor, both with your own Anthropic API key:

- **Describe it** in the start dialog: answer a few questions and Claude writes a first diagram.
- **Ask** (⌘J, the Ask button on the canvas, or "Ask Claude…" in the command palette): ask for a change to the open diagram, or ask a question about it.

Nothing else in the app talks to the network. Without a key, both still work as "copy the prompt": paste it into any chat assistant and paste the answer back (Describe it).

## Ask

Select something first to make it the subject ("split this into three services", "put a firewall in front of it"), or select nothing to ask about the whole diagram. The panel header says which.

**Changes** come back as a proposal, never applied straight away:

- the drawing with what was added, changed and removed marked (the same marks as `carto diff`), and the YAML diff;
- **Accept** (⏎) applies it as one undo step: ⌘Z takes all of it back. Elements that stay keep their place in the drawing (the layout's stability memory) and your pins stay; an id Claude renames takes its pin with it;
- **Reject** (Esc) leaves the diagram as it was;
- or type a follow-up ("only two services", "call it Edge firewall") to get a new proposal instead.

Claude makes changes through two tools, not free text: `edit_diagram` (edits by YAML path: set, append, delete, rename; everything else keeps its exact text, comments included) and `replace_diagram` (the whole file, for a restructure). Every call is checked against the tool's schema, applied, and drawn by the engine before you see it. If it does not validate, Claude gets the errors and tries again, at most twice; a change that still does not validate is not offered, and the panel says so. If you edit the YAML while a proposal is open, edits by path are applied to your new text; a whole-file proposal then asks you to ask again.

**Questions** ("explain this diagram", "review it for threats", "single points of failure", "missing monitoring") come back as text. Elements it names are links: click one to select it in the drawing and the YAML.

Esc or Stop cancels a running answer; nothing changes.

## What is sent

Only when you press Ask, only to `api.anthropic.com`, straight from your browser:

- the open diagram's YAML and file name;
- its type's JSON Schema and short description (in the first message of a conversation);
- the ids of what is selected;
- the problems the editor shows;
- for a review question, the layout report (crossings, lines through boxes, label overlaps, empty space, aspect);
- the conversation so far in the panel.

Not sent: other files in your folder, included model files, pins and positions, your theme or icons, anything from other tabs. The panel footer lists what goes with the next question, and **Show exactly** shows the message itself.

## Key, model and costs

The key field opens the first time and from the key button in the panel header. With **Remember in this browser** the key is kept in this browser's local storage (the same place as the start dialog's key); without it, only until you reload or close the tab. It is sent only to Anthropic.

Calls run on your key and are billed to your Anthropic account: Cartography adds no costs and has no account of its own. A question about a typical diagram is several thousand input tokens (most of it the schema); the fixed instructions are cached between questions. The model is Claude Opus 5.5 by default; Claude Sonnet 5.5 is cheaper and faster. If a model declines a request, the API retries it on another model by itself.

Errors are said plainly: a key Anthropic does not accept, a model the key may not use, too many requests (wait a minute), no connection.

## Privacy

Your diagram goes to Anthropic under your own API agreement with them; Cartography's code sees nothing of it and keeps no logs. Don't ask about diagrams you may not share with Anthropic.
