/**
 * Purpose: render account settings and explicit page-check states in a packaged popup.
 * Inputs: user events and redacted background messages. Outputs: text-only DOM updates.
 * Decisions: never request the saved key; no automatic analysis on open; poll active jobs.
 * Non-goals: API calls, content extraction, HTML rendering from pages or model responses.
 */
import { DIMENSIONS } from '../core/evaluation.js';

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
  $('direction-text').textContent = settings.goal || '还没有设定方向。先告诉我们你为谁分享、关注什么。';
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
  $('analyze').textContent = busy ? '正在检查…' : !configured ? '先设定我的账号方向 ↗' : tabId === null ? '请在普通网页中打开插件' : document.body.dataset.state === 'done' ? '重新检查当前内容 ↗' : '检查当前页 ↗';
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
