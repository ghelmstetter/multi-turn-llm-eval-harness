// Targets: a vendor + model + settings (+ a prompt variant, for prompt A/B tests).
// Every target exposes the same call:
//   chat({ system, messages: [{ role: 'user' | 'assistant', text }], json }) -> { text, usage: { input, output }, ms }
// `fetchImpl` is injectable so tests run with no network and no keys.
import { geminiChat } from './gemini.js';
import { openaiChat } from './openai.js';
import { anthropicChat } from './anthropic.js';
import { mockChat } from './mock.js';

const VENDORS = { gemini: geminiChat, openai: openaiChat, anthropic: anthropicChat, mock: mockChat };

const KEY_ENV = { gemini: 'GEMINI_API_KEY', openai: 'OPENAI_API_KEY', anthropic: 'ANTHROPIC_API_KEY' };

export class RetryableError extends Error {}

/** Retry rate limits and server errors with backoff; anything else fails right away. */
async function withRetries(fn, { tries = 4, baseMs = 1500, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  for (let i = 0; ; i++) {
    try { return await fn(); } catch (e) {
      if (!(e instanceof RetryableError) || i >= tries - 1) throw e;
      await sleep(baseMs * 2 ** i);
    }
  }
}

/** Throw for a non-OK HTTP response: retryable for 429 / 5xx. */
export async function checkResponse(res, vendor) {
  if (res.ok) return res.json();
  const body = await res.text().catch(() => '');
  const msg = `${vendor} ${res.status}: ${body.slice(0, 300)}`;
  throw res.status === 429 || res.status >= 500 ? new RetryableError(msg) : new Error(msg);
}

/**
 * Build a callable target from its config:
 * { id, vendor, model, temperature?, maxTokens?, prompt?, price: { input, output } (USD per 1M tokens), behavior? (mock only) }
 */
export function makeTarget(cfg, { fetchImpl = fetch, env = process.env, mock = false, retry } = {}) {
  const spec = mock ? { ...cfg, vendor: 'mock', behavior: cfg.mockBehavior ?? cfg.behavior ?? 'concise' } : cfg;
  const impl = VENDORS[spec.vendor];
  if (!impl) throw new Error(`Unknown vendor "${spec.vendor}" for target ${cfg.id}`);
  const key = spec.vendor === 'mock' ? null : env[KEY_ENV[spec.vendor]];
  return {
    ...spec,
    id: cfg.id,
    label: cfg.label ?? cfg.id,
    price: mock ? { input: 0, output: 0 } : cfg.price ?? { input: 0, output: 0 },
    async chat(req) {
      if (spec.vendor !== 'mock' && !key) throw new Error(`Set ${KEY_ENV[spec.vendor]} to use target ${cfg.id}`);
      const t0 = Date.now();
      const out = await withRetries(() => impl({ ...req, model: spec.model, temperature: spec.temperature, maxTokens: spec.maxTokens, behavior: spec.behavior, key, fetchImpl }), retry);
      return { ...out, ms: Date.now() - t0 };
    },
  };
}

/** Parse a JSON object from a model reply, tolerating code fences and surrounding text. */
export function parseJson(text) {
  const cleaned = String(text ?? '').replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
  try { return JSON.parse(cleaned); } catch { /* fall through */ }
  const a = cleaned.indexOf('{');
  const b = cleaned.lastIndexOf('}');
  if (a >= 0 && b > a) return JSON.parse(cleaned.slice(a, b + 1));
  throw new Error(`Reply was not JSON: ${cleaned.slice(0, 120)}`);
}
