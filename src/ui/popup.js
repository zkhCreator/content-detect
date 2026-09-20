/**
 * Purpose: render content value, AI/emotion analysis, supporting account fit and local settings.
 * Inputs: user events and redacted background messages. Outputs: text-only DOM updates.
 * Decisions: never request the saved key; no automatic analysis on open; poll active jobs.
 * Non-goals: API calls, content extraction, HTML rendering from pages or model responses.
 */
import { DIMENSIONS } from '../core/evaluation.js';
import { ANALYSES } from '../core/content-analysis.js';
import { VALUE_DIMENSIONS } from '../core/content-value.js';

const api = globalThis.browser ?? globalThis.chrome;
const $ = id => document.getElementById(id);
let settings = { hasKey: false, goal: '' };
let tabId = null;
let epoch = 0;
let poll;
let busy = false;

async function send(message) {
  let reply;
  try { reply = await api.runtime.sendMessage(message); }
  catch { throw new Error('扩展连接已中断，请重新打开插件。'); }
  if (!reply?.ok) throw new Error(reply?.error?.message ?? '操作未完成，请重新打开插件。');
  return reply.data;
}

function notice(message = '', kind = 'error') {
  $('notice').textContent = message;
  $('notice').dataset.kind = kind;
  $('notice').hidden = !message;
}

function showTab(name) {
  for (const tab of ['check', 'settings']) {
    const selected = tab === name;
    $(`${tab}-tab`).setAttribute('aria-selected', String(selected));
    $(`${tab}-tab`).tabIndex = selected ? 0 : -1;
    $(`${tab}-panel`).hidden = !selected;
  }
}

function renderSettings() {
  $('direction-text').textContent = settings.goal || '设定受众与关注主题，检查时也会提供账号匹配建议。';
  $('goal').value = settings.goal;
  $('goal-count').textContent = `${settings.goal.length.toLocaleString()} / 2,000`;
  $('api-key').value = '';
  $('api-key').type = 'password';
  $('toggle-key').textContent = '显示';
  $('toggle-key').setAttribute('aria-pressed', 'false');
  $('api-key').placeholder = settings.hasKey ? '已保存 · 留空保留，填写可替换' : '粘贴你的 API key';
  $('api-key').required = !settings.hasKey;
  $('clear-settings').disabled = !settings.hasKey && !settings.goal;
  renderAction();
}

function renderAction() {
  const configured = settings.hasKey && Boolean(settings.goal);
  $('analyze').disabled = busy || (configured && tabId === null);
  $('analyze').textContent = busy ? '正在审查…' : !configured ? '配置 Key 与审查背景 ↗' : tabId === null ? '请在普通网页中打开插件' : document.body.dataset.state === 'done' ? '重新审查当前内容 ↗' : '审查当前内容 ↗';
}

function renderAnalysis(analysis) {
  $('analysis-summaries').replaceChildren();
  $('analysis-probabilities').replaceChildren();
  $('analysis-details').hidden = !analysis;
  const reasons = {
    insufficient: '文字或上下文不足，暂不判断。',
    uncertain: '现有证据不能支持明确分类。',
    lowConfidence: '模型判断分歧较大，建议人工复核。',
  };
  for (const { id, label, options } of ANALYSES) {
    const answer = analysis?.[id];
    const row = document.createElement('div');
    row.className = 'analysis-row';
    row.id = `analysis-${id}`;
    const heading = document.createElement('span');
    heading.textContent = label;
    const decision = document.createElement('strong');
    decision.className = 'analysis-decision';
    decision.textContent = answer ? options[answer.decision] ?? '无法判断' : '待重新检查';
    row.append(heading, decision);
    if (!answer || answer.reason) {
      const explanation = document.createElement('small');
      explanation.textContent = answer ? reasons[answer.reason] : '旧结果不含此项，重新检查即可获取。';
      row.append(explanation);
    }
    $('analysis-summaries').append(row);
    if (answer) {
      const group = document.createElement('div');
      group.className = 'probability-group';
      const title = document.createElement('p');
      title.textContent = `${label} · 模型置信度 ${Math.round(answer.confidence * 100)}%`;
      group.append(title);
      for (const [key, name] of Object.entries(options)) {
        const item = document.createElement('div');
        const text = document.createElement('span');
        text.textContent = name;
        const probability = document.createElement('span');
        probability.textContent = `${Math.round(answer.probabilities[key] * 100)}%`;
        item.append(text, probability);
        group.append(item);
      }
      $('analysis-probabilities').append(group);
    }
  }
}

function renderContentValue(contentValue) {
  const reasons = {
    insufficient: '上下文不足，暂不评分。',
    partialStructure: '选区、截断或整页回退不能代表完整正文，暂不判断全文节奏。',
    lowConfidence: '模型判断分歧较大，暂不展示评分，请人工复核。',
  };
  $('value-summaries').replaceChildren(...VALUE_DIMENSIONS.map(({ id, label, feeling, description, summaries }) => {
    const answer = contentValue?.[id];
    const row = document.createElement('div');
    row.className = 'value-row';
    row.id = `value-${id}`;
    const heading = document.createElement('div');
    heading.className = 'value-heading';
    const title = document.createElement('strong');
    title.textContent = label;
    title.title = description;
    const rating = document.createElement('span');
    rating.className = 'value-rating';
    rating.textContent = !answer ? '待重新检查' : answer.reason ? answer.reason === 'lowConfidence' ? '待复核' : '无法判断' : `${answer.score.toFixed(1)} / 4`;
    heading.append(title, rating);
    const quote = document.createElement('p');
    quote.className = 'value-feeling';
    quote.textContent = `“${feeling}”`;
    row.append(heading, quote);
    if (answer && !answer.reason) {
      const meter = document.createElement('span');
      meter.className = 'meter value-meter';
      meter.setAttribute('aria-hidden', 'true');
      const fill = document.createElement('span');
      fill.style.width = `${answer.score * 25}%`;
      meter.append(fill);
      row.append(meter);
    }
    const explanation = document.createElement('p');
    explanation.className = 'value-explanation';
    explanation.textContent = !answer ? '旧结果不含此项，重新检查即可获取。' : answer.reason ? reasons[answer.reason] : `邻近评分标准：${summaries[Math.round(answer.score)]}`;
    row.append(explanation);
    return row;
  }));
  $('value-rubrics').replaceChildren(...VALUE_DIMENSIONS.map(({ label, description, summaries }) => {
    const group = document.createElement('div');
    group.className = 'probability-group';
    const title = document.createElement('p');
    title.textContent = `${label} · ${description}`;
    const list = document.createElement('ol');
    list.start = 0;
    list.replaceChildren(...summaries.map(text => {
      const item = document.createElement('li');
      item.textContent = text;
      return item;
    }));
    group.append(title, list);
    return group;
  }));
}

function renderJob(job) {
  clearTimeout(poll);
  busy = job?.status === 'running';
  const done = job?.status === 'done';
  document.body.dataset.state = busy ? 'running' : done ? 'done' : 'idle';
  $('check-panel').setAttribute('aria-busy', String(busy));
  $('running').hidden = !busy;
  $('result').hidden = !done;
  if (job?.status === 'error') notice(job.error.message);
  if (done) {
    const { result, page } = job;
    const names = { share: ['适合转发', '↗'], review: ['建议先复核', '≈'], skip: ['不建议转发', '−'] };
    const [label, symbol] = names[result.verdict];
    $('result').dataset.verdict = result.verdict;
    $('verdict').textContent = label;
    $('verdict-symbol').textContent = symbol;
    $('source-title').textContent = page.title || '未命名页面';
    $('source-meta').textContent = `${page.origin} · ${page.scope === 'selection' ? '选区' : '正文'} ${page.characters.toLocaleString()} 字符 · ${new Date(job.completedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    renderAnalysis(result.analysis);
    renderContentValue(result.contentValue);
    $('dimensions').replaceChildren(...DIMENSIONS.map(dimension => {
      const value = result.values[dimension.id];
      const row = document.createElement('div');
      row.className = 'dimension';
      row.title = dimension.description;
      row.dataset.caution = String(dimension.positive ? value <= 0.7 : value >= 0.3);
      const label = document.createElement('span');
      label.textContent = dimension.label + (dimension.positive ? '' : ' ↓');
      const meter = document.createElement('span');
      meter.className = 'meter';
      meter.setAttribute('aria-hidden', 'true');
      const fill = document.createElement('span');
      fill.style.width = `${value * 100}%`;
      meter.append(fill);
      const number = document.createElement('span');
      number.className = 'dimension-value';
      number.textContent = `${Math.round(value * 100)}%`;
      row.append(label, meter, number);
      return row;
    }));
    $('reasons').replaceChildren(...result.reasons.map(text => {
      const item = document.createElement('li');
      item.textContent = text;
      return item;
    }));
  }
  renderAction();
  if (busy) {
    const currentEpoch = epoch;
    poll = setTimeout(async () => {
      try {
        const next = await send({ type: 'STATUS', tabId });
        if (currentEpoch !== epoch) return;
        renderJob(next);
        if (!next) notice('页面或设定已变更，请重新检查。');
      } catch (error) {
        if (currentEpoch !== epoch) return;
        renderJob(null);
        notice(error.message);
      }
    }, 700);
  }
}

for (const name of ['check', 'settings']) {
  $(`${name}-tab`).addEventListener('click', () => showTab(name));
  $(`${name}-tab`).addEventListener('keydown', event => {
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const next = event.key === 'Home' ? 'check' : event.key === 'End' ? 'settings' : name === 'check' ? 'settings' : 'check';
      showTab(next);
      $(`${next}-tab`).focus();
    }
  });
}
$('edit-direction').addEventListener('click', () => { showTab('settings'); $('goal').focus(); });
$('goal').addEventListener('input', () => { $('goal-count').textContent = `${$('goal').value.length.toLocaleString()} / 2,000`; });
$('toggle-key').addEventListener('click', () => {
  const show = $('api-key').type === 'password';
  $('api-key').type = show ? 'text' : 'password';
  $('toggle-key').textContent = show ? '隐藏' : '显示';
  $('toggle-key').setAttribute('aria-pressed', String(show));
  $('toggle-key').setAttribute('aria-label', show ? '隐藏输入的 Key' : '显示输入的 Key');
});
$('settings-form').addEventListener('submit', async event => {
  event.preventDefault();
  $('save-settings').disabled = true;
  $('clear-settings').disabled = true;
  try {
    settings = await send({ type: 'SAVE_SETTINGS', apiKey: $('api-key').value, goal: $('goal').value });
    epoch++;
    renderSettings();
    renderJob(null);
    notice('账号设定已保存在本地。可以开始检查内容了。', 'success');
    showTab('check');
  } catch (error) { notice(error.message); }
  finally {
    $('save-settings').disabled = false;
    $('clear-settings').disabled = !settings.hasKey && !settings.goal;
  }
});
$('clear-settings').addEventListener('click', async () => {
  $('clear-settings').disabled = true;
  $('save-settings').disabled = true;
  try {
    settings = await send({ type: 'CLEAR_SETTINGS' });
    epoch++;
    renderSettings();
    renderJob(null);
    notice('已清除本地 Key、账号方向和会话结果。', 'success');
  } catch (error) { notice(error.message); }
  finally {
    $('save-settings').disabled = false;
    $('clear-settings').disabled = !settings.hasKey && !settings.goal;
  }
});
$('analyze').addEventListener('click', async () => {
  if (!settings.hasKey || !settings.goal) { showTab('settings'); $('api-key').focus(); return; }
  const currentEpoch = ++epoch;
  notice();
  renderJob({ status: 'running' });
  try {
    const job = await send({ type: 'CHECK', tabId });
    if (currentEpoch === epoch) renderJob(job);
  } catch (error) {
    if (currentEpoch !== epoch) return;
    renderJob(null);
    notice(error.message);
  }
});

async function initialize() {
  try {
    const context = await send({ type: 'CONTEXT' });
    settings = context.settings;
    tabId = context.tabId;
    renderSettings();
    renderJob(context.job);
  } catch (error) { notice(error.message); $('analyze').textContent = '请重新打开插件'; }
}
initialize();
