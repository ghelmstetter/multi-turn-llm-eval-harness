// Anthropic (Messages API). Docs: https://docs.claude.com/en/api/messages
import { checkResponse } from './index.js';

export async function anthropicChat({ system, messages, json = false, model, temperature, maxTokens, key, fetchImpl }) {
  const res = await fetchImpl('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens ?? 1024,
      system: json ? `${system ?? ''}\n\nReply with only a JSON object.`.trim() : system,
      messages: messages.map((m) => ({ role: m.role, content: m.text })),
      ...(temperature != null ? { temperature } : {}),
    }),
  });
  const data = await checkResponse(res, 'anthropic');
  const text = (data?.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  return { text: text.trim(), usage: { input: data?.usage?.input_tokens ?? 0, output: data?.usage?.output_tokens ?? 0 } };
}
