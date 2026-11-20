'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { PROVIDER_META, getMeta } = require('./src/providers');
const { runDebate } = require('./src/engine');

const PORT = Number(process.env.PORT || 3210);
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');

// 启动时加载同目录 .env（不覆盖已有环境变量）
loadEnvFile(path.join(ROOT, '.env'));

// 可选：后端请求走本地 HTTP 代理（海外模型用）。.env 里设 PROXY=http://127.0.0.1:7897
setupProxy();

function setupProxy() {
  const proxy = process.env.PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || '';
  if (!proxy) return;
  try {
    const { ProxyAgent, setGlobalDispatcher } = require('undici');
    setGlobalDispatcher(new ProxyAgent(proxy));
    console.log(`后端已走代理：${proxy}`);
  } catch (e) {
    console.warn('代理模块 undici 未安装，后端保持直连。');
  }
}

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function sendJSON(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1e6) reject(new Error('请求体过大'));
    });
    req.on('end', () => resolve(raw));
    req.on('error', reject);
  });
}

/** 合并前端覆盖值与环境变量兜底，得到可调用的参与者配置 */
function resolveParticipants(list) {
  const resolved = [];
  for (const item of list || []) {
    const meta = getMeta(item.id);
    if (!meta) continue;
    let apiKey = item.apiKey || process.env[meta.envKey] || '';
    // Codex 未单独配置时，兜底复用 OpenAI Key
    if (meta.id === 'codex' && !apiKey) apiKey = process.env.OPENAI_API_KEY || '';
    resolved.push({
      id: meta.id,
      name: meta.name,
      vendor: meta.vendor,
      type: meta.type,
      persona: meta.persona,
      color: meta.color,
      apiKey,
      baseURL: item.baseURL || meta.defaultBase,
      model: item.model || process.env[`${meta.envKey.replace('_API_KEY', '')}_MODEL`] || meta.defaultModel,
    });
  }
  return resolved;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  // 跨域预检
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }

  // 元数据：六家接入配置说明（不含密钥）
  if (url.pathname === '/api/meta' && req.method === 'GET') {
    const meta = PROVIDER_META.filter((m) => !m.disabled).map((m) => ({
      id: m.id,
      name: m.name,
      vendor: m.vendor,
      type: m.type,
      defaultBase: m.defaultBase,
      defaultModel: m.defaultModel,
      envKey: m.envKey,
      persona: m.persona,
      color: m.color,
      configured: Boolean(process.env[m.envKey] || (m.id === 'codex' && process.env.OPENAI_API_KEY)),
    }));
    return sendJSON(res, 200, { meta });
  }

  // 辩论接口：NDJSON 流式返回
  if (url.pathname === '/api/debate' && req.method === 'POST') {
    let body;
    try {
      body = JSON.parse(await readBody(req) || '{}');
    } catch {
      return sendJSON(res, 400, { error: '请求体不是合法 JSON' });
    }

    const topic = String(body.topic || '').trim();
    const rounds = Math.min(Math.max(Number(body.rounds) || 2, 1), 5);
    if (!topic) return sendJSON(res, 400, { error: '请输入讨论议题' });

    const participants = resolveParticipants(body.participants);
    if (participants.length === 0) return sendJSON(res, 400, { error: '至少选择一个参与 AI' });

    const controller = new AbortController();
    req.on('close', () => controller.abort());

    res.writeHead(200, {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*',
      'X-Accel-Buffering': 'no',
    });

    const emit = (event) => {
      res.write(JSON.stringify(event) + '\n');
    };

    try {
      await runDebate({ topic, rounds, participants, emit, signal: controller.signal });
    } catch (err) {
      emit({ type: 'fatal', message: err instanceof Error ? err.message : String(err) });
    } finally {
      res.end();
    }
    return;
  }

  // 静态资源
  let filePath = url.pathname === '/' ? '/index.html' : url.pathname;
  filePath = path.normalize(filePath).replace(/^(\.\.[/\\])+/, '');
  const abs = path.join(PUBLIC_DIR, filePath);
  if (!abs.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(abs, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404 Not Found');
    }
    const ext = path.extname(abs).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`\n六 AI 圆桌辩论已启动：`);
  console.log(`  本机访问：  http://localhost:${PORT}`);
  console.log(`  手机访问：  http://<电脑局域网 IP>:${PORT}（同一 Wi-Fi）`);
  console.log(`  按 Ctrl+C 停止\n`);
});
