// Disable Google Colab AI — v1.3
// - Shadow-DOM aware
// - Removes AI toolbar button and its linked menu/tooltip
// - MutationObserver + periodic sweep to survive Lit re-renders

const BUTTON_SELECTORS = [
  'md-icon-button[data-aria-label="Available AI features"]',
  'md-icon-button[aria-label="Available AI features"]',
  'md-icon-button[aria-labelledby^="ai-menu-anchor"]',
  'md-icon-button[aria-describedby^="ai-menu-anchor-"]',
  'md-icon-button[id^="ai-menu-anchor-"]'
];

const WIDGET_SELECTORS = [
  'colab-composer',
  'colab-cell-placeholder',
  'colab-composer-floating-spark'
];

// ===== Shadow DOM helpers =====
function* walkDeep(node) {
  if (!node) return;
  yield node;
  if (node.shadowRoot) yield* walkDeep(node.shadowRoot);
  if (node.children) for (const c of node.children) yield* walkDeep(c);
  if ((node.nodeType === 9 || node.nodeType === 11) && node.childNodes) {
    for (const c of node.childNodes) if (c.nodeType === 1) yield* walkDeep(c);
  }
}
const safeMatches = (el, sel) => { try { return el.matches(sel); } catch { return false; } };

function findAll(root, selectors) {
  const out = new Set();
  for (const n of walkDeep(root)) {
    if (n.nodeType !== 1) continue;
    if (n.matches && selectors.some(s => safeMatches(n, s))) out.add(n);
    if (n.querySelectorAll) {
      for (const s of selectors) for (const el of n.querySelectorAll(s)) out.add(el);
    }
  }
  return [...out];
}

// ===== Removal routines =====
function removeNode(el) {
  try { el.remove(); }
  catch { try { el.style.setProperty('display','none','important'); } catch {} }
}

function removeButtonAndCompanions(btn) {
  // Remove the button itself
  removeNode(btn);

  // Determine anchor id used by menu/tooltip, from the attributes we saw:
  const id = btn.getAttribute('id'); // e.g., "ai-menu-anchor-7-u4pUJy0TDP"
  const labelledBy = btn.getAttribute('aria-labelledby');
  const describedBy = btn.getAttribute('aria-describedby'); // e.g., "...-tooltip"

  const anchorId = id || labelledBy || (describedBy ? describedBy.replace(/-tooltip$/, '') : null);

  // Remove associated <md-menu> and <colab-tooltip-trigger> that reference the anchor
  if (anchorId) {
    for (const root of [document]) {
      for (const n of findAll(root, [
        `md-menu[anchor="${anchorId}"]`,
        `md-menu[aria-labelledby="${anchorId}"]`,
        `colab-tooltip-trigger[for="${anchorId}"]`,
        `#${anchorId}-tooltip`
      ])) removeNode(n);
    }
  }
}

function sweep(root = document) {
  // 1) Remove the standalone widgets (composer/placeholder/spark)
  for (const node of findAll(root, WIDGET_SELECTORS)) removeNode(node);

  // 2) Remove the AI toolbar button(s) and their companions
  for (const btn of findAll(root, BUTTON_SELECTORS)) removeButtonAndCompanions(btn);

  // 3) As a safety net, if we spot the AI menu or items without the button, remove them
  for (const n of findAll(root, [
    'md-menu-item[command="generate-code"]',
    'md-menu-item[command="explain-cell"]',
    'md-menu-item[command="transform-code"]'
  ])) removeNode(n);
}

// ===== Observe + periodic sweeps =====
sweep(); // earliest pass

const mo = new MutationObserver(muts => {
  for (const m of muts) {
    for (const n of m.addedNodes || []) if (n && n.nodeType === 1) sweep(n);
    // If attributes change on existing nodes (Lit toggles), re-scan
    if (m.type === 'attributes' && m.target && m.target.nodeType === 1) sweep(m.target);
  }
});
mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true });

// Early aggressive sweeps for first few seconds, then back off
let tick = 0;
const fast = setInterval(() => {
  sweep();
  if (++tick >= 20) { clearInterval(fast); } // ~5s at 250ms
}, 250);

// Long-tail sweep every 2s (Lit hot-swaps templates sometimes)
setInterval(sweep, 2000);

// Also run at DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => sweep(), { once: true });
