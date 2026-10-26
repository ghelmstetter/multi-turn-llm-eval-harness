// Mock target: deterministic stand-ins for tutors, simulated users and judges, so the whole
// pipeline (and its tests) runs with no API keys and no cost. Mock results show the report
// format only; they say nothing about real models.
//
// Requests carry a `purpose` ('assistant' | 'user' | 'rubric' | 'pairwise'); real vendors ignore it.

const words = (t) => String(t ?? '').split(/\s+/).filter(Boolean).length;
const lastUser = (messages) => [...messages].reverse().find((m) => m.role === 'user')?.text ?? '';

const CONCISE = ['¡Qué bien! ¿Y qué te gusta hacer?', '¡Ah, interesante! ¿Dónde vives?', 'Muy bien. ¿Tienes hermanos?', '¡Claro! ¿Qué vas a hacer mañana?'];
const VERBOSE = [
  "That's great! In Spanish, we would say it a little differently, and there are a few things worth knowing about how sentences are built. ¿Qué te gusta hacer? ¿Y dónde vives? Tell me about your family too, and your plans for the weekend, because that will help us practice several verb forms at once.",
  "Excellent question! Spanish has two verbs for 'to be', ser and estar, and they're used in different situations, which takes a while to get used to. Ser is for identity and estar is for states. ¿Cómo estás hoy? ¿De dónde eres? ¿Qué haces?",
];

function mockAssistant({ messages, behavior }) {
  const n = messages.filter((m) => m.role === 'assistant').length;
  const said = lastUser(messages);
  // A recast: repeat the learner's sentence correctly, without lecturing.
  const recast = /\byo es\b/i.test(said) ? `¡Ah, tú eres ${said.match(/yo es ([^.,!?]+)/i)?.[1] ?? 'así'}! ` : '';
  if (behavior === 'verbose') return recast + VERBOSE[n % VERBOSE.length];
  return recast + CONCISE[n % CONCISE.length];
}

const USER_LINES = ['Hola. Me llamo Greg.', 'Vivo en Montana. Me gusta esquiar.', 'Sí, tengo una hermana.', 'Mañana voy a trabajar.'];

function mockUser({ messages }) {
  const n = messages.filter((m) => m.role === 'user').length; // the simulated user sees the tutor's turns as 'user'
  return USER_LINES[(n - 1 + USER_LINES.length) % USER_LINES.length];
}

function mockRubric({ messages, criteria = [], assistantLabel = 'ASSISTANT' }) {
  const prompt = lastUser(messages);
  const tutorTurns = prompt.split('\n').filter((l) => l.startsWith(`${assistantLabel}: `));
  const avg = tutorTurns.reduce((s, t) => s + words(t), 0) / Math.max(1, tutorTurns.length);
  const short = avg <= 25;
  const scores = Object.fromEntries(criteria.map((c) => [c.id, { score: c.id === 'turn_length' ? (short ? 5 : 2) : short ? 4 : 3, why: `mock judge: average reply ${avg.toFixed(0)} words` }]));
  return JSON.stringify({ scores, summary: 'Mock judgment (no model was called).' });
}

function mockPairwise({ messages }) {
  const prompt = lastUser(messages);
  const a = prompt.match(/REPLY 1:\n([\s\S]*?)\n\nREPLY 2:/)?.[1] ?? '';
  const b = prompt.match(/REPLY 2:\n([\s\S]*?)\n\n(?:WHICH|Which)/)?.[1] ?? '';
  // Prefers the shorter reply, but with a deliberate first-position bias when lengths are close,
  // so the position-swap control has something to catch.
  const [la, lb] = [words(a), words(b)];
  const winner = Math.abs(la - lb) <= Math.max(la, lb) * 0.2 ? '1' : la < lb ? '1' : '2';
  return JSON.stringify({ winner, reason: `mock judge: reply lengths ${la} vs ${lb} words` });
}

export async function mockChat(req) {
  const text = { assistant: mockAssistant, user: mockUser, rubric: mockRubric, pairwise: mockPairwise }[req.purpose ?? 'assistant'](req);
  const input = Math.ceil((String(req.system ?? '').length + req.messages.reduce((s, m) => s + m.text.length, 0)) / 4);
  const output = Math.ceil(text.length / 4);
  // A made-up response time (a fixed start plus time per output token), so reports can show
  // latency in mock runs too. No real waiting happens.
  return { text, usage: { input, output }, simulatedMs: 350 + output * 12 };
}
