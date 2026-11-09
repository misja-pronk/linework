// Generating with Claude, straight from the browser with the user's own API key. Nothing else in the
// app talks to the network: this runs only when the user asks for it, and the key stays in this browser.
import Anthropic from '@anthropic-ai/sdk';
import { render } from '@cartography/engine';
import { extractYaml, repairPrompt, type Prompt } from './prompt.ts';

export const MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', note: 'best results' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', note: 'faster, cheaper' },
] as const;
export type ModelId = (typeof MODELS)[number]['id'];

export interface Progress {
  /** The answer so far, while it streams. */
  text: string;
  /** 1 for the first try, 2+ for repairs after validation errors. */
  attempt: number;
}

/** Problems that stop the diagram from drawing. */
async function problems(yaml: string, load?: (file: string) => string): Promise<string[]> {
  const r = await render(yaml, { fonts: 'none', load });
  return r.diagnostics.filter((d) => d.severity === 'error').map((d) => (d.line ? `line ${d.line}: ${d.message}` : d.message));
}

/**
 * Asks Claude for the diagram, then checks it with the real engine. Errors go back for a fix, at
 * most twice, so what comes out draws; whatever is left is the user's to fix in the editor.
 */
export async function generate(prompt: Prompt, opts: { apiKey: string; model: ModelId; signal: AbortSignal; onProgress(p: Progress): void; load?: (file: string) => string }): Promise<{ yaml: string; errors: string[] }> {
  const client = new Anthropic({ apiKey: opts.apiKey, dangerouslyAllowBrowser: true });
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: prompt.user }];
  let yaml = '';
  let errors: string[] = [];
  for (let attempt = 1; attempt <= 3; attempt++) {
    let text = '';
    const stream = client.beta.messages.stream(
      {
        model: opts.model,
        max_tokens: 32000,
        system: prompt.system,
        messages,
        output_config: { effort: 'medium' },
        // A declined request is retried on another model by the API itself.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      },
      { signal: opts.signal },
    );
    stream.on('text', (delta) => {
      text += delta;
      opts.onProgress({ text, attempt });
    });
    const message = await stream.finalMessage();
    if (message.stop_reason === 'refusal') throw new Error('Claude declined this request. Try describing it differently.');
    yaml = extractYaml(text);
    errors = await problems(yaml, opts.load);
    if (!errors.length) break;
    messages.push({ role: 'assistant', content: message.content }, { role: 'user', content: repairPrompt(errors) });
  }
  return { yaml, errors };
}

/** A readable message for the ways a call fails. */
export function failure(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return 'The API key was not accepted. Check it and try again.';
  if (e instanceof Anthropic.PermissionDeniedError) return 'This API key may not use that model.';
  if (e instanceof Anthropic.RateLimitError) return 'Too many requests right now. Wait a moment and try again.';
  if (e instanceof Anthropic.APIConnectionError) return 'Could not reach the Claude API. Check your connection.';
  if (e instanceof Anthropic.APIError) return `The Claude API returned an error (${e.status ?? 'unknown'}): ${e.message}`;
  return e instanceof Error ? e.message : String(e);
}
