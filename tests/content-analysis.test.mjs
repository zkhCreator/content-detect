/** Purpose: test new diagnostic contracts, uncertainty routing and separation from repost rules.
 * All labels and probability distributions are synthetic, not a model accuracy benchmark.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { ANALYSES, parseContentAnalysis } from '../src/core/content-analysis.js';
import { decide } from '../src/core/evaluation.js';
import { analysisAnswers, choiceAnswer } from './fixtures/answers.mjs';

test('all supported categories including mixed/other/uncertain retain their distributions', () => {
  for (const { id, options } of ANALYSES) for (const selected of Object.keys(options)) {
    const answers = { ...analysisAnswers(), [id]: choiceAnswer(id, selected) };
    const parsed = parseContentAnalysis({ answers });
    assert.equal(parsed[id].decision, selected);
    assert.deepEqual(parsed[id].probabilities, answers[id].probabilities);
  }
});

test('strict Choice contract rejects missing or invalid type, label, confidence and distribution', () => {
  for (const { id } of ANALYSES) {
    const good = analysisAnswers()[id];
    const corruptions = [undefined, { ...good, type: 'noul' }, { ...good, choice: 'unknown' },
      { ...good, choice: '__proto__' }, { ...good, confidence: '0.9' }, { ...good, confidence: NaN },
      { ...good, confidence: 1.1 }, { ...good, probabilities: {} }, { ...good, probabilities: [] },
      { ...good, probabilities: { ...good.probabilities, surprise_extra: 0 } },
      { ...good, probabilities: { ...good.probabilities, [good.choice]: -1 } },
      { ...good, probabilities: { ...good.probabilities, [good.choice]: '0.9' } },
      { ...good, probabilities: { ...good.probabilities, [good.choice]: 0.8 } },
      { ...good, choice: 'uncertain' },
    ];
    for (const bad of corruptions) assert.throws(() => parseContentAnalysis({ answers: { ...analysisAnswers(), [id]: bad } }), { code: 'RESPONSE' });
  }
});

test('low confidence and diffuse probabilities produce uncertainty without discarding raw judgments', () => {
  for (const { id } of ANALYSES) {
    const selected = Object.keys(analysisAnswers()[id].probabilities)[0];
    for (const [confidence, probability] of [[0.59, 0.9], [0.8, 0.64]]) {
      const parsed = parseContentAnalysis({ answers: { ...analysisAnswers(), [id]: choiceAnswer(id, selected, confidence, probability) } });
      assert.equal(parsed[id].decision, 'uncertain');
      assert.equal(parsed[id].choice, selected);
      assert.equal(parsed[id].reason, 'lowConfidence');
    }
    const edge = parseContentAnalysis({ answers: { ...analysisAnswers(), [id]: choiceAnswer(id, selected, 0.6, 0.65) } });
    assert.equal(edge[id].decision, selected);
  }
});

test('short text limits only AI attribution; insufficient context limits every diagnostic', () => {
  const payload = { answers: analysisAnswers() };
  const short = parseContentAnalysis(payload, { page: { text: '字'.repeat(199) }, contextEnough: 0.9 });
  assert.equal(short.aiOrigin.decision, 'uncertain');
  assert.equal(short.aiOrigin.reason, 'insufficient');
  assert.equal(short.sentiment.decision, 'neutral');
  const enough = parseContentAnalysis(payload, { page: { text: '字'.repeat(200) }, contextEnough: 0.9 });
  assert.equal(enough.aiOrigin.decision, 'likely_human');
  const incomplete = parseContentAnalysis(payload, { contextEnough: 0.69 });
  assert.ok(Object.values(incomplete).every(answer => answer.decision === 'uncertain'));
});

test('AI suspicion and negative emotions do not automatically reject a suitable repost', () => {
  const analysis = parseContentAnalysis({ answers: { aiOrigin: choiceAnswer('aiOrigin', 'likely_ai'), sentiment: choiceAnswer('sentiment', 'negative'), emotion: choiceAnswer('emotion', 'anger') } });
  assert.equal(analysis.aiOrigin.decision, 'likely_ai');
  const values = { topicFit: .9, audienceValue: .9, toneFit: .9, boundaryConflict: .1, contextEnough: .9 };
  assert.equal(decide({ ...values, analysis }).verdict, 'share');
});
