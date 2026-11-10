// One question to Claude about the open diagram, from the browser with the user's own key (as in
// claude.ts). Claude answers in text, or proposes a change through a tool; a proposed change is
// checked here (shape, then applied to the YAML, then drawn by the engine) and what does not hold
// goes back to Claude as the tool's error, at most twice, before the panel shows it as refused.
import Anthropic from '@anthropic-ai/sdk';
import type { DiagramType } from '@cartography/core';
import { render } from '@cartography/engine';
import { ASK_SYSTEM } from './ask-prompt.ts';
import { applyOperations, checkCall, TOOLS, type ToolCall } from './edit-tools.ts';
import type { ModelId } from './claude.ts';

type Message = Anthropic.Beta.BetaMessageParam;
type ToolResult = Anthropic.Beta.BetaToolResultBlockParam;

/** A conversation in the panel: what was said, and the answers owed to Claude's last tool calls. */
export interface Conversation {
  messages: Message[];
  /** Tool results the next user message has to start with (accepted, rejected, refused). */
  owed: { id: string }[];
  /** What became of the change those calls proposed: accepted, rejected; unset while it is open. */
  verdict?: string;
  /** The YAML as Claude last saw it. */
  sent?: string;
}

export const newConversation = (): Conversation => ({ messages: [], owed: [] });

export interface Proposal {
  yaml: string;
  summary: string;
  /** What Claude said next to the change. */
  note: string;
  call: ToolCall;
  renames: Map<string, string>;
}

export type Outcome = { kind: 'answer'; text: string } | { kind: 'proposal'; proposal: Proposal } | { kind: 'refused'; text: string; errors: string[] };

export interface AskProgress {
  text: string;
  /** Characters of a change streamed so far: Claude is writing an edit. */
  writing?: number;
  /** 1 for the first try, 2+ while fixing a change that did not validate. */
  attempt: number;
}

/** How a turn that answered Claude's tool calls says what became of them. */
export function settle(c: Conversation, verdict: string): ToolResult[] {
  return c.owed.map((o) => ({ type: 'tool_result', tool_use_id: o.id, content: verdict }));
}

/** Problems that stop the YAML from drawing, as the engine reports them. */
async function problems(yaml: string, load?: (file: string) => string): Promise<string[]> {
  const r = await render(yaml, { fonts: 'none', load });
  return r.diagnostics.filter((d) => d.severity === 'error').map((d) => (d.line ? `line ${d.line}: ${d.message}` : d.message));
}

/** A tool call checked and applied: the new text, or what is wrong with it. */
export async function tryCall(name: string, input: unknown, base: string, type: DiagramType, load?: (file: string) => string): Promise<{ call: ToolCall; text: string; renames: Map<string, string> } | { error: string }> {
  const call = checkCall(name, input);
  if ('error' in call) return call;
  const applied = call.name === 'replace_diagram' ? { text: call.yaml, renames: new Map<string, string>() } : applyOperations(base, type, call.operations);
  if ('error' in applied) return applied;
  if (applied.text === base) return { error: 'This change leaves the diagram exactly as it is.' };
  const errs = await problems(applied.text, load);
  if (errs.length) return { error: `The changed YAML does not validate:\n${errs.map((e) => `- ${e}`).join('\n')}\nFix it and call the tool again with the whole change.` };
  return { call, ...applied };
}

export interface AskOptions {
  apiKey: string;
  model: ModelId;
  signal: AbortSignal;
  onProgress(p: AskProgress): void;
  /** The YAML the change is made on, and what reads its includes. */
  base: string;
  type: DiagramType;
  load?: (file: string) => string;
}

/**
 * Sends `content` (the user's turn, after the results owed to earlier tool calls) and runs until
 * Claude answers or proposes a change that draws. The conversation is changed in place, append-only.
 */
export async function ask(c: Conversation, content: string, opts: AskOptions): Promise<Outcome> {
  const client = new Anthropic({ apiKey: opts.apiKey, dangerouslyAllowBrowser: true });
  const owed = settle(c, c.verdict ?? 'Not applied: the user asks for something else instead.');
  c.messages.push({ role: 'user', content: [...owed, { type: 'text', text: content }] });
  c.owed = [];
  c.verdict = undefined;
  c.sent = opts.base;
  let errors: string[] = [];
  let text = '';
  let unreadable = 0;
  for (let attempt = 1; attempt <= 3; ) {
    text = '';
    let writing = 0;
    const stream = client.beta.messages.stream(
      {
        model: opts.model,
        max_tokens: 32000,
        system: [{ type: 'text', text: ASK_SYSTEM, cache_control: { type: 'ephemeral' } }],
        messages: c.messages,
        tools: TOOLS,
        thinking: { type: 'adaptive' },
        output_config: { effort: 'medium' },
        // A declined request is retried on another model by the API itself.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      },
      { signal: opts.signal },
    );
    stream.on('text', (delta) => {
      text += delta;
      opts.onProgress({ text, attempt, ...(writing ? { writing } : {}) });
    });
    stream.on('inputJson', (delta) => {
      writing += delta.length;
      opts.onProgress({ text, attempt, writing });
    });
    let message: Anthropic.Beta.BetaMessage;
    try {
      message = await stream.finalMessage();
    } catch (e) {
      // Only a tool input that could not be parsed at all is retried; API errors and cancel are not.
      if (e instanceof Anthropic.APIError || opts.signal.aborted || ++unreadable > 2) throw e;
      continue;
    }
    if (message.stop_reason === 'refusal') throw new Error('Claude declined this request. Try asking differently.');
    const calls = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
    c.messages.push({ role: 'assistant', content: message.content });
    if (!calls.length) {
      if (message.stop_reason === 'max_tokens') text += '\n\n(The answer was cut off.)';
      return { kind: 'answer', text: text.trim() };
    }
    // Several calls in one turn are one change, applied in order; the first that fails fails it.
    let at = opts.base;
    let renames = new Map<string, string>();
    let done: ToolCall | undefined;
    const results: ToolResult[] = [];
    let failed: string | undefined;
    for (const call of calls) {
      if (failed) {
        results.push({ type: 'tool_result', tool_use_id: call.id, is_error: true, content: 'Not applied: an earlier call in this turn failed.' });
        continue;
      }
      const r =
        message.stop_reason === 'max_tokens'
          ? { error: 'The tool input was cut off (too long). Make the change with fewer or smaller operations.' }
          : await tryCall(call.name, call.input, at, opts.type, opts.load);
      if ('error' in r) {
        failed = r.error;
        results.push({ type: 'tool_result', tool_use_id: call.id, is_error: true, content: r.error });
      } else {
        at = r.text;
        renames = new Map([...renames, ...r.renames]);
        done = done && done.name === 'edit_diagram' && r.call.name === 'edit_diagram' ? { ...r.call, summary: [done.summary, r.call.summary].filter(Boolean).join(' ') } : r.call;
        results.push({ type: 'tool_result', tool_use_id: call.id, content: 'Proposed.' });
      }
    }
    if (!failed && done) {
      c.owed = calls.map((x) => ({ id: x.id }));
      return { kind: 'proposal', proposal: { yaml: at, summary: done.summary, note: text.trim(), call: done, renames } };
    }
    errors = [failed!];
    if (++attempt > 3) {
      // The last errors stay owed: a follow-up starts by telling Claude the change was refused.
      c.messages.push({ role: 'user', content: [...results.map((r) => ({ ...r, content: `${String(r.content)}\n(Shown to the user as refused.)` })), { type: 'text', text: 'The change could not be made valid; it was not shown.' }] });
      // A user turn ends the conversation's tail, so a follow-up has nothing more owed.
      return { kind: 'refused', text: text.trim(), errors };
    }
    c.messages.push({ role: 'user', content: results });
    opts.onProgress({ text: '', attempt });
  }
  return { kind: 'refused', text: text.trim(), errors };
}

/** Pins that follow renamed ids: what was pinned as the old id is pinned as the new one. */
export function renamePins<T extends { nodes?: Record<string, unknown>; groups?: Record<string, unknown>; locked?: string[] }>(pins: T | undefined, renames: Map<string, string>): T | undefined {
  if (!pins || !renames.size) return pins;
  const move = <V>(m: Record<string, V> | undefined) => (m ? Object.fromEntries(Object.entries(m).map(([k, v]) => [renames.get(k) ?? k, v])) : m);
  return { ...pins, ...(pins.nodes ? { nodes: move(pins.nodes) } : {}), ...(pins.groups ? { groups: move(pins.groups) } : {}), ...(pins.locked ? { locked: pins.locked.map((k) => renames.get(k) ?? k) } : {}) };
}
