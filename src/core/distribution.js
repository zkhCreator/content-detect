/**
 * Purpose: validate a complete probability distribution while allowing decimal rounding.
 * Inputs: expected local option keys and provider numbers. Output: unchanged validated numbers.
 * Decisions: tolerate at most half a hundredth per entry, matching two-decimal examples in
 * TypeSafe's docs; include the independently rounded Score in its weighted-mean error bound.
 * Non-goals: filling missing options, coercing strings, normalizing or repairing invalid data.
 */
import { AppError } from './errors.js';

export const isUnit = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
const HALF_UNIT = 0.005;
const EPSILON = 1e-9;

export function parseDistribution(input, keys, question) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
      || Object.keys(input).length !== keys.length
      || keys.some(key => !Object.hasOwn(input, key) || !isUnit(input[key]))) {
    throw new AppError('RESPONSE', `${question}:distribution`);
  }
  const probabilities = Object.fromEntries(keys.map(key => [key, input[key]]));
  const sum = Object.values(probabilities).reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 1) > keys.length * HALF_UNIT + EPSILON) {
    throw new AppError('RESPONSE', `${question}:total`);
  }
  return probabilities;
}

export function validateWeightedScore(score, probabilities, question) {
  const entries = Object.entries(probabilities);
  const weighted = entries.reduce((total, [key, value]) => total + Number(key) * value, 0);
  const tolerance = HALF_UNIT * (1 + entries.reduce((total, [key]) => total + Number(key), 0));
  if (Math.abs(weighted - score) > tolerance + EPSILON) throw new AppError('RESPONSE', `${question}:score`);
}
