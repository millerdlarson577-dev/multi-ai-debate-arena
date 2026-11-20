'use strict';

const STORAGE_KEY = 'ai-debate-settings-v1';

const els = {
  topic: document.getElementById('topic'),
  rounds: document.getElementById('rounds'),
  roundsValue: document.getElementById('roundsValue'),
  btnStart: document.getElementById('btnStart'),
  btnStop: document.getElementById('btnStop'),
  btnClear: document.getElementById('btnClear'),
  participantList: document.getElementById('participantList'),
  messageList: document.getElementById('messageList'),
  conclusionPanel: document.getElementById('conclusionPanel'),
  consensus: document.getElementById('consensus'),
  conclusionList: document.getElementById('conclusionList'),
  btnSettings: document.getElementById('btnSettings'),
  btnCloseDrawer: document.getElementById('btnCloseDrawer'),
  drawer: document.getElementById('drawer'),
  mask: document.getElementById('drawerMask'),
  drawerBody: document.getElementById('drawerBody'),
};

let metaList = [];
let settings = loadSettings();
let abortController = null;
let running = false;

function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch {
    return {};
  }
}
function saveSettings() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}
function settingOf(id) {
  if (!settings[id]) settings[id] = { apiKey: '', model: '', baseURL: '', active: true };
  return settings[id];
}

async function init() {
  try {
    const resp = await fetch('/api/meta');
    const data = await resp.json();
    metaList = data.meta || [];
  } catch {
    metaList = [];
  }
  renderParticipants();
  renderDrawer();
}

// 参与者卡片（主界面）
function renderParticipants() {
  els.participantList.innerHTML = '';
  for (const m of metaList) {
    const s = settingOf(m.id);
    const card = document.createElement('div');
    card.className = 'participant-card' + (s.active ? ' active' : '');
    card.innerHTML = `
      <span class="dot" style="background:${m.color}"></span>
      <div>
        <div class="p-name">${m.name}</div>
        <div class="p-vendor">${m.vendor}</div>
      </div>`;
    card.addEventListener('click', () => {
      s.active = !s.active;
      saveSettings();
      renderParticipants();
      renderDrawer();
    });
    els.participantList.appendChild(card);
  }
}

// 抽屉配置表单
function renderDrawer() {
  els.drawerBody.innerHTML = '';
  for (const m of metaList) {
    const s = settingOf(m.id);
    const card = document.createElement('div');
    card.className = 'cfg-card';
    card.innerHTML = `
      <div class="cfg-head">
        <span class="dot" style="width:10px;height:10px;border-radius:50%;background:${m.color};display:inline-block"></span>
        <span class="p-name">${m.name}</span>
        <span class="p-vendor">${m.vendor}</span>
      </div>
      <div class="cfg-field">
        <label>API Key</label>
        <input type="password" data-id="${m.id}" data-field="apiKey" placeholder="填入 ${m.name} 的密钥" value="${escapeAttr(s.apiKey)}" />
      </div>
      <div class="cfg-field">
        <label>模型名（可保持默认）</label>
        <input type="text" data-id="${m.id}" data-field="model" placeholder="${m.defaultModel}" value="${escapeAttr(s.model)}" />
      </div>
      <details class="cfg-advanced">
        <summary class="hint">高级：自定义 Base URL</summary>
        <div class="cfg-field" style="margin-top:8px">
          <input type="text" data-id="${m.id}" data-field="baseURL" placeholder="${m.defaultBase}" value="${escapeAttr(s.baseURL)}" />
        </div>
      </details>`;
    els.drawerBody.appendChild(card);
  }
  els.drawerBody.querySelectorAll('input').forEach((input) => {
    input.addEventListener('input', () => {
      const s = settingOf(input.dataset.id);
      s[input.dataset.field] = input.value.trim();
      saveSettings();
    });
  });
}

function escapeAttr(v) {
  return String(v || '').replace(/"/g, '&quot;');
}

// 抽屉开关
els.btnSettings.addEventListener('click', () => {
  els.drawer.classList.remove('hidden');
  els.mask.classList.remove('hidden');
});
function closeDrawer() {
  els.drawer.classList.add('hidden');
  els.mask.classList.add('hidden');
}
els.btnCloseDrawer.addEventListener('click', closeDrawer);
els.mask.addEventListener('click', closeDrawer);

els.rounds.addEventListener('input', () => {
  els.roundsValue.textContent = els.rounds.value;
});

els.btnClear.addEventListener('click', () => {
  els.messageList.innerHTML = '<p class="empty-text">输入议题并点击「开始讨论」，六位 AI 将依次发言、互相反驳。</p>';
  els.messageList.classList.add('empty');
  els.conclusionPanel.classList.add('hidden');
  els.consensus.innerHTML = '';
  els.conclusionList.innerHTML = '';
});

els.btnStop.addEventListener('click', () => {
  if (abortController) abortController.abort();
});

els.btnStart.addEventListener('click', startDebate);

async function startDebate() {
  const topic = els.topic.value.trim();
  if (!topic) {
    alert('请先输入讨论议题');
    return;
  }
  const participants = metaList
    .filter((m) => settingOf(m.id).active)
    .map((m) => {
      const s = settingOf(m.id);
      return { id: m.id, apiKey: s.apiKey, model: s.model, baseURL: s.baseURL };
    });
  if (participants.length === 0) {
    alert('请至少勾选一个参与 AI');
    return;
  }

  setRunning(true);
  els.messageList.classList.remove('empty');
  els.messageList.innerHTML = '';
  els.conclusionPanel.classList.add('hidden');
  els.consensus.innerHTML = '';
  els.conclusionList.innerHTML = '';

  abortController = new AbortController();
  try {
    const resp = await fetch('/api/debate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic, rounds: Number(els.rounds.value), participants }),
      signal: abortController.signal,
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${resp.status}`);
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        let event;
        try { event = JSON.parse(line); } catch { continue; }
        handleEvent(event);
      }
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      appendSystem('已手动停止讨论。');
    } else {
      appendSystem(`请求失败：${err.message}`);
    }
  } finally {
    setRunning(false);
    abortController = null;
  }
}

function setRunning(on) {
  running = on;
  els.btnStart.disabled = on;
  els.btnStop.classList.toggle('hidden', !on);
  els.topic.disabled = on;
  els.rounds.disabled = on;
}

function handleEvent(event) {
  switch (event.type) {
    case 'message':
      appendMessage(event.speaker, event.text, event.round);
      break;
    case 'error':
      appendMessage(event.speaker, `调用失败：${event.message}`, null, true);
      break;
    case 'conclusion':
      renderConclusion(event.items, event.consensus);
      break;
    case 'fatal':
      appendSystem(`运行中断：${event.message}`);
      break;
    case 'done':
      break;
    default:
      break;
  }
  scrollToBottom();
}

function appendMessage(speaker, text, round, isError = false) {
  const wrap = document.createElement('div');
  wrap.className = 'message' + (isError ? ' error' : '');
  const initial = speaker.name.slice(0, 1);
  wrap.innerHTML = `
    <div class="avatar" style="background:${speaker.color}">${escapeHtml(initial)}</div>
    <div class="bubble">
      <div class="meta"><span class="name">${escapeHtml(speaker.name)}</span>${round ? ` · 第 ${round} 轮` : ''}</div>
      <div class="text">${escapeHtml(text)}</div>
    </div>`;
  els.messageList.appendChild(wrap);
}

function appendSystem(text) {
  const wrap = document.createElement('div');
  wrap.className = 'message error';
  wrap.innerHTML = `<div class="bubble"><div class="text">${escapeHtml(text)}</div></div>`;
  els.messageList.appendChild(wrap);
}

function renderConclusion(items, consensus) {
  els.conclusionPanel.classList.remove('hidden');
  els.consensus.textContent = consensus?.summary || '已形成结论。';
  els.conclusionList.innerHTML = '';
  for (const item of items) {
    const row = document.createElement('div');
    row.className = 'conclusion-item';
    row.innerHTML = `
      <span class="stance">${escapeHtml(item.stance)}</span>
      <div>
        <div class="p-name" style="font-size:13px;font-weight:600">${escapeHtml(item.name)}</div>
        <div class="reason">${escapeHtml(item.reason)}</div>
      </div>`;
    els.conclusionList.appendChild(row);
  }
}

function escapeHtml(v) {
  return String(v || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function scrollToBottom() {
  window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
}

init();
