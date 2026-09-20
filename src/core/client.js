/**
 * Purpose: call the documented TypeSafe HTTP endpoint without an SDK/runtime dependency.
 * Inputs: user-owned key, goal, page, optional abort signal. Output: validated judgments.
 * Boundaries: one request, fixed HTTPS host, no cookies/redirects/logging/automatic retries.
 * Timeout covers headers and body; provider error bodies are never exposed or retained.
 */
import { AppError } from './errors.js';
import { buildRequest, parseAnswers, decide, validateKey } from './evaluation.js';

export const ENDPOINT = 'https://api.typesafe.ai/v1/systemone';

export async function evaluate({ apiKey, goal, page, signal }, { fetchImpl = fetch, timeoutMs = 22000 } = {}) {
  const key = validateKey(apiKey);
  const body = JSON.stringify(buildRequest(goal, page));
  const controller = new AbortController();
  let timer;
  let cancel;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new AppError('TIMEOUT'));
    }, timeoutMs);
    cancel = () => {
      controller.abort();
      reject(new AppError('CANCELLED'));
    };
    signal?.addEventListener('abort', cancel, { once: true });
  });
  try {
    if (signal?.aborted) throw new AppError('CANCELLED');
    return await Promise.race([deadline, (async () => {
      const response = await fetchImpl(ENDPOINT, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body,
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        redirect: 'error',
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok) {
        if ([401, 403].includes(response.status)) throw new AppError('AUTH');
        if (response.status === 429) throw new AppError('RATE_LIMIT');
        if (response.status >= 500) throw new AppError('SERVICE');
        throw new AppError('REQUEST');
      }
      let payload;
      try { payload = await response.json(); } catch { throw new AppError('RESPONSE'); }
      const values = parseAnswers(payload);
      return { values, ...decide(values, page) };
    })()]);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(signal?.aborted ? 'CANCELLED' : 'NETWORK');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
}
