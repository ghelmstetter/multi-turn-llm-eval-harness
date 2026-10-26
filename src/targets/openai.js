// OpenAI (Chat Completions). Docs: https://platform.openai.com/docs/api-reference/chat
import { checkResponse } from './index.js';

export async function openaiChat({ system, messages, json = false, model, temperature, maxTokens, key, fetchImpl }) {
  const res = await fetchImpl('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [...(system ? [{ role: 'system', content: system }] : []), ...messages.map((m) => ({ role: m.role, content: m.text }))],
      ...(temperature != null ? { temperature } : {}),
      ...(maxTokens ? { max_completion_tokens: maxTokens } : {}),
      ...(json ? { response_format: { type: 'json_object' } } : {}),
    }),
  });
  const data = await checkResponse(res, 'openai');
  return { text: String(data?.choices?.[0]?.message?.content ?? '').trim(), usage: { input: data?.usage?.prompt_tokens ?? 0, output: data?.usage?.completion_tokens ?? 0 } };
}
