// Purpose:
// 1) Disable Google Colab AI UI
// 2) Block YouTube embedding in Google Docs and Google Slides
// 3) Suppress Google Search AI UI while minimizing collateral damage
//
// Key design choices:
// - Route by URL / frame context so each site only runs its own logic.
// - Docs/Slides support runs in child frames as well because the Insert video
//   picker is rendered inside an iframe in current Google editors.
// - Search redirect to Web mode only happens when AI Overview is actually
//   detected, which avoids degrading plain navigational searches like "docs"
//   or "slides".

(function () {
  "use strict";

// ===== Shared configuration =====
const URL_CHECK_INTERVAL_MS = 500;

// ===== Google Search configuration =====
const WEB_FILTER_VALUE = "14";
const REDIRECT_SESSION_KEY = "pgext_web_filter_redirected_query";
const AI_OVERVIEW_LABELS = new Set([
  "AI Overview"
]);
const BLOCKED_SEARCH_TABS = new Set([
  "AI Mode",
  "Short videos",
  "Shopping",
  "News",
  "Forums",
  "Flights",
  "Finance",
  "Videos",
  "Books",
  "Maps"
]);

// ===== Colab selectors =====
const COLAB_BUTTON_SELECTORS = [
  'md-icon-button[data-aria-label="Available AI features"]',
  'md-icon-button[aria-label="Available AI features"]',
  'md-icon-button[aria-labelledby^="ai-menu-anchor"]',
  'md-icon-button[aria-describedby^="ai-menu-anchor-"]',
  'md-icon-button[id^="ai-menu-anchor-"]',
  'md-outlined-button[data-test-id="explain-error"]',
  'md-icon-button[data-test-id="explain-error"]'
];

const COLAB_WIDGET_SELECTORS = [
  "colab-composer",
  "colab-cell-placeholder",
  "colab-composer-floating-spark"
];

const COLAB_MENU_ITEM_SELECTORS = [
  'md-menu-item[command="generate-code"]',
  'md-menu-item[command="explain-cell"]',
  'md-menu-item[command="transform-code"]'
];

// ===== Docs / Slides configuration =====
const INSERT_VIDEO_TITLE = "Insert video";
const YOUTUBE_TAB_TEXT = "YouTube";
const GOOGLE_DRIVE_TAB_TEXT = "Google Drive";
const YOUTUBE_INPUT_MARKERS = [
  "youtube",
  "paste url"
];

// ===== Shared helpers =====
function getUrl() {
  return new URL(location.href);
}

function safeText(value) {
  return (value || "").replace(/\s+/g, " ").trim();
}

function lowerText(value) {
  return safeText(value).toLowerCase();
}

function safeMatches(el, selector) {
  try {
    return Boolean(el?.matches?.(selector));
  } catch {
    return false;
  }
}

function hideElement(el) {
  if (!el || el.dataset.pgextHidden === "1") return;
  el.dataset.pgextHidden = "1";
  el.style.setProperty("display", "none", "important");
  el.setAttribute("aria-hidden", "true");
  el.setAttribute("tabindex", "-1");
}

function removeNode(el) {
  if (!el) return;
  try {
    el.remove();
  } catch {
    hideElement(el);
  }
}

function startBurst(callback, intervalMs = 250, maxRuns = 20) {
  let runs = 0;
  const timer = setInterval(() => {
    callback();
    runs += 1;
    if (runs >= maxRuns) clearInterval(timer);
  }, intervalMs);
    return timer;
}

function startUrlWatcher(onChange) {
  let lastHref = location.href;
  return setInterval(() => {
    if (location.href === lastHref) return;
    lastHref = location.href;
    onChange();
  }, URL_CHECK_INTERVAL_MS);
}

function getReferrerUrl() {
  try {
    return document.referrer ? new URL(document.referrer) : null;
  } catch {
    return null;
  }
}

// ===== Shared shadow DOM traversal =====
function* walkDeep(node) {
  if (!node) return;

  yield node;

  if (node.shadowRoot) {
    yield* walkDeep(node.shadowRoot);
  }

  if (node.children) {
    for (const child of node.children) {
      yield* walkDeep(child);
    }
  }

  if ((node.nodeType === Node.DOCUMENT_NODE || node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) && node.childNodes) {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        yield* walkDeep(child);
      }
    }
  }
}

function findAllDeep(root, selectors) {
  const out = new Set();

  for (const node of walkDeep(root)) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) continue;

    if (selectors.some((selector) => safeMatches(node, selector))) {
      out.add(node);
    }

    if (typeof node.querySelectorAll === "function") {
      for (const selector of selectors) {
        for (const match of node.querySelectorAll(selector)) {
          out.add(match);
        }
      }
    }
  }

  return [...out];
}

// ===== Route helpers =====
function isColabPage(url = getUrl()) {
  return url.hostname === "colab.research.google.com";
}

function isDocsOrSlidesUrl(url) {
  return Boolean(
    url &&
    url.hostname === "docs.google.com" &&
    (url.pathname.startsWith("/document/") || url.pathname.startsWith("/presentation/"))
  );
}

function isDocsOrSlidesContext() {
  const url = getUrl();
  if (isDocsOrSlidesUrl(url)) return true;

  const referrerUrl = getReferrerUrl();
  if (isDocsOrSlidesUrl(referrerUrl)) return true;

  return false;
}

function isGoogleSearchPage(url = getUrl()) {
  return url.hostname === "www.google.com" && url.pathname === "/search";
}

// ===== Colab =====
function initColab() {
  const observedRoots = new WeakSet();
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        discoverShadowRoots(node);
        sweepColab(node);
      }
    }
  });

  function observeRoot(root) {
    if (!root || observedRoots.has(root)) return;
    observedRoots.add(root);
    observer.observe(root, { childList: true, subtree: true });
  }

  function discoverShadowRoots(root) {
    for (const node of walkDeep(root)) {
      if (node?.shadowRoot) {
        observeRoot(node.shadowRoot);
      }
    }
  }

  function removeButtonAndCompanions(button) {
    if (!button) return;

    const id = button.getAttribute("id");
    const labelledBy = button.getAttribute("aria-labelledby");
    const describedBy = button.getAttribute("aria-describedby");
    const anchorId = id || labelledBy || (describedBy ? describedBy.replace(/-tooltip$/, "") : null);

    removeNode(button);

    if (!anchorId) return;

    const companionSelectors = [
      `md-menu[anchor="${anchorId}"]`,
      `md-menu[aria-labelledby="${anchorId}"]`,
      `colab-tooltip-trigger[for="${anchorId}"]`,
      `#${anchorId}-tooltip`
    ];

    for (const companion of findAllDeep(document, companionSelectors)) {
      removeNode(companion);
    }
  }

  function sweepColab(root = document) {
    for (const widget of findAllDeep(root, COLAB_WIDGET_SELECTORS)) {
      removeNode(widget);
    }

    for (const button of findAllDeep(root, COLAB_BUTTON_SELECTORS)) {
      removeButtonAndCompanions(button);
    }

    for (const menuItem of findAllDeep(root, COLAB_MENU_ITEM_SELECTORS)) {
      removeNode(menuItem);
    }
  }

  observeRoot(document.documentElement);
  discoverShadowRoots(document.documentElement);
  sweepColab(document);
  startBurst(() => sweepColab(document));

  document.addEventListener(
    "DOMContentLoaded",
    () => {
      discoverShadowRoots(document.documentElement);
      sweepColab(document);
    },
    { once: true }
  );
}

// ===== Docs / Slides =====
function initDocsSlides() {
  function findInsertVideoDialogs(root = document) {
    const dialogs = new Set();
    const headings = [];

    const headingSelector = '[role="heading"], h1, h2, h3';

    if (root.nodeType === Node.ELEMENT_NODE && safeMatches(root, headingSelector)) {
      headings.push(root);
    }

    if (typeof root.querySelectorAll === "function") {
      headings.push(...root.querySelectorAll(headingSelector));
    }

    for (const heading of headings) {
      if (safeText(heading.textContent) !== INSERT_VIDEO_TITLE) continue;

      const dialog =
      heading.closest('[role="dialog"]') ||
      heading.closest('[role="banner"]') ||
      heading.parentElement?.closest('div') ||
      heading.parentElement;

      if (dialog) {
        dialogs.add(dialog);
      }
    }

    return [...dialogs];
  }

  function getTabByText(container, text) {
    if (!container) return null;
    for (const tab of container.querySelectorAll('[role="tab"]')) {
      if (safeText(tab.textContent) === text) {
        return tab;
      }
    }
    return null;
  }

  function getReasonableWrapper(el, boundary) {
    if (!el) return null;

    let node = el;
    while (
      node.parentElement &&
      node.parentElement !== boundary &&
      node.parentElement !== document.body &&
      node.parentElement.children.length === 1
    ) {
      node = node.parentElement;
    }

    return node;
  }

  function hideYoutubeSearchArea(dialog) {
    if (!dialog) return;

    const candidates = new Set();

    for (const input of dialog.querySelectorAll('input[aria-label], input[value]')) {
      const markerText = lowerText(
        input.getAttribute('aria-label') ||
        input.getAttribute('value') ||
        input.value ||
        ''
      );

      if (!YOUTUBE_INPUT_MARKERS.every((marker) => markerText.includes(marker))) continue;

      const searchRoot = input.closest('[role="search"]') || input.closest('div');
      if (searchRoot) candidates.add(searchRoot);

      const controlledId = input.getAttribute('aria-controls') || input.getAttribute('aria-owns');
      if (controlledId) {
        const listbox = dialog.querySelector(`#${CSS.escape(controlledId)}`);
        if (listbox) candidates.add(listbox);
      }
    }

    for (const candidate of candidates) {
      hideElement(getReasonableWrapper(candidate, dialog) || candidate);
    }
  }

  function forceDriveTab(dialog) {
    const youtubeTab = getTabByText(dialog, YOUTUBE_TAB_TEXT);
    const driveTab = getTabByText(dialog, GOOGLE_DRIVE_TAB_TEXT);

    if (!youtubeTab) return;

    const youtubeSelected = youtubeTab.getAttribute('aria-selected') === 'true';
    if (youtubeSelected && driveTab) {
      driveTab.click();
    }

    hideElement(getReasonableWrapper(youtubeTab, dialog) || youtubeTab);
  }

  function sweepDocsSlides(root = document) {
    for (const dialog of findInsertVideoDialogs(root)) {
      forceDriveTab(dialog);
      hideYoutubeSearchArea(dialog);
    }
  }

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        sweepDocsSlides(node);
      }
    }
  });

  sweepDocsSlides(document);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  startBurst(() => sweepDocsSlides(document), 250, 20);
  startUrlWatcher(() => sweepDocsSlides(document));

  document.addEventListener(
    "DOMContentLoaded",
    () => sweepDocsSlides(document),
                            { once: true }
  );
}

// ===== Google Search =====
function initGoogleSearch() {
  function getCurrentQuery(url = getUrl()) {
    return safeText(url.searchParams.get("q"));
  }

  function hasExplicitMode(url = getUrl()) {
    return url.searchParams.has("udm");
  }

  function wasJustRedirected(query) {
    try {
      return sessionStorage.getItem(REDIRECT_SESSION_KEY) === query;
    } catch {
      return false;
    }
  }

  function markRedirected(query) {
    try {
      sessionStorage.setItem(REDIRECT_SESSION_KEY, query);
    } catch {}
  }

  function clearRedirectMark() {
    try {
      sessionStorage.removeItem(REDIRECT_SESSION_KEY);
    } catch {}
  }

  function looksLikeSearchModeNav(el) {
    return Boolean(
      el.closest("[role='navigation']") ||
      el.closest("#hdtb") ||
      el.closest(".crJ18e") ||
      el.closest(".T47uwc")
    );
  }

  function getMenuItemRoot(el) {
    // Find the semantic list item first
    const semanticRoot = el.closest("[role='listitem'], [role='menuitem'], [role='option'], li");
    const base = (semanticRoot && semanticRoot !== document.body) ? semanticRoot : el;

    // Then keep climbing single-child wrapper divs that have no meaningful role
    // themselves — these are the ghost slot containers Google wraps each More
    // menu item in (e.g. div[role="none"], div.bsmXxe) which stay behind as
    // blank entries after the inner content is removed.
    let node = base;
    while (
      node.parentElement &&
      node.parentElement !== document.body &&
      node.parentElement.children.length === 1 &&
      looksLikeSearchModeNav(node.parentElement)
    ) {
      const parentRole = node.parentElement.getAttribute("role") || "";
      // Stop if parent is a meaningful container (menu, listbox, navigation)
      if (["menu", "listbox", "navigation", "toolbar"].includes(parentRole)) break;
      node = node.parentElement;
    }
    return node;
  }

  function hideBlockedTabs(root = document) {
    const candidates = new Set();
    const selector = [
      "#hdtb a",
      "#hdtb div[role='link']",
      "#hdtb span",
      "[role='navigation'] a",
      "[role='navigation'] div[role='link']",
      "[role='navigation'] span"
    ].join(", ");

    if (root.nodeType === Node.ELEMENT_NODE && safeMatches(root, selector)) {
      candidates.add(root);
    }

    if (typeof root.querySelectorAll === "function") {
      for (const node of root.querySelectorAll(selector)) {
        candidates.add(node);
      }
    }

    for (const candidate of candidates) {
      if (!looksLikeSearchModeNav(candidate)) continue;
      const text = safeText(candidate.textContent);
      if (!BLOCKED_SEARCH_TABS.has(text)) continue;
      removeNode(getMenuItemRoot(candidate));
    }

    for (const menu of document.querySelectorAll("[role='menu'], [role='listbox'], #hdtb-more-mn, .nPDzT")) {
      // A menu is considered empty if every child element is either hidden by us
      // or has no visible text content. Text nodes with only whitespace don't count.
      const hasVisibleContent = [...menu.children].some((child) => {
        if (child.dataset.pgextHidden === "1") return false;
        if (getComputedStyle(child).display === "none") return false;
        return safeText(child.textContent) !== "";
      });

      if (!hasVisibleContent) {
        removeNode(menu);
      }
    }
  }

  function isAiOverviewLabel(text) {
    return AI_OVERVIEW_LABELS.has(safeText(text));
  }

  function findAiOverviewAnchors(root = document) {
    const anchors = new Set();
    const headingSelector = "h1, h2, h3";

    if (root.nodeType === Node.ELEMENT_NODE && safeMatches(root, headingSelector) && isAiOverviewLabel(root.textContent)) {
      anchors.add(root);
    }

    if (typeof root.querySelectorAll === "function") {
      for (const heading of root.querySelectorAll(headingSelector)) {
        if (isAiOverviewLabel(heading.textContent)) {
          anchors.add(heading);
        }
      }
    }

    return [...anchors];
  }

  function findSearchResultContainer(anchor) {
    let node = anchor?.parentElement || null;

    while (node && node !== document.body) {
      const parent = node.parentElement;
      const parentId = parent?.id || "";
      const isTopLevelResultBlock = parentId === "search" || parentId === "rso" || parentId === "rcnt";
      const looksLikeResultCard = node.tagName === "DIV" && (
        node.hasAttribute("data-async-type") ||
        node.hasAttribute("data-hveid") ||
        isTopLevelResultBlock
      );

      if (looksLikeResultCard) {
        return node;
      }

      node = parent;
    }

    return null;
  }

  function hideAiOverview(root = document) {
    for (const anchor of findAiOverviewAnchors(root)) {
      const container = findSearchResultContainer(anchor);
      if (container) {
        hideElement(container);
      }
    }
  }

  function shouldRedirectToWebFilter(root = document) {
    const url = getUrl();
    if (!isGoogleSearchPage(url)) return false;
    if (hasExplicitMode(url)) return false;

    const query = getCurrentQuery(url);
    if (!query) return false;

    return findAiOverviewAnchors(root).length > 0;
  }

  function enforceWebFilterIfNeeded(root = document) {
    const url = getUrl();
    if (!isGoogleSearchPage(url)) return;
    if (hasExplicitMode(url)) return;

    const query = getCurrentQuery(url);
    if (!query) return;
    if (!shouldRedirectToWebFilter(root)) return;

    if (wasJustRedirected(query)) {
      clearRedirectMark();
      return;
    }

    markRedirected(query);
    url.searchParams.set("udm", WEB_FILTER_VALUE);
    location.replace(url.toString());
  }

  function runSearchPass(root = document) {
    if (!isGoogleSearchPage()) return;
    enforceWebFilterIfNeeded(root);
    hideBlockedTabs(root);
    hideAiOverview(root);
  }

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        runSearchPass(node);
      }
    }
  });

  runSearchPass(document);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  startBurst(() => runSearchPass(document), 250, 16);
  startUrlWatcher(() => runSearchPass(document));

  document.addEventListener(
    "DOMContentLoaded",
    () => runSearchPass(document),
                            { once: true }
  );
}

// ===== Main =====
function init() {
  const url = getUrl();

  if (isColabPage(url)) {
    initColab();
    return;
  }

  if (isGoogleSearchPage(url)) {
    initGoogleSearch();
    return;
  }

  if (isDocsOrSlidesContext()) {
    initDocsSlides();
  }
}

init();
})();
