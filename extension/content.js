// Disable Google Colab AI + Block YouTube Embeds + Hide Google AI Overview — v1.0.5
//
// Colab AI blocks:
// - Shadow-DOM aware
// - Removes AI toolbar button and its linked menu/tooltip
// - Removes "Explain error" AI button specifically
// - MutationObserver + periodic sweep to survive Lit re-renders
//
// Slides/Docs YouTube block:
// - Hides the YouTube tab panel inside the "Insert video" dialog
// - Hides the YouTube tab button so users cannot switch to it
// - Leaves the Google Drive tab and dialog chrome fully intact
//
// Google Search AI Overview block:
// - Targets the AI Overview container by multiple stable attributes
// - Uses layered selectors so if one changes, others still catch it

// ===== Colab selectors =====

const BUTTON_SELECTORS = [
  'md-icon-button[data-aria-label="Available AI features"]',
'md-icon-button[aria-label="Available AI features"]',
'md-icon-button[aria-labelledby^="ai-menu-anchor"]',
'md-icon-button[aria-describedby^="ai-menu-anchor-"]',
'md-icon-button[id^="ai-menu-anchor-"]',
'md-outlined-button[data-test-id="explain-error"]'
];

const WIDGET_SELECTORS = [
  'colab-composer',
'colab-cell-placeholder',
'colab-composer-floating-spark'
];

// ===== Slides/Docs YouTube selectors =====
const YOUTUBE_SELECTORS = [
  'div[jsname="MVsrn"]',   // YouTube search panel
'div[jsname="h0T7hb"]'  // YouTube tab button
];

// ===== Google Search AI Overview selectors =====
// Primary: the outermost wrapper div carries data-hveid="CAoQBg" consistently
// across searches. The inner div[jsname="Zlxsqf"] is the content block itself.
// We target both so either one is sufficient to remove the whole section.
const AI_OVERVIEW_SELECTORS = [
  'div[data-hveid="CAoQBg"]',  // outermost AI Overview wrapper
'div[jsname="Zlxsqf"]',      // inner AI Overview content block
'div[data-mg-cp="YzCcne"]'   // data-mcpr container (extra safety net)
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
  removeNode(btn);

  const id = btn.getAttribute('id');
  const labelledBy = btn.getAttribute('aria-labelledby');
  const describedBy = btn.getAttribute('aria-describedby');
  const anchorId = id || labelledBy || (describedBy ? describedBy.replace(/-tooltip$/, '') : null);

  if (anchorId) {
    for (const n of findAll(document, [
      `md-menu[anchor="${anchorId}"]`,
      `md-menu[aria-labelledby="${anchorId}"]`,
      `colab-tooltip-trigger[for="${anchorId}"]`,
      `#${anchorId}-tooltip`
    ])) removeNode(n);
  }
}

// ===== Sweep =====
function sweep(root = document) {
  // 1) Colab widgets
  for (const node of findAll(root, WIDGET_SELECTORS)) removeNode(node);

  // 2) Colab AI buttons + companions
  for (const btn of findAll(root, BUTTON_SELECTORS)) removeButtonAndCompanions(btn);

  // 3) Colab AI menu items (safety net)
  for (const n of findAll(root, [
    'md-menu-item[command="generate-code"]',
    'md-menu-item[command="explain-cell"]',
    'md-menu-item[command="transform-code"]'
  ])) removeNode(n);

  // 4) YouTube embed panel + tab button in Slides/Docs
  for (const n of findAll(root, YOUTUBE_SELECTORS)) removeNode(n);

  // 5) Google Search AI Overview
  for (const n of findAll(root, AI_OVERVIEW_SELECTORS)) removeNode(n);
}

// ===== Observe + periodic sweeps =====
sweep();

const mo = new MutationObserver(muts => {
  for (const m of muts) {
    for (const n of m.addedNodes || []) if (n && n.nodeType === 1) sweep(n);
    if (m.type === 'attributes' && m.target && m.target.nodeType === 1) sweep(m.target);
  }
});
mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true });

let tick = 0;
const fast = setInterval(() => {
  sweep();
  if (++tick >= 20) { clearInterval(fast); } // ~5s at 250ms
}, 250);

setInterval(sweep, 2000);

document.addEventListener('DOMContentLoaded', () => sweep(), { once: true });
