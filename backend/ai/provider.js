// Thin abstraction over whichever AI backend is actually configured, so a
// route/scheduler calls one function instead of knowing which SDK is live.
// Anthropic is the default/preferred provider; Gemini (free tier) exists as
// a fallback for development/testing when Anthropic credits run out, set
// via AI_PROVIDER=gemini or by having GEMINI_API_KEY but not
// ANTHROPIC_API_KEY. Both providers are driven through the same shape:
// Anthropic's tool `input_schema` (plain JSON Schema: type/properties/
// items/enum/required) is reused as-is for Gemini's function `parameters`,
// since neither provider call site in this app uses anything fancier.
const Anthropic = require('@anthropic-ai/sdk');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001';
const GEMINI_MODEL = 'gemini-3.8-flash';

function activeProvider() {
  if (process.env.AI_PROVIDER === 'gemini' && process.env.GEMINI_API_KEY) return 'gemini';
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  if (process.env.GEMINI_API_KEY) return 'gemini';
  return null;
}

function isAIConfigured() {
  return !!activeProvider();
}

// messages: [{ role: 'user'|'assistant', content: string | ContentBlock[] }]
// ContentBlock (Anthropic shape, reused for both providers):
//   { type: 'text', text }
//   { type: 'image', source: { type: 'base64', media_type, data } }
//   { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }
// tools: [{ name, description, input_schema }] | undefined
// forceToolName: a tool name to force, or null/undefined for "auto, plain text is fine"
// Returns { type: 'tool_use', name, input } | { type: 'text', text }
async function callAI({ system, messages, tools, forceToolName, maxTokens = 2000 }) {
  const provider = activeProvider();
  if (!provider) throw new Error('AI is not configured on this server.');
  return provider === 'gemini'
    ? callGemini({ system, messages, tools, forceToolName, maxTokens })
    : callAnthropic({ system, messages, tools, forceToolName, maxTokens });
}

async function callAnthropic({ system, messages, tools, forceToolName, maxTokens }) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const response = await client.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: maxTokens,
    system,
    messages,
    ...(tools ? { tools, tool_choice: forceToolName ? { type: 'tool', name: forceToolName } : { type: 'auto' } } : {}),
  });
  const toolUse = response.content.find(c => c.type === 'tool_use');
  if (toolUse) return { type: 'tool_use', name: toolUse.name, input: toolUse.input };
  const textBlock = response.content.find(c => c.type === 'text');
  return { type: 'text', text: textBlock ? textBlock.text : '' };
}

function toGeminiParts(content) {
  if (typeof content === 'string') return [{ text: content }];
  return content.map(block => {
    if (block.type === 'text') return { text: block.text };
    if (block.type === 'image' || block.type === 'document') {
      return { inlineData: { mimeType: block.source.media_type, data: block.source.data } };
    }
    return { text: '' };
  });
}

async function callGemini({ system, messages, tools, forceToolName, maxTokens }) {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({
    model: GEMINI_MODEL,
    systemInstruction: system,
    ...(tools ? { tools: [{ functionDeclarations: tools.map(t => ({ name: t.name, description: t.description, parameters: t.input_schema })) }] } : {}),
    ...(tools ? { toolConfig: { functionCallingConfig: forceToolName ? { mode: 'ANY', allowedFunctionNames: [forceToolName] } : { mode: 'AUTO' } } } : {}),
  });

  // Gemini has no separate "system" turn — it's passed as systemInstruction
  // above — and uses 'model' where Anthropic uses 'assistant'.
  const contents = messages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: toGeminiParts(m.content),
  }));

  const result = await model.generateContent({ contents, generationConfig: { maxOutputTokens: maxTokens } });
  const response = result.response;
  const calls = response.functionCalls();
  if (calls && calls.length) return { type: 'tool_use', name: calls[0].name, input: calls[0].args };
  return { type: 'text', text: response.text() };
}

module.exports = { callAI, isAIConfigured, activeProvider };
