/** Purpose: verify the provider contract, decision boundaries, and safe failure behavior.
 * Inputs are synthetic; no live credentials/network. Tests assert application outcomes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRequest, parseAnswers, decide, validateGoal, validateKey, DIMENSIONS } from '../src/core/evaluation.js';
import { evaluate, ENDPOINT } from '../src/core/client.js';
import { AppError, safeError } from '../src/core/errors.js';
import { analysisAnswers, valueAnswers } from './fixtures/answers.mjs';

const page = { text: 'A practical guide to testing software.', title: 'Testing', origin: 'https://example.org/path?private=value#token' };
const goal = 'Share practical software engineering guides.';
const values = { topicFit: 0.9, audienceValue: 0.9, toneFit: 0.9, boundaryConflict: 0.1, contextEnough: 0.9 };
const payload = (v = values) => ({ answers: { ...Object.fromEntries(Object.entries(v).map(([k, n]) => [k, { type: 'noul', noul: n }])), ...analysisAnswers(), ...valueAnswers() } });
const args = { apiKey: 'fixture-key-not-a-credential', goal, page };

test('request contains only allowed page data and complete independent questions', () => {
  const request = buildRequest(goal, { ...page, apiKey: 'never transmit', cookie: 'never transmit', text: '字'.repeat(14000) });
  assert.equal(request.model, 'jev-latest');
  assert.equal(request.state.page.sourceOrigin, 'https://example.org');
  assert.equal(request.state.page.text.length, 12000);
  assert.equal(request.state.page.truncated, true);
  assert.equal(JSON.stringify(request).includes('never transmit'), false);
  assert.equal(Object.keys(request.questions).length, 12);
  for (const q of Object.values(request.questions)) {
    assert.ok(q.instructions.boundary.includes('untrusted'));
    assert.ok(q.instructions.question.includes('`page.text`'));
    if (q.type === 'noul') assert.ok(q.criteria.true && q.criteria.false);
    else if (q.type === 'choice') assert.ok(q.criteria.uncertain);
    else { assert.equal(q.type, 'score'); assert.equal(q.criteria.length, 5); }
  }
});

test('inputs fail closed for empty/oversized goals, unsafe key and empty page', () => {
  for (const value of ['', null, 'a'.repeat(2001)]) assert.throws(() => validateGoal(value));
  for (const value of ['', null, 'bad key', 'bad\nkey', 'a'.repeat(513)]) assert.throws(() => validateKey(value));
  assert.throws(() => buildRequest(goal, { text: '  ' }));
});

test('strict Noul parser rejects missing, wrong types and out-of-range values', () => {
  assert.deepEqual(parseAnswers(payload()), values);
  for (const id of DIMENSIONS.map(d => d.id)) {
    for (const invalid of [null, '0.9', -0.1, 1.1, NaN, Infinity, undefined]) {
      assert.throws(() => parseAnswers(payload({ ...values, [id]: invalid })));
    }
  }
  assert.throws(() => parseAnswers({ answers: { topicFit: { type: 'score', noul: 0.9 } } }));
});

test('suitability requires all dimensions and never compensates for a boundary conflict', () => {
  assert.equal(decide(values).verdict, 'share');
  assert.equal(decide({ ...values, boundaryConflict: 0.8 }).verdict, 'skip');
  assert.equal(decide({ ...values, topicFit: 0.2 }).verdict, 'skip');
  assert.equal(decide({ ...values, audienceValue: 0.3 }).verdict, 'review');
  assert.equal(decide({ ...values, toneFit: 0.7 }).verdict, 'review');
  assert.equal(decide({ ...values, boundaryConflict: 0.3 }).verdict, 'review');
  assert.equal(decide({ ...values, boundaryConflict: 0.7 }).verdict, 'review');
});

test('incomplete context and extraction limitations always require review', () => {
  assert.equal(decide({ ...values, contextEnough: 0.69, boundaryConflict: 0.99 }).verdict, 'review');
  assert.equal(decide(values, { truncated: true }).verdict, 'review');
  assert.equal(decide(values, { fallback: true }).verdict, 'review');
});

test('HTTP client authenticates only to the fixed host and validates response', async () => {
  let count = 0;
  const result = await evaluate(args, { fetchImpl: async (url, options) => {
    count++;
    assert.equal(url, ENDPOINT);
    assert.equal(options.headers.Authorization, `Bearer ${args.apiKey}`);
    assert.equal(options.credentials, 'omit');
    assert.equal(options.redirect, 'error');
    assert.equal(JSON.parse(options.body).state.accountGoal, goal);
    return Response.json(payload());
  } });
  assert.equal(count, 1);
  assert.equal(result.verdict, 'share');
  assert.equal(result.analysis.sentiment.decision, 'neutral');
  assert.equal(result.analysis.aiOrigin.decision, 'uncertain', 'short text cannot establish authorship');
  assert.ok(result.contentValue.knowledge.score > result.contentValue.enjoyment.score);
});

for (const [status, code] of [[401, 'AUTH'], [403, 'AUTH'], [429, 'RATE_LIMIT'], [500, 'SERVICE'], [400, 'REQUEST']]) {
  test(`HTTP ${status} becomes a safe ${code} error without retry`, async () => {
    let count = 0;
    await assert.rejects(evaluate(args, { fetchImpl: async () => {
      count++;
      return new Response('private provider response', { status });
    } }), error => error.code === code && !error.message.includes('private'));
    assert.equal(count, 1);
  });
}

test('independently rounded API probabilities and scores do not reject the full report', async () => {
  const rounded = JSON.parse(JSON.stringify(payload(), (_, value) => typeof value === 'number' ? Number(value.toFixed(2)) : value));
  assert.ok(Math.abs(Object.values(rounded.answers.emotion.probabilities).reduce((a, b) => a + b) - 1) > .001);
  assert.ok(Math.abs(Object.entries(rounded.answers.knowledge.probabilities).reduce((a, [key, value]) => a + Number(key) * value, 0) - rounded.answers.knowledge.score) > .01);
  let calls = 0;
  const result = await evaluate(args, { fetchImpl: async () => { calls++; return Response.json(rounded); } });
  assert.equal(calls, 1);
  assert.equal(result.verdict, 'share');
  assert.equal(result.analysis.emotion.decision, 'calm');
  assert.equal(result.contentValue.knowledge.score, 2.88);
  assert.deepEqual(result.contentValue.knowledge.probabilities, rounded.answers.knowledge.probabilities);
});

test('response diagnostics identify only local question ids and fixed failure reasons', async () => {
  const broken = payload();
  delete broken.answers.knowledge.probabilities['0'];
  await assert.rejects(evaluate(args, { fetchImpl: async () => Response.json(broken) }), error => {
    assert.ok(safeError(error).message.includes('knowledge:distribution'));
    return error.code === 'RESPONSE';
  });
  for (const diagnostic of ['PRIVATE_RESPONSE:shape', 'emotion:PRIVATE_RESPONSE', 'emotion:shape:PRIVATE_RESPONSE']) {
    const error = new AppError('RESPONSE', diagnostic);
    error.message = 'PRIVATE_RESPONSE';
    assert.ok(!safeError(error).message.includes('PRIVATE_RESPONSE'));
  }
});

test('invalid JSON, malformed answer and network errors do not escape', async () => {
  for (const response of [new Response('not json'), Response.json({ answers: {} })]) {
    await assert.rejects(evaluate(args, { fetchImpl: async () => response }), { code: 'RESPONSE' });
  }
  await assert.rejects(evaluate(args, { fetchImpl: async () => { throw new Error('private details'); } }), { code: 'NETWORK' });
  assert.equal(safeError(new Error('private details')).code, 'INTERNAL');
  assert.ok(!safeError(new Error('private details')).message.includes('private'));
});

test('deadline covers a hanging request and body; external cancellation is explicit', async () => {
  for (const fetchImpl of [() => new Promise(() => {}), async () => ({ ok: true, json: () => new Promise(() => {}) })]) {
    await assert.rejects(evaluate(args, { fetchImpl, timeoutMs: 10 }), { code: 'TIMEOUT' });
  }
  const controller = new AbortController();
  const promise = evaluate({ ...args, signal: controller.signal }, { fetchImpl: () => new Promise(() => {}) });
  controller.abort();
  await assert.rejects(promise, { code: 'CANCELLED' });
});
