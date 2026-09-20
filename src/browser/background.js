/**
 * Purpose: expose the application controller only to this extension's packaged UI.
 * Input: internal runtime messages. Output: safe envelopes, session state changes.
 * Boundary: no external messaging, page senders, credential logging, or install telemetry.
 */
import { createController } from './controller.js';
import { createPlatform } from './platform.js';
import { AppError, safeError } from '../core/errors.js';

const api = globalThis.browser ?? globalThis.chrome;
const controller = createController(createPlatform(api));
api.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== api.runtime.id || sender.url?.split('?')[0] !== api.runtime.getURL('popup.html')) {
    sendResponse({ ok: false, error: safeError(new AppError('INTERNAL')) });
    return false;
  }
  controller.handle(message)
    .then(data => sendResponse({ ok: true, data }))
    .catch(error => sendResponse({ ok: false, error: safeError(error) }));
  return true;
});
api.tabs.onRemoved.addListener(id => { controller.forgetTab(id).catch(() => {}); });
api.tabs.onUpdated.addListener((id, changes) => {
  if (changes.status === 'loading' || changes.url) controller.forgetTab(id).catch(() => {});
});
