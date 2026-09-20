/** Purpose: reusable synthetic Choice responses for contract and browser regression tests.
 * No real model labels or authorship claims; probabilities are controlled test inputs.
 */
import { ANALYSES } from '../../src/core/content-analysis.js';

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
