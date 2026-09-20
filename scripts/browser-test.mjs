/**
 * Purpose: test the actual built MV3 extension, popup, worker, permissions and extraction.
 * Inputs: isolated Chromium profile and synthetic local article/API responses only.
 * Outputs: assertions and ignored local screenshots; never reads a user's browser profile.
 * The TypeSafe network request is intercepted, so no credentials or data leave this test.
 */
import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { extractPage } from '../src/browser/extract.js';
import { analysisAnswers, choiceAnswer, valueAnswers, scoreAnswer } from '../tests/fixtures/answers.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const fixture = await readFile(new URL('../tests/fixtures/article.html', import.meta.url));
const artifacts = new URL('../artifacts/', import.meta.url);
await mkdir(artifacts, { recursive: true });
const server = createServer((_, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  response.end(fixture);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const address = `http://127.0.0.1:${server.address().port}`;
let context;
let calls = [];
let responseMode = 'share';
let delay = 0;
const goal = '面向独立开发者，分享 AI 产品、开发实践和真实创业经验。偏好具体、克制、有方法的内容；不转发夸大收益、纯营销或无依据的预测。';
const values = { topicFit: .93, audienceValue: .88, toneFit: .91, boundaryConflict: .06, contextEnough: .95 };
const pageErrors = [];

try {
  context = await chromium.launchPersistentContext('', {
    channel: 'chromium', headless: process.env.HEADED !== '1',
    args: [`--disable-extensions-except=${root}dist/chrome`, `--load-extension=${root}dist/chrome`, '--enable-unsafe-extension-debugging'],
  });
  await context.route('https://api.typesafe.ai/**', async route => {
    const request = route.request();
    calls.push({ body: JSON.parse(request.postData()), authorization: request.headers().authorization });
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    if (responseMode === 'auth') return route.fulfill({ status: 401, body: 'SYNTHETIC_PRIVATE_ERROR' });
    if (responseMode === 'rate') return route.fulfill({ status: 429, body: 'SYNTHETIC_PRIVATE_ERROR' });
    if (responseMode === 'malformed') return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    const next = { ...values };
    const analysis = analysisAnswers();
    const contentValue = valueAnswers();
    if (responseMode === 'uncertain-value') contentValue.knowledge = scoreAnswer('knowledge', 3, .3);
    if (responseMode === 'bad-value') delete contentValue.pacing;
    if (responseMode === 'review') next.audienceValue = .5;
    if (responseMode === 'skip') next.boundaryConflict = .95;
    if (responseMode === 'ai-negative') {
      analysis.aiOrigin = choiceAnswer('aiOrigin', 'likely_ai');
      analysis.sentiment = choiceAnswer('sentiment', 'negative');
      analysis.emotion = choiceAnswer('emotion', 'anger');
    }
    if (responseMode === 'mixed') {
      analysis.aiOrigin = choiceAnswer('aiOrigin', 'likely_ai', .3, .6);
      analysis.sentiment = choiceAnswer('sentiment', 'mixed');
      analysis.emotion = choiceAnswer('emotion', 'mixed');
    }
    if (responseMode === 'bad-analysis') delete analysis.emotion;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      model: 'jev-test-fixture',
      answers: { ...Object.fromEntries(Object.entries(next).map(([key, noul]) => [key, { type: 'noul', noul }])), ...analysis, ...contentValue },
    }) });
  });
  let [worker] = context.serviceWorkers();
  worker ??= await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  // Native popup targets crash this macOS Chromium build under CDP attachment.
  // Trigger the real toolbar permission grant, then load the unchanged packaged UI
  // in a background tab (the documented Playwright popup-page testing approach).
  await worker.evaluate(() => chrome.action.setPopup({ popup: '' }));
  const article = await context.newPage();
  await article.goto(`${address}/article?private=SYNTHETIC_QUERY#SYNTHETIC_HASH`);
  const browserCdp = await context.browser().newBrowserCDPSession();
  const { targetInfos } = await browserCdp.send('Target.getTargets', { filter: [{ type: 'tab', exclude: false }] });
  const targetInfo = targetInfos.find(target => target.url.startsWith(address));
  assert.ok(targetInfo, 'article tab target must exist');
  const openPopup = async () => {
    await article.bringToFront();
    await browserCdp.send('Extensions.triggerAction', { id, targetId: targetInfo.targetId });
    const [popup] = await Promise.all([
      context.waitForEvent('page', { timeout: 10000 }),
      worker.evaluate(() => chrome.tabs.create({ url: chrome.runtime.getURL('popup.html'), active: false })),
    ]);
    popup.on('pageerror', error => pageErrors.push(error.message));
    await popup.waitForLoadState();
    await popup.setViewportSize({ width: 406, height: 600 });
    await expect(popup.locator('#analyze')).not.toHaveText('正在加载…');
    return popup;
  };
  const capture = async (popup, name) => {
    await popup.screenshot({ path: fileURLToPath(new URL(name, artifacts)), fullPage: true });
    assert.equal(await popup.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'popup must not overflow horizontally');
  };
  let popup = await openPopup();
  await capture(popup, '01-welcome.png');
  assert.equal(calls.length, 0, 'opening the extension must not call the provider');
  await popup.getByRole('button', { name: '先设定我的账号方向 ↗' }).click();
  await popup.getByLabel('Jev API key', { exact: true }).fill('fixture-key-not-a-credential');
  await popup.getByLabel('账号方向', { exact: true }).fill(goal);
  await popup.getByRole('button', { name: '保存账号设定' }).click();
  await expect(popup.locator('#notice')).toContainText('已保存在本地');
  assert.equal(calls.length, 0, 'saving settings must not call the provider');
  await popup.getByRole('tab', { name: '账号设定' }).click();
  await expect(popup.locator('#api-key')).toHaveValue('');
  await capture(popup, '02-settings.png');
  await popup.getByRole('tab', { name: '内容检查' }).click();
  await popup.locator('#analyze').click();
  await expect(popup.locator('#verdict')).toHaveText('适合转发');
  assert.equal(calls.length, 1);
  assert.equal(Object.keys(calls[0].body.questions).length, 12, 'all judgments share one request');
  await expect(popup.locator('#value-summaries .value-row')).toHaveCount(4);
  await expect(popup.locator('#value-enjoyment .value-rating')).toHaveText('1.1 / 4');
  await expect(popup.locator('#value-knowledge .value-rating')).toHaveText('2.9 / 4');
  await expect(popup.locator('#value-resonance .value-rating')).toHaveText('2.0 / 4');
  await expect(popup.locator('#value-pacing .value-rating')).toHaveText('2.9 / 4');
  await popup.locator('#value-details summary').click();
  await expect(popup.locator('#value-rubrics ol li')).toHaveCount(20);
  await popup.locator('#value-details summary').click();
  await expect(popup.locator('#analysis-aiOrigin .analysis-decision')).toHaveText('偏向人工写作');
  await expect(popup.locator('#analysis-sentiment .analysis-decision')).toHaveText('中性');
  await expect(popup.locator('#analysis-emotion .analysis-decision')).toHaveText('平静／客观');
  await popup.locator('#analysis-details summary').click();
  await expect(popup.locator('#analysis-probabilities')).toContainText('模型置信度 80%');
  await expect(popup.locator('#analysis-probabilities')).toContainText('90%');
  await popup.locator('#analysis-details summary').click();
  assert.equal(calls[0].authorization, 'Bearer fixture-key-not-a-credential');
  assert.equal(calls[0].body.state.accountGoal, goal);
  assert.equal(calls[0].body.state.page.sourceOrigin, address);
  assert.ok(calls[0].body.state.page.text.includes('构建 AI 产品'));
  assert.equal(JSON.stringify(calls[0].body).includes('SENTINEL'), false, 'hidden, form and navigation text must be excluded');
  assert.equal(JSON.stringify(calls[0].body).includes('SYNTHETIC_QUERY'), false);
  await capture(popup, '03-result.png');
  await popup.close();
  popup = await openPopup();
  await expect(popup.locator('#verdict')).toHaveText('适合转发');
  assert.equal(calls.length, 1, 'reopening must recover result without an extra API request');
  const storage = await worker.evaluate(async () => ({ local: await chrome.storage.local.get(null), session: await chrome.storage.session.get(null), sync: await chrome.storage.sync.get(null) }));
  assert.deepEqual(storage.sync, {});
  for (const marker of ['fixture-key', '构建 AI 产品', 'SYNTHETIC_QUERY', 'SYNTHETIC_HASH']) assert.equal(JSON.stringify(storage.session).includes(marker), false);
  assert.deepEqual(Object.keys(storage.local), ['settings']);
  assert.equal(storage.session.job.result.analysis.aiOrigin.decision, 'likely_human');

  // A pre-update cached result stays readable and explicitly asks for a new check.
  await worker.evaluate(async () => {
    const { job } = await chrome.storage.session.get('job');
    delete job.result.analysis;
    delete job.result.contentValue;
    await chrome.storage.session.set({ job });
  });
  await popup.close();
  popup = await openPopup();
  await expect(popup.locator('#analysis-aiOrigin .analysis-decision')).toHaveText('待重新检查');
  await expect(popup.locator('#analysis-details')).toBeHidden();
  await expect(popup.locator('#value-pacing .value-rating')).toHaveText('待重新检查');
  assert.equal(calls.length, 1, 'upgrading never silently sends the page again');

  responseMode = 'ai-negative';
  await popup.locator('#analyze').click();
  await expect(popup.locator('#analysis-aiOrigin .analysis-decision')).toHaveText('疑似 AI 生成');
  await expect(popup.locator('#analysis-sentiment .analysis-decision')).toHaveText('负面');
  await expect(popup.locator('#analysis-emotion .analysis-decision')).toHaveText('愤怒／不满');
  await expect(popup.locator('#verdict')).toHaveText('适合转发');
  await capture(popup, '05-ai-emotion.png');
  responseMode = 'mixed';
  await popup.locator('#analyze').click();
  await expect(popup.locator('#analysis-aiOrigin .analysis-decision')).toHaveText('无法判断');
  await expect(popup.locator('#analysis-aiOrigin')).toContainText('模型判断分歧较大');
  await expect(popup.locator('#analysis-sentiment .analysis-decision')).toHaveText('正负混合');
  await expect(popup.locator('#analysis-emotion .analysis-decision')).toHaveText('多种情绪交织');
  await capture(popup, '06-uncertain-mixed.png');

  responseMode = 'uncertain-value';
  await popup.locator('#analyze').click();
  await expect(popup.locator('#value-knowledge .value-rating')).toHaveText('待复核');
  await expect(popup.locator('#value-knowledge .meter')).toHaveCount(0);
  await expect(popup.locator('#value-enjoyment .value-rating')).toHaveText('1.1 / 4');
  await capture(popup, '07-value-review.png');

  responseMode = 'review';
  await popup.locator('#analyze').click();
  await expect(popup.locator('#verdict')).toHaveText('建议先复核');
  await capture(popup, '04-review.png');
  responseMode = 'skip';
  await popup.locator('#analyze').click();
  await expect(popup.locator('#verdict')).toHaveText('不建议转发');
  for (const [mode, expected] of [['auth', 'API key 无效'], ['rate', '请求频率或额度受限'], ['malformed', '无法识别的结果'], ['bad-analysis', '无法识别的结果'], ['bad-value', '无法识别的结果']]) {
    responseMode = mode;
    await popup.locator('#analyze').click();
    await expect(popup.locator('#notice')).toContainText(expected);
    assert.equal((await popup.locator('body').innerText()).includes('SYNTHETIC_PRIVATE_ERROR'), false);
    await expect(popup.locator('#analyze')).toBeEnabled();
  }

  // A real selection in the source tab must survive opening the toolbar popup.
  await popup.close();
  await article.evaluate(() => {
    const range = document.createRange(); range.selectNodeContents(document.querySelector('#selected'));
    const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
  });
  popup = await openPopup();
  responseMode = 'share';
  await popup.locator('#analyze').click();
  await expect(popup.locator('#verdict')).toHaveText('适合转发');
  assert.equal(calls.at(-1).body.state.page.scope, 'selection');
  assert.equal(calls.at(-1).body.state.page.text, await article.locator('#selected').textContent());
  await expect(popup.locator('#analysis-aiOrigin .analysis-decision')).toHaveText('无法判断');
  await expect(popup.locator('#analysis-aiOrigin')).toContainText('文字或上下文不足');
  await expect(popup.locator('#value-pacing .value-rating')).toHaveText('无法判断');
  await expect(popup.locator('#value-pacing')).toContainText('不能代表完整正文');
  await expect(popup.locator('#value-knowledge .value-rating')).toHaveText('2.9 / 4');
  await capture(popup, '08-selection-pacing.png');

  // Closing the popup does not discard a running worker request.
  delay = 1200;
  const before = calls.length;
  await popup.locator('#analyze').click();
  await expect(popup.locator('#running')).toBeVisible();
  await popup.close();
  popup = await openPopup();
  await expect(popup.locator('#verdict')).toHaveText('适合转发');
  await expect(popup.locator('#result')).toBeVisible();
  assert.equal(calls.length, before + 1);
  delay = 0;

  // Isolated-world injected content cannot read storage or impersonate the popup.
  const access = await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return chrome.scripting.executeScript({ target: { tabId: tab.id }, func: async () => {
      const result = {};
      for (const area of ['local', 'session']) {
        try { await chrome.storage[area].get(null); result[area] = 'exposed'; } catch { result[area] = 'blocked'; }
      }
      result.message = await chrome.runtime.sendMessage({ type: 'CONTEXT' });
      return result;
    } });
  });
  assert.equal(access[0].result.local, 'blocked');
  assert.equal(access[0].result.session, 'blocked');
  assert.equal(access[0].result.message.ok, false);

  // Clear settings without ever returning the stored key to the UI.
  await popup.getByRole('tab', { name: '账号设定' }).click();
  await popup.locator('#clear-settings').click();
  await expect(popup.locator('#notice')).toContainText('已清除');
  assert.deepEqual(await worker.evaluate(() => chrome.storage.local.get(null)), {});
  assert.deepEqual(await worker.evaluate(() => chrome.storage.session.get(null)), {});

  // Extraction edge cases use the same function that is injected by the production build.
  await popup.close();
  await article.setContent('<article><p>Visible</p><div contenteditable="true">PRIVATE_SELECTION</div><p hidden>HIDDEN_SELECTION</p></article>');
  await article.evaluate(() => { const r = document.createRange(); r.selectNodeContents(document.querySelector('article')); getSelection().removeAllRanges(); getSelection().addRange(r); });
  assert.equal((await article.evaluate(extractPage)).text, 'Visible');
  await article.setContent(`<article><p>${'字'.repeat(14000)}</p></article>`);
  const longPage = await article.evaluate(extractPage);
  assert.equal(longPage.text.length, 12000);
  assert.equal(longPage.truncated, true);
  await article.setContent('<div>Fallback page content</div>');
  assert.equal((await article.evaluate(extractPage)).fallback, true);
  await article.setContent('<article><p hidden>hidden</p><input value="private"></article>');
  assert.equal((await article.evaluate(extractPage)).text, '');
  popup = await openPopup();
  await popup.getByRole('tab', { name: '账号设定' }).click();
  await popup.getByLabel('Jev API key', { exact: true }).fill('fixture-key-not-a-credential');
  await popup.getByLabel('账号方向', { exact: true }).fill(goal);
  await popup.getByRole('button', { name: '保存账号设定' }).click();
  await expect(popup.locator('#notice')).toContainText('已保存在本地');
  const beforeEmpty = calls.length;
  await popup.locator('#analyze').click();
  await expect(popup.locator('#notice')).toContainText('没有找到可检查的文字');
  assert.equal(calls.length, beforeEmpty);
  await popup.close();
  await article.goto('chrome://settings');
  popup = await openPopup();
  await expect(popup.locator('#analyze')).toBeDisabled();
  await expect(popup.locator('#analyze')).toHaveText('请在普通网页中打开插件');
  assert.deepEqual(pageErrors, []);
  const report = { browser: await context.browser().version(), assertions: 'passed', provider: 'intercepted synthetic responses; no live Jev call', requests: calls.length, screenshots: ['01-welcome.png', '02-settings.png', '03-result.png', '04-review.png', '05-ai-emotion.png', '06-uncertain-mixed.png', '07-value-review.png', '08-selection-pacing.png'] };
  await writeFile(new URL('browser-report.json', artifacts), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await context?.close();
  await new Promise(resolve => server.close(resolve));
}
