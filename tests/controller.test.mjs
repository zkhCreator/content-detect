/** Purpose: exercise settings, concurrency and privacy through the controller's public port.
 * Synthetic tabs/storage replace the browser; these tests never call a provider.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createController } from '../src/browser/controller.js';

function fixture(evaluator = async () => ({ verdict: 'share', values: {}, reasons: [] })) {
  const data = { settings: undefined, job: undefined, tab: { id: 7, url: 'https://example.org/article?private=synthetic' }, captures: 0, protected: false };
  const platform = {
    protectStorage: async () => { data.protected = true; },
    readSettings: async () => data.settings,
    writeSettings: async value => { data.settings = structuredClone(value); },
    clearSettings: async () => { data.settings = undefined; },
    readJob: async () => data.job,
    writeJob: async value => { data.job = structuredClone(value); },
    clearJob: async () => { data.job = undefined; },
    activeTab: async () => data.tab,
    getTab: async () => data.tab,
    capture: async () => {
      data.captures++;
      return { text: 'synthetic body never stored', title: 'Fixture', origin: 'https://example.org', scope: 'page', truncated: false, fallback: false };
    },
  };
  const controller = createController(platform, { evaluator });
  const save = (goal = 'Useful software advice', apiKey = 'fixture-key-not-a-credential') => controller.handle({ type: 'SAVE_SETTINGS', goal, apiKey });
  return { data, controller, save };
}

test('settings require explicit save; public state never returns the key', async () => {
  const { controller, save, data } = fixture();
  await assert.rejects(controller.handle({ type: 'CHECK', tabId: 7 }), { code: 'SETTINGS' });
  assert.equal(data.captures, 0);
  assert.deepEqual(await save(), { hasKey: true, goal: 'Useful software advice' });
  await save('A changed goal', '');
  assert.equal(data.settings.apiKey, 'fixture-key-not-a-credential');
  const context = await controller.handle({ type: 'CONTEXT' });
  assert.equal(JSON.stringify(context).includes('fixture-key'), false);
  assert.equal(data.protected, true);
  await controller.handle({ type: 'CLEAR_SETTINGS' });
  assert.equal(data.settings, undefined);
  assert.equal(data.job, undefined);
});

test('result survives a popup reopening without persisting text, raw URL or key', async () => {
  const { controller, save, data } = fixture();
  await save();
  assert.equal((await controller.handle({ type: 'CHECK', tabId: 7 })).status, 'done');
  assert.equal((await controller.handle({ type: 'CONTEXT' })).job.status, 'done');
  const persisted = JSON.stringify(data.job);
  for (const value of ['synthetic body never stored', 'private=synthetic', 'fixture-key']) assert.equal(persisted.includes(value), false);
  await controller.forgetTab(7);
  assert.equal(data.job, undefined);
});

test('concurrent clicks share one running job', async () => {
  let release;
  let started;
  const running = new Promise(resolve => { started = resolve; });
  const { controller, save, data } = fixture(async () => {
    started();
    return new Promise(resolve => { release = resolve; });
  });
  await save();
  const first = controller.handle({ type: 'CHECK', tabId: 7 });
  await running;
  assert.equal((await controller.handle({ type: 'CHECK', tabId: 7 })).status, 'running');
  await assert.rejects(controller.handle({ type: 'CHECK', tabId: 8 }), { code: 'BUSY' });
  assert.equal(data.captures, 1);
  release({ verdict: 'share' });
  assert.equal((await first).status, 'done');
});

test('clearing settings while a request is active cancels and cannot resurrect results', async () => {
  let release;
  let started;
  let signal;
  const running = new Promise(resolve => { started = resolve; });
  const { controller, save, data } = fixture(async input => {
    signal = input.signal;
    started();
    return new Promise(resolve => { release = resolve; });
  });
  await save();
  const first = controller.handle({ type: 'CHECK', tabId: 7 });
  await running;
  await controller.handle({ type: 'CLEAR_SETTINGS' });
  assert.equal(signal.aborted, true);
  release({ verdict: 'share' });
  await assert.rejects(first, { code: 'CANCELLED' });
  assert.equal(data.job, undefined);
});

test('navigation changes cannot present a stale result as the current page', async () => {
  let data;
  const fixtureResult = fixture(async () => {
    data.tab.url = 'https://example.org/another-page';
    return { verdict: 'share' };
  });
  data = fixtureResult.data;
  await fixtureResult.save();
  const job = await fixtureResult.controller.handle({ type: 'CHECK', tabId: 7 });
  assert.equal(job.status, 'error');
  assert.equal(job.error.code, 'CHANGED');
  assert.equal((await fixtureResult.controller.handle({ type: 'CONTEXT' })).job, null);
});

test('unsupported schemes do not extract or call the provider', async () => {
  const { controller, save, data } = fixture();
  await save();
  data.tab.url = 'chrome://settings';
  assert.equal((await controller.handle({ type: 'CONTEXT' })).tabId, null);
  await assert.rejects(controller.handle({ type: 'CHECK', tabId: 7 }), { code: 'PAGE' });
  assert.equal(data.captures, 0);
});
