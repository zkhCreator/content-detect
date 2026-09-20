/**
 * Purpose: provide safe, localized failures at every trust boundary.
 * Inputs: known error codes. Outputs: fixed messages safe for UI/session storage.
 * Boundary: never surface provider response bodies, credentials, or arbitrary errors.
 */
const messages = {
  SETTINGS: '请先保存有效的 API key 和账号方向。',
  GOAL: '请填写账号方向（最多 2,000 字符）。',
  KEY: 'API key 格式无效，请重新粘贴，不要包含空格或换行。',
  PAGE: '此页面无法读取。请在普通网页上使用；浏览器设置页、商店页和 PDF 可能不受支持。',
  EMPTY: '没有找到可检查的文字。请等待正文加载，或选中一段正文后重试。',
  AUTH: 'API key 无效或没有访问权限，请到账号设定中更新。',
  RATE_LIMIT: 'TypeSafe 请求频率或额度受限，请稍后手动重试。',
  SERVICE: 'TypeSafe 暂时不可用，请稍后重试。',
  REQUEST: 'TypeSafe 未接受请求，请检查额度或稍后重试。',
  RESPONSE: 'TypeSafe 返回了无法识别的结果。请刷新到最新插件后重试；若仍出现，请反馈错误中的诊断码。',
  NETWORK: '无法连接 TypeSafe，请检查网络后重试。',
  TIMEOUT: '检查超时，请稍后重试。',
  CANCELLED: '设置已变更，本次检查已取消，请重新检查。',
  CHANGED: '检查期间页面已切换，请重新检查当前内容。',
  BUSY: '另一页面正在检查，请等待完成后再试。',
  INTERNAL: '扩展暂时无法完成操作，请重新打开后重试。',
};

const responseQuestions = new Set(['response', 'topicFit', 'audienceValue', 'toneFit', 'boundaryConflict', 'contextEnough', 'aiOrigin', 'sentiment', 'emotion', 'enjoyment', 'knowledge', 'resonance', 'pacing']);
const responseReasons = new Set(['json', 'shape', 'distribution', 'total', 'choice', 'score']);
function safeDiagnostic(value) {
  if (typeof value !== 'string') return undefined;
  const parts = value.split(':');
  return parts.length === 2 && responseQuestions.has(parts[0]) && responseReasons.has(parts[1]) ? value : undefined;
}

export class AppError extends Error {
  constructor(code, diagnostic) {
    super(messages[code] ?? messages.INTERNAL);
    this.name = 'AppError';
    this.code = Object.hasOwn(messages, code) ? code : 'INTERNAL';
    this.diagnostic = this.code === 'RESPONSE' ? safeDiagnostic(diagnostic) : undefined;
    if (this.diagnostic) this.message += `（${this.diagnostic}）`;
  }
}

export function safeError(error) {
  const code = error instanceof AppError ? error.code : 'INTERNAL';
  const diagnostic = code === 'RESPONSE' ? safeDiagnostic(error.diagnostic) : undefined;
  return { code, message: messages[code] + (diagnostic ? `（${diagnostic}）` : '') };
}
