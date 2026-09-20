/** Purpose: validate rubric scores, partial-source uncertainty and independence from repost policy.
 * Synthetic distributions test application behavior, not real model quality or audience reaction.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { VALUE_DIMENSIONS, VALUE_QUESTIONS, parseContentValue } from '../src/core/content-value.js';
import { decide } from '../src/core/evaluation.js';
import { scoreAnswer, valueAnswers } from './fixtures/answers.mjs';

test('the four rubrics preserve the supplied viewer feelings and concrete text-only criteria', () => {
  assert.deepEqual(VALUE_DIMENSIONS.map(item => item.label), ['快乐幽默', '知识', '共鸣', '节奏']);
  for (const dimension of VALUE_DIMENSIONS) {
    assert.equal(VALUE_QUESTIONS[dimension.id].type, 'score');
    assert.equal(dimension.levels.length, 5);
    assert.equal(dimension.summaries.length, 5);
    assert.ok(VALUE_QUESTIONS[dimension.id].instructions.boundary.includes('unseen audiovisual'));
  }
});

test('Score preserves the weighted position rather than misreading it as a probability', () => {
  for (const { id } of VALUE_DIMENSIONS) for (let level = 0; level <= 4; level++) {
    const answers = { ...valueAnswers(), [id]: scoreAnswer(id, level) };
    const result = parseContentValue({ answers });
    assert.equal(result[id].score, answers[id].score);
    assert.equal(result[id].reason, null);
    assert.deepEqual(result[id].probabilities, answers[id].probabilities);
    assert.equal(Object.hasOwn(result[id], 'legend'), false);
  }
});

test('malformed Score answers fail safely instead of inventing missing ratings', () => {
  for (const { id } of VALUE_DIMENSIONS) {
    const good = scoreAnswer(id);
    for (const bad of [undefined, { ...good, type: 'choice' }, { ...good, score: '3' }, { ...good, score: NaN },
      { ...good, score: -1 }, { ...good, score: 4.1 }, { ...good, score: 0 },
      { ...good, confidence: null }, { ...good, confidence: 1.1 }, { ...good, confidence: Infinity },
      { ...good, probabilities: undefined }, { ...good, probabilities: [] },
      { ...good, probabilities: { ...good.probabilities, 5: 0 } },
      { ...good, probabilities: { ...good.probabilities, 0: -1 } },
      { ...good, probabilities: { ...good.probabilities, 0: '0.025' } },
      { ...good, probabilities: { ...good.probabilities, 0: 0.8 } },
    ]) assert.throws(() => parseContentValue({ answers: { ...valueAnswers(), [id]: bad } }), { code: 'RESPONSE' });
  }
});

test('selected, truncated or fallback text cannot establish whole-text pacing', () => {
  for (const page of [{ scope: 'selection' }, { truncated: true }, { fallback: true }]) {
    const result = parseContentValue({ answers: valueAnswers() }, { page, contextEnough: .9 });
    assert.equal(result.pacing.reason, 'partialStructure');
    assert.equal(result.knowledge.reason, null);
  }
});

test('low confidence and insufficient context remain distinct from a weak value score', () => {
  const result = parseContentValue({ answers: { ...valueAnswers(), enjoyment: scoreAnswer('enjoyment', 0), knowledge: scoreAnswer('knowledge', 4, .59) } });
  assert.equal(result.enjoyment.reason, null);
  assert.equal(result.knowledge.reason, 'lowConfidence');
  const missing = parseContentValue({ answers: valueAnswers() }, { contextEnough: .69 });
  assert.ok(Object.values(missing).every(answer => answer.reason === 'insufficient'));
});

test('a low humor rating does not veto a useful and suitable serious article', () => {
  const contentValue = parseContentValue({ answers: { ...valueAnswers(), enjoyment: scoreAnswer('enjoyment', 0) } });
  assert.equal(decide({ topicFit: .9, audienceValue: .9, toneFit: .9, boundaryConflict: .1, contextEnough: .9, contentValue }).verdict, 'share');
});
