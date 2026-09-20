/**
 * Purpose: isolate WebExtension APIs from application logic for future browser ports.
 * Inputs: browser/chrome API object. Outputs: Promise-based storage, tab and capture ports.
 * Decisions: activeTab + on-demand injection; trusted-context-only storage before use.
 * Non-goals: permanent content scripts, broad host permissions, page-world execution.
 */
import { extractPage } from './extract.js';
import { MAX_TEXT_LENGTH } from '../core/evaluation.js';
import { AppError } from '../core/errors.js';

export function createPlatform(api = globalThis.browser ?? globalThis.chrome) {
  return {
    async protectStorage() {
      await api.storage.local.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' });
      await api.storage.session.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' });
    },
    async readSettings() { return (await api.storage.local.get('settings')).settings; },
    async writeSettings(settings) { await api.storage.local.set({ settings }); },
    async clearSettings() { await api.storage.local.remove('settings'); },
    async readJob() { return (await api.storage.session.get('job')).job; },
    async writeJob(job) { await api.storage.session.set({ job }); },
    async clearJob() { await api.storage.session.remove('job'); },
    async activeTab() {
      const [tab] = await api.tabs.query({ active: true, currentWindow: true });
      if (!tab || !Number.isInteger(tab.id)) throw new AppError('PAGE');
      return tab;
    },
    async getTab(id) {
      try { return await api.tabs.get(id); } catch { throw new AppError('PAGE'); }
    },
    async capture(id) {
      try {
        const results = await api.scripting.executeScript({
          target: { tabId: id },
          func: extractPage,
          args: [MAX_TEXT_LENGTH],
          world: 'ISOLATED',
        });
        if (!results[0]?.result?.text?.trim()) throw new AppError('EMPTY');
        return results[0].result;
      } catch (error) {
        if (error instanceof AppError) throw error;
        throw new AppError('PAGE');
      }
    },
  };
}

export async function tabFingerprint(tab) {
  if (!tab || !Number.isInteger(tab.id) || !/^https?:\/\//i.test(tab.url ?? '')) throw new AppError('PAGE');
  // Keep URL secrets out of session storage while detecting query/hash navigation changes.
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(tab.url));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
}
