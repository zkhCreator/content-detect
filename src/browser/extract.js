/**
 * Purpose: capture visible source text only when explicitly injected into the active tab.
 * Inputs: DOM/selection and a character limit. Output: text plus bounded extraction metadata.
 * Boundaries: no network/storage, no form/editable/hidden content, frames, or URL path/query.
 * This function must remain self-contained: scripting.executeScript serializes the function.
 */
export function extractPage(maxLength = 12000) {
  const excluded = 'script,style,noscript,template,svg,canvas,iframe,input,textarea,select,option,button,form,[contenteditable]:not([contenteditable="false"]),[hidden],[aria-hidden="true"],nav,header,footer,[role="navigation"],[role="banner"],[role="contentinfo"]';
  const visibility = new WeakMap();
  const visible = element => {
    if (!element) return false;
    if (visibility.has(element)) return visibility.get(element);
    const style = getComputedStyle(element);
    const yes = !element.matches(excluded) && style.display !== 'none' && style.visibility !== 'hidden'
      && style.visibility !== 'collapse' && style.opacity !== '0'
      && (!element.parentElement || visible(element.parentElement));
    visibility.set(element, yes);
    return yes;
  };
  const normalize = text => text.replace(/[\t\r\f ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const collect = (root, range) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const parts = [];
    let count = 0;
    let length = 0;
    let limited = false;
    let node;
    while ((node = walker.nextNode())) {
      if (++count > 30000) { limited = true; break; }
      if (!visible(node.parentElement) || !node.textContent.trim()) continue;
      if (range && !range.intersectsNode(node)) continue;
      let text = node.textContent;
      if (range?.startContainer === node) text = text.slice(range.startOffset, range.endContainer === node ? range.endOffset : undefined);
      else if (range?.endContainer === node) text = text.slice(0, range.endOffset);
      text = normalize(text);
      if (!text) continue;
      parts.push(text);
      length += text.length + 1;
      if (length > maxLength) { limited = true; break; }
    }
    const text = normalize(parts.join('\n'));
    return { text: text.slice(0, maxLength), truncated: limited || text.length > maxLength };
  };
  const selection = window.getSelection();
  let result;
  let scope = 'page';
  let fallback = false;
  if (selection && !selection.isCollapsed && selection.rangeCount) {
    scope = 'selection';
    // Walking actual nodes excludes sensitive/hidden content even for mixed selections.
    result = collect(document.body, selection.getRangeAt(0));
  } else {
    const roots = [...document.querySelectorAll('article,[role="article"],main,[role="main"]')].filter(visible).slice(0, 25);
    const candidates = roots.map(root => collect(root)).filter(candidate => candidate.text);
    result = candidates.sort((a, b) => b.text.length - a.text.length)[0];
    if (!result) { fallback = true; result = collect(document.body ?? document.documentElement); }
  }
  return {
    ...result,
    title: normalize(document.title).slice(0, 240),
    origin: location.origin,
    scope,
    fallback,
  };
}
