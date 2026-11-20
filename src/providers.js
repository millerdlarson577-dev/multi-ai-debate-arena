'use strict';

/**
 * 六家大模型接入适配层。
 * 统一对外暴露 callProvider(provider, { system, history, temperature, maxTokens }) -> Promise<string>
 *
 * provider 结构：
 * { id, name, type, apiKey, baseURL, model }
 * type: 'openai' | 'anthropic' | 'gemini'
 *  - openai   : OpenAI Chat Completions 兼容（ChatGPT / Codex / DeepSeek / 豆包方舟）
 *  - anthropic: Anthropic Messages 原生格式（Claude）
 *  - gemini   : Google Generative Language 原生格式（Gemini）
 */

const DEFAULT_TIMEOUT_MS = 120_000;

/** 六家默认元数据（不含任何真实密钥） */
const PROVIDER_META = [
  {
    id: 'openai',
    name: 'ChatGPT',
    vendor: 'OpenAI',
    type: 'openai',
    defaultBase: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    envKey: 'OPENAI_API_KEY',
    persona: '平衡综合派：习惯权衡多方利弊，表达周全，擅长归纳共识。',
    color: '#10a37f',
  },
  {
    id: 'claude',
    name: 'Claude',
    vendor: 'Anthropic',
    type: 'anthropic',
    defaultBase: 'https://api.anthropic.com',
    defaultModel: 'claude-haiku-4-5',
    envKey: 'ANTHROPIC_API_KEY',
    persona: '严谨审慎派：擅长挑出逻辑漏洞、前提假设与潜在风险，措辞克制。',
    color: '#d97757',
    disabled: true, // 当前网络/账号下 403 不可用，先从参与列表移除；恢复时删除本行即可
  },
  {
    id: 'codex',
    name: 'Codex',
    vendor: 'OpenAI Codex（兼容端点）',
    type: 'openai',
    defaultBase: 'https://api.openai.com/v1',
    defaultModel: 'gpt-5-codex',
    envKey: 'CODEX_API_KEY',
    persona: '工程落地派：从可执行性、实现成本、技术约束与边界条件角度切入。',
    color: '#6366f1',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    vendor: '深度求索',
    type: 'openai',
    defaultBase: 'https://api.deepseek.com',
    defaultModel: 'deepseek-chat',
    envKey: 'DEEPSEEK_API_KEY',
    persona: '务实直接派：观点鲜明、不绕弯，优先给出可落地的判断与理由。',
    color: '#4d6bfe',
  },
  {
    id: 'gemini',
    name: 'Gemini',
    vendor: 'Google',
    type: 'gemini',
    defaultBase: 'https://generativelanguage.googleapis.com',
    defaultModel: 'gemini-flash-lite-latest',
    envKey: 'GEMINI_API_KEY',
    persona: '发散联想派：擅长跨领域类比、长期视角与新颖角度，思路开阔。',
    color: '#34a853',
  },
  {
    id: 'doubao',
    name: '豆包',
    vendor: '火山引擎方舟',
    type: 'openai',
    defaultBase: 'https://ark.cn-beijing.volces.com/api/v3',
    defaultModel: 'doubao-pro-32k',
    envKey: 'DOUBAO_API_KEY',
    persona: '本土视角派：结合中文语境、国内现实可行性与用户体验来讨论问题。',
    color: '#3b82f6',
  },
];

/** 按 id 取元数据 */
function getMeta(id) {
  return PROVIDER_META.find((m) => m.id === id) || null;
}

async function fetchWithTimeout(url, options, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { ...options, signal: controller.signal });
    return resp;
  } finally {
    clearTimeout(timer);
  }
}

/** 统一调用入口 */
async function callProvider(provider, { system, history, temperature = 0.8, maxTokens = 600 } = {}) {
  const { type, apiKey, baseURL, model } = provider;
  if (!apiKey) throw new Error(`未配置 ${provider.name} 的 API Key`);
  if (!model) throw new Error(`未配置 ${provider.name} 的模型名`);

  switch (type) {
    case 'openai':
      return callOpenAICompatible({ apiKey, baseURL, model, system, history, temperature, maxTokens });
    case 'anthropic':
      return callAnthropic({ apiKey, baseURL, model, system, history, temperature, maxTokens });
    case 'gemini':
      return callGemini({ apiKey, baseURL, model, system, history, temperature, maxTokens });
    default:
      throw new Error(`未知接入类型：${type}`);
  }
}

/** OpenAI Chat Completions 兼容格式 */
async function callOpenAICompatible({ apiKey, baseURL, model, system, history, temperature, maxTokens }) {
  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  for (const h of history) messages.push({ role: h.role, content: h.content });

  const url = `${baseURL.replace(/\/+$/, '')}/chat/completions`;
  const resp = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, messages, temperature, max_tokens: maxTokens }),
  });

  const text = await resp.text();
  if (!resp.ok) throw new Error(`HTTP ${resp.status}：${text.slice(0, 300)}`);
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`返回解析失败：${text.slice(0, 200)}`);
  }
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error(`返回中没有可用内容：${text.slice(0, 200)}`);
  return typeof content === 'string' ? content : JSON.stringify(content);
}

/** Anthropic Messages 原生格式 */
async function callAnthropic({ apiKey, baseURL, model, system, history, temperature, maxTokens }) {
  const messages = history.map((h) => ({
    role: h.role === 'assistant' ? 'assistant' : 'user',
    content: h.content,
  }));

  const url = `${baseURL.replace(/\/+$/, '')}/v1/messages`;
  const resp = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({ model, max_tokens: maxTokens, system: system || undefined, messages, temperature }),
  });

  const text = await resp.text();
  if (!resp.ok) throw new Error(`HTTP ${resp.status}：${text.slice(0, 300)}`);
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`返回解析失败：${text.slice(0, 200)}`);
  }
  const block = data?.content?.find((b) => b.type === 'text');
  if (!block?.text) throw new Error(`返回中没有可用内容：${text.slice(0, 200)}`);
  return block.text;
}

/** Google Gemini 原生格式 */
async function callGemini({ apiKey, baseURL, model, system, history, temperature, maxTokens }) {
  const contents = history.map((h) => ({
    role: h.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: h.content }],
  }));

  const body = {
    contents,
    generationConfig: { temperature, maxOutputTokens: maxTokens },
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };

  const url = `${baseURL.replace(/\/+$/, '')}/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const resp = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const text = await resp.text();
  if (!resp.ok) throw new Error(`HTTP ${resp.status}：${text.slice(0, 300)}`);
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`返回解析失败：${text.slice(0, 200)}`);
  }
  const parts = data?.candidates?.[0]?.content?.parts;
  const content = Array.isArray(parts) ? parts.map((p) => p.text || '').join('') : '';
  if (!content) throw new Error(`返回中没有可用内容：${text.slice(0, 200)}`);
  return content;
}

module.exports = { PROVIDER_META, getMeta, callProvider };
