// Google Gemini (generateContent). Docs: https://ai.google.dev/api/generate-content
import { checkResponse } from './index.js';

export async function geminiChat({ system, messages, json = false, model, temperature, maxTokens, key, fetchImpl }) {
  const res = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: system ? { parts: [{ text: system }] } : undefined,
      contents: messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.text }] })),
      generationConfig: {
        ...(temperature != null ? { temperature } : {}),
        ...(maxTokens ? { maxOutputTokens: maxTokens } : {}),
        ...(json ? { responseMimeType: 'application/json' } : {}),
      },
    }),
  });
  const data = await checkResponse(res, 'gemini');
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  const u = data?.usageMetadata ?? {};
  // Thinking tokens are billed as output.
  return { text: text.trim(), usage: { input: u.promptTokenCount ?? 0, output: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0) } };
}
