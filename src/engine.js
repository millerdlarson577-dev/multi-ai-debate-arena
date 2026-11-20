'use strict';

const { callProvider } = require('./providers');

/**
 * 圆桌辩论编排引擎。
 * @param {object}   opts
 * @param {string}   opts.topic         讨论议题
 * @param {number}   opts.rounds         辩论轮数
 * @param {Array}    opts.participants   已解析的参与者（含 apiKey/baseURL/model）
 * @param {Function} opts.emit          事件回调 emit(event)
 * @param {AbortSignal} [opts.signal]    中断信号
 */
async function runDebate({ topic, rounds, participants, emit, signal }) {
  const history = []; // 发给各模型的对话上下文
  const transcript = []; // 完整记录（用于结论阶段）

  emit({ type: 'start', participants: participants.map((p) => ({ id: p.id, name: p.name, color: p.color })) });

  // 轮次发言
  for (let round = 1; round <= rounds; round += 1) {
    for (const p of participants) {
      if (signal?.aborted) throw new Error('已被用户中断');

      const system = buildSystemPrompt(p);
      const task =
        round === 1
          ? '请给出你对该议题的初步立场和 2~3 条核心理由，简体中文，150 字以内，直接发言。'
          : '请先指出上一轮发言中你不认同或需要补充的观点并简要反驳，再说明你本轮立场是否调整，简体中文，150 字以内，直接发言。';

      const userContent = buildUserPrompt(topic, transcript, task);
      let text;
      try {
        text = await callProvider(p, {
          system,
          history: [...history, { role: 'user', content: userContent }],
          temperature: 0.85,
          maxTokens: 500,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        emit({ type: 'error', speaker: { id: p.id, name: p.name, color: p.color }, message });
        continue;
      }

      const clean = text.trim();
      transcript.push({ round, speaker: p.name, color: p.color, text: clean });
      // 上下文中把发言者身份写进内容，便于后续模型区分
      history.push({ role: 'assistant', content: `【${p.name}】${clean}` });

      emit({ type: 'message', round, speaker: { id: p.id, name: p.name, color: p.color }, text: clean });
    }
  }

  // 结论阶段：每位参与者给出立场与理由
  const conclusionItems = [];
  for (const p of participants) {
    if (signal?.aborted) throw new Error('已被用户中断');

    const system = `${p.persona}\n你是圆桌讨论的参与者，现在需要基于全场记录给出最终判断。全程使用简体中文。`;
    const userContent = buildConclusionPrompt(topic, transcript);

    let raw;
    try {
      raw = await callProvider(p, {
        system,
        history: [{ role: 'user', content: userContent }],
        temperature: 0.3,
        maxTokens: 300,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      emit({ type: 'error', speaker: { id: p.id, name: p.name, color: p.color }, message });
      conclusionItems.push({ id: p.id, name: p.name, color: p.color, stance: '未表态', reason: `调用失败：${message}` });
      continue;
    }

    const { stance, reason } = parseConclusion(raw);
    conclusionItems.push({ id: p.id, name: p.name, color: p.color, stance, reason });
  }

  const consensus = buildConsensus(conclusionItems);
  emit({ type: 'conclusion', items: conclusionItems, consensus });
  emit({ type: 'done' });
  return { transcript, conclusionItems, consensus };
}

function buildSystemPrompt(p) {
  return [
    `你在一个由多个 AI 组成的圆桌讨论群里，你的代号是「${p.name}」。`,
    `你的立场性格：${p.persona}`,
    '要求：全程使用简体中文；直接给出观点，不要客套，不要复述题目，不要使用 Markdown 标题或列表符号；可以反驳他人，但保持就事论事。',
  ].join('\n');
}

function buildUserPrompt(topic, transcript, task) {
  const lines = [`议题：${topic}`, ''];
  if (transcript.length === 0) {
    lines.push('（这是第一轮发言，前面还没有其他发言。）');
  } else {
    lines.push('前面已有发言：');
    for (const t of transcript) {
      lines.push(`[第${t.round}轮 · ${t.speaker}] ${t.text}`);
    }
  }
  lines.push('');
  lines.push(task);
  return lines.join('\n');
}

function buildConclusionPrompt(topic, transcript) {
  const lines = [`议题：${topic}`, '', '全场讨论记录：'];
  for (const t of transcript) {
    lines.push(`[第${t.round}轮 · ${t.speaker}] ${t.text}`);
  }
  lines.push('');
  lines.push('请严格按下面两行格式输出，不要多加其他内容：');
  lines.push('【立场】从 支持 / 反对 / 有条件支持 / 中立 中选择一项');
  lines.push('【理由】一句话说明核心理由，80 字以内');
  return lines.join('\n');
}

function parseConclusion(raw) {
  const text = String(raw || '').trim();
  const stanceMatch = text.match(/【立场】\s*([^\n【]+)/);
  const reasonMatch = text.match(/【理由】\s*([^\n【]+)/);
  let stance = stanceMatch ? stanceMatch[1].trim() : '中立';
  const reason = reasonMatch ? reasonMatch[1].trim() : text.slice(0, 80);
  if (!['支持', '反对', '有条件支持', '中立'].includes(stance)) stance = '中立';
  return { stance, reason };
}

function buildConsensus(items) {
  const valid = items.filter((i) => i.stance !== '未表态');
  if (valid.length === 0) return { summary: '未能形成有效结论。', majority: '无', counts: {} };

  const counts = {};
  for (const i of valid) counts[i.stance] = (counts[i.stance] || 0) + 1;
  const majority = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  const agree = valid.filter((i) => i.stance === majority).map((i) => i.name);
  const disagree = valid.filter((i) => i.stance !== majority).map((i) => `${i.name}（${i.stance}）`);

  const summary =
    `多数意见为「${majority}」（${agree.join('、')}）` +
    (disagree.length ? `；持不同意见：${disagree.join('、')}。` : '，全场基本达成一致。');
  return { summary, majority, counts };
}

module.exports = { runDebate };
