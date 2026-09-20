/** Purpose: reusable synthetic Choice/Score responses for contract and browser regression tests.
 * No real model labels or authorship claims; probabilities are controlled test inputs.
 */
import { ANALYSES } from '../../src/core/content-analysis.js';
import { VALUE_DIMENSIONS } from '../../src/core/content-value.js';

export function choiceAnswer(id, selected, confidence = 0.8, selectedProbability = 0.9) {
  const keys = Object.keys(ANALYSES.find(item => item.id === id).options);
  return { type: 'choice', choice: selected, confidence,
    probabilities: Object.fromEntries(keys.map(key => [key, key === selected ? selectedProbability : (1 - selectedProbability) / (keys.length - 1)])),
  };
}

export function analysisAnswers() {
  return {
    aiOrigin: choiceAnswer('aiOrigin', 'likely_human'),
    sentiment: choiceAnswer('sentiment', 'neutral'),
    emotion: choiceAnswer('emotion', 'calm'),
  };
}

export function scoreAnswer(id, level = 3, confidence = 0.8) {
  const { levels } = VALUE_DIMENSIONS.find(item => item.id === id);
  const probabilities = Object.fromEntries(levels.map((_, index) => [String(index), index === level ? 0.9 : 0.1 / (levels.length - 1)]));
  return { type: 'score', score: Object.entries(probabilities).reduce((total, [key, p]) => total + Number(key) * p, 0), confidence,
    probabilities, legend: Object.fromEntries(levels.map((text, index) => [String(index), text])),
  };
}

export function valueAnswers() {
  return Object.fromEntries(VALUE_DIMENSIONS.map(({ id }, index) => [id, scoreAnswer(id, [1, 3, 2, 3][index])]));
}
