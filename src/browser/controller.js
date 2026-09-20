/**
 * Purpose: coordinate settings, a single in-flight evaluation and a session-only result.
 * Inputs: trusted extension messages and platform ports. Outputs: redacted UI state.
 * Decisions: serialize mutations, cancel on settings changes, deduplicate checks, bind to URL.
 * Boundaries: never persist raw page text or return the saved key; no autonomous requests.
 */
import { AppError, safeError } from '../core/errors.js';
import { validateGoal, validateKey } from '../core/evaluation.js';
import { evaluate } from '../core/client.js';
import { tabFingerprint } from './platform.js';

export function createController(platform, { evaluator = evaluate, now = Date.now } = {}) {
  let queue = Promise.resolve();
  let flight;
  const ready = platform.protectStorage();
  const serialized = operation => {
    const next = queue.then(operation);
    queue = next.catch(() => {});
    return next;
  };
  const publicSettings = settings => ({ hasKey: Boolean(settings?.apiKey), goal: settings?.goal ?? '' });
  const invalidate = async () => {
    flight?.controller.abort();
    flight = undefined;
    await platform.clearJob();
  };
  const currentJob = async tabId => {
    const job = await platform.readJob();
    if (!job || job.tabId !== tabId) return null;
    const settings = await platform.readSettings();
    if (job.revision !== settings?.revision) return null;
    try {
      if (job.fingerprint !== await tabFingerprint(await platform.getTab(tabId))) return null;
    } catch { return null; }
    if (job.status === 'running' && now() - job.startedAt > 30000) {
      await invalidate();
      return { status: 'error', error: safeError(new AppError('TIMEOUT')) };
    }
    return job;
  };

  async function check(tabId) {
    const setup = await serialized(async () => {
      const existing = await platform.readJob();
      if (existing?.status === 'running' && now() - existing.startedAt <= 30000) {
        if (existing.tabId === tabId) return { existing };
        throw new AppError('BUSY');
      }
      if (!Number.isInteger(tabId)) throw new AppError('PAGE');
      const settings = await platform.readSettings();
      if (!settings?.apiKey || !settings?.goal) throw new AppError('SETTINGS');
      const tab = await platform.getTab(tabId);
      const fingerprint = await tabFingerprint(tab);
      flight?.controller.abort();
      const controller = new AbortController();
      const job = { id: crypto.randomUUID(), tabId, fingerprint, revision: settings.revision, status: 'running', startedAt: now() };
      flight = { id: job.id, controller };
      await platform.writeJob(job);
      return { settings, tab, job, controller };
    });
    if (setup.existing) return setup.existing;
    const { settings, tab, job, controller } = setup;
    let finished;
    try {
      const page = await platform.capture(tab.id);
      if (controller.signal.aborted) throw new AppError('CANCELLED');
      if (job.fingerprint !== await tabFingerprint(await platform.getTab(tab.id))) throw new AppError('CHANGED');
      const result = await evaluator({ apiKey: settings.apiKey, goal: settings.goal, page, signal: controller.signal });
      if (job.fingerprint !== await tabFingerprint(await platform.getTab(tab.id))) throw new AppError('CHANGED');
      finished = {
        ...job, status: 'done', completedAt: now(), result,
        page: { title: page.title, origin: page.origin, characters: page.text.length, scope: page.scope, truncated: page.truncated, fallback: page.fallback },
      };
    } catch (error) {
      finished = { ...job, status: 'error', error: safeError(error) };
    }
    return serialized(async () => {
      if (flight?.id !== job.id || controller.signal.aborted) throw new AppError('CANCELLED');
      await platform.writeJob(finished);
      flight = undefined;
      return finished;
    });
  }

  return {
    async handle(message) {
      await ready;
      if (message?.type === 'CHECK') return check(message.tabId);
      return serialized(async () => {
        switch (message?.type) {
          case 'CONTEXT': {
            const settings = publicSettings(await platform.readSettings());
            let tab;
            try { tab = await platform.activeTab(); await tabFingerprint(tab); } catch {
              return { settings, tabId: null, job: null };
            }
            return { settings, tabId: tab.id, job: await currentJob(tab.id) };
          }
          case 'STATUS': return currentJob(message.tabId);
          case 'SAVE_SETTINGS': {
            const old = await platform.readSettings();
            const goal = validateGoal(message.goal);
            const apiKey = validateKey(message.apiKey?.trim() || old?.apiKey);
            await invalidate();
            const settings = { apiKey, goal, revision: crypto.randomUUID() };
            await platform.writeSettings(settings);
            return publicSettings(settings);
          }
          case 'CLEAR_SETTINGS':
            await invalidate();
            await platform.clearSettings();
            return publicSettings(null);
          default: throw new AppError('INTERNAL');
        }
      });
    },
    async forgetTab(tabId) {
      await ready;
      return serialized(async () => {
        if ((await platform.readJob())?.tabId === tabId) await invalidate();
      });
    },
  };
}
