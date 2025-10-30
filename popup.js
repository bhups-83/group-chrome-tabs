function isSkippableTab(tab) {
  const u = (tab?.url || '').toLowerCase();
  if (!u) return true;
  // Skip new tab and blank internal pages
  return u.startsWith('chrome://newtab') || u.startsWith('chrome://new-tab-page') || u === 'about:blank';
}

async function queryTabs(includeAllWindows) {
  const queryInfo = includeAllWindows ? {} : { currentWindow: true };
  const tabs = await chrome.tabs.query(queryInfo);
  return tabs.filter(t => !!t.url && !isSkippableTab(t));
}

function extractHostname(urlString) {
  try {
    const { hostname } = new URL(urlString);
    return hostname || 'unknown';
  } catch (_) {
    return 'unknown';
  }
}

function parseMergeRules(text) {
  // Returns an array of { label: string, testers: Array<(host:string)=>boolean> }
  const rules = [];
  if (!text) return rules;
  const lines = text.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    let label = '';
    let list = '';
    if (line.includes(':')) {
      const idx = line.indexOf(':');
      label = line.slice(0, idx).trim();
      list = line.slice(idx + 1).trim();
    } else {
      label = line.split(',')[0].trim();
      list = line;
    }
    if (!label) continue;
    const testers = [];
    for (const tokenRaw of list.split(',')) {
      const token = tokenRaw.trim();
      if (!token) continue;
      // Regex literal support: /pattern/flags
      const m = token.match(/^\/(.*)\/([a-z]*)$/i);
      if (m) {
        try {
          const re = new RegExp(m[1], m[2]);
          testers.push((host) => re.test(host));
          continue;
        } catch (_) {
          // fall through to wildcard/literal handling
        }
      }

      // Wildcard and literal handling
      let t = token.toLowerCase();
      // Strip URL port if present (host:port)
      if (t.includes(':') && !t.includes('://')) {
        t = t.split(':')[0];
      }
      // Remove leading '*.' or '.' which users often write for subdomains
      if (t.startsWith('*.')) t = t.slice(2);
      if (t.startsWith('.*.')) t = t.slice(3);
      if (t.startsWith('.')) t = t.slice(1);

      if (t.includes('*')) {
        // Convert wildcard token to regex: escape regex chars, then replace * -> .*
        const escaped = t.replace(/[.+?^${}()|\[\]\\]/g, '\\$&').replace(/\*/g, '.*');
        const re = new RegExp('^' + escaped + '$', 'i');
        testers.push((host) => re.test((host || '')));
      } else {
        const literal = t;
        testers.push((host) => {
          const h = (host || '').toLowerCase();
          return h === literal || h.endsWith('.' + literal);
        });
      }
    }
    if (testers.length > 0) {
      rules.push({ label, testers });
    }
  }
  return rules;
}

function labelForDomain(domain, rules) {
  const host = domain || '';
  for (const rule of rules || []) {
    if (rule.testers.some(t => t(host))) return rule.label;
  }
  return domain;
}

function groupTabsByDomain(tabs, rules) {
  const domainToTabs = new Map();
  for (const tab of tabs) {
    const baseDomain = extractHostname(tab.url);
    const domain = rules ? labelForDomain(baseDomain, rules) : baseDomain;
    const arr = domainToTabs.get(domain) || [];
    arr.push(tab);
    domainToTabs.set(domain, arr);
  }
  return domainToTabs;
}

function renderGroups(domainToTabs) {
  const groupsContainer = document.getElementById('groups');
  const summaryEl = document.getElementById('summary');
  groupsContainer.textContent = '';

  const allTabsCount = [...domainToTabs.values()].reduce((n, arr) => n + arr.length, 0);
  summaryEl.textContent = `${domainToTabs.size} domain(s), ${allTabsCount} tab(s)`;

  const template = document.getElementById('group-template');

  const sortedDomains = sortDomainsByRulesThenAlpha([...domainToTabs.keys()], lastParsedRules);
  for (const domain of sortedDomains) {
    const clone = template.content.firstElementChild.cloneNode(true);
    clone.querySelector('.domain').textContent = domain;
    clone.querySelector('.count').textContent = `${domainToTabs.get(domain).length}`;

    const list = clone.querySelector('.tabs');
    const tabs = domainToTabs.get(domain).slice().sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    for (const tab of tabs) {
      const li = document.createElement('li');
      const link = document.createElement('a');
      link.href = tab.url;
      link.title = tab.url;
      link.textContent = tab.title || tab.url;
      link.className = 'title';
      link.addEventListener('click', async (e) => {
        e.preventDefault();
        try {
          await chrome.tabs.update(tab.id, { active: true });
        } catch (_) {
          // ignore
        }
      });

      const urlEl = document.createElement('div');
      urlEl.textContent = tab.url;
      urlEl.className = 'url';

      li.appendChild(link);
      li.appendChild(urlEl);
      list.appendChild(li);
    }

    groupsContainer.appendChild(clone);
  }
}

const SMALL_POOL_LABEL = 'others';

function sortDomainsByRulesThenAlpha(domains, rules) {
  const labelOrder = new Map();
  if (rules) {
    let idx = 0;
    for (const r of rules) {
      if (!labelOrder.has(r.label)) labelOrder.set(r.label, idx++);
    }
  }
  return domains.slice().sort((a, b) => {
    // Always place pooled label at the end
    if (a === SMALL_POOL_LABEL && b !== SMALL_POOL_LABEL) return 1;
    if (b === SMALL_POOL_LABEL && a !== SMALL_POOL_LABEL) return -1;
    const ai = labelOrder.has(a) ? labelOrder.get(a) : Number.POSITIVE_INFINITY;
    const bi = labelOrder.has(b) ? labelOrder.get(b) : Number.POSITIVE_INFINITY;
    if (ai !== bi) return ai - bi;
    return a.localeCompare(b);
  });
}

function poolSmallDomains(domainToTabs, maxPerDomain = 2, pooledLabel = SMALL_POOL_LABEL) {
  const result = new Map();
  const pooled = [];
  for (const [label, tabs] of domainToTabs.entries()) {
    if (tabs.length <= maxPerDomain) {
      pooled.push(...tabs);
    } else {
      result.set(label, tabs);
    }
  }
  if (pooled.length > 0) {
    result.set(pooledLabel, pooled);
  }
  return result;
}

let lastParsedRules = null;

async function loadMergeRulesText() {
  return new Promise(resolve => {
    try {
      chrome.storage.sync.get({ mergeRulesText: '' }, (res) => resolve(res.mergeRulesText || ''));
    } catch (_) {
      resolve('');
    }
  });
}

async function saveMergeRulesText(text) {
  return new Promise((resolve) => {
    try { chrome.storage.sync.set({ mergeRulesText: text }, () => resolve()); }
    catch (_) { resolve(); }
  });
}

async function loadDevMode() {
  return new Promise(resolve => {
    try {
      chrome.storage.sync.get({ devMode: false }, (res) => resolve(Boolean(res.devMode)));
    } catch (_) {
      resolve(false);
    }
  });
}

async function saveDevMode(value) {
  return new Promise((resolve) => {
    try { chrome.storage.sync.set({ devMode: Boolean(value) }, () => resolve()); }
    catch (_) { resolve(); }
  });
}

async function refresh() {
  try {
    const devMode = document.getElementById('dev-mode').checked;
    const groupsContainer = document.getElementById('groups');
    const summaryEl = document.getElementById('summary');
    if (!devMode) {
      // Hide listing in non-dev mode
      groupsContainer.textContent = '';
      summaryEl.textContent = '';
      return;
    }
    const includeAllWindows = document.getElementById('all-windows').checked;
    const [tabs, rulesText] = await Promise.all([
      queryTabs(includeAllWindows),
      loadMergeRulesText()
    ]);
    const rules = parseMergeRules(rulesText);
    lastParsedRules = rules;
    const grouped = groupTabsByDomain(tabs, rules);
    const pooled = poolSmallDomains(grouped, 2, SMALL_POOL_LABEL);
    renderGroups(pooled);
  } catch (err) {
    const groupsContainer = document.getElementById('groups');
    groupsContainer.textContent = String(err);
  }
}

document.getElementById('refresh').addEventListener('click', () => {
  refresh();
});

document.addEventListener('DOMContentLoaded', () => {
  // Load merge rules text into textarea
  Promise.all([loadMergeRulesText(), loadDevMode()]).then(([text, dev]) => {
    const ta = document.getElementById('merge-rules');
    if (ta) ta.value = text;
    const dm = document.getElementById('dev-mode');
    if (dm) dm.checked = Boolean(dev);
  }).finally(() => refresh());
  renderGroupButtons();
});

async function groupIntoChromeTabGroups(includeAllWindows) {
  const thresholdInput = /** @type {HTMLInputElement} */ (document.getElementById('threshold'));
  const threshold = Math.max(1, parseInt(thresholdInput?.value || '20', 10) || 20);

  const [tabs, rulesText] = await Promise.all([
    queryTabs(Boolean(includeAllWindows)),
    loadMergeRulesText()
  ]);
  const rules = parseMergeRules(rulesText);
  lastParsedRules = rules;
  const domainToTabsRaw = groupTabsByDomain(tabs, rules);

  // Separate small domains (<=2 tabs) to pool later
  const smallLabel = SMALL_POOL_LABEL;
  const smallTabs = [];
  const domainToTabs = new Map();
  for (const [label, list] of domainToTabsRaw.entries()) {
    if (list.length <= 2) {
      smallTabs.push(...list);
    } else {
      domainToTabs.set(label, list);
    }
  }

  const colors = [
    'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'
  ];

  let colorIndex = 0;
  const sortedDomains = sortDomainsByRulesThenAlpha([...domainToTabs.keys()], rules);
  for (const domain of sortedDomains) {
    const domainTabs = domainToTabs.get(domain);
    const domainTabsUnpinned = domainTabs.filter(t => !t.pinned);
    const tabIds = domainTabsUnpinned.map(t => t.id).filter(Boolean);
    if (tabIds.length === 0) continue;

    if (tabIds.length > threshold) {
      // Move to a new window, then group there
      try {
        const newWin = await chrome.windows.create({});
        await chrome.tabs.move(tabIds, { windowId: newWin.id, index: -1 });
        const groupId = await chrome.tabs.group({ tabIds, createProperties: { windowId: newWin.id } });
        const color = colors[colorIndex++ % colors.length];
        await chrome.tabGroups.update(groupId, { title: domain, color });
      } catch (_) {
        // Ignore errors
      }
    } else {
      // Consolidate same-domain tabs into a single window: pick the window
      // that already contains the most tabs for this domain, move the rest there,
      // then create a single tab group for the domain in that window.
      const tabsByWindow = new Map();
      for (const t of domainTabsUnpinned) {
        const arr = tabsByWindow.get(t.windowId) || [];
        arr.push(t);
        tabsByWindow.set(t.windowId, arr);
      }

      // Choose target window: window with the maximum number of this domain's tabs
      let targetWindowId = null;
      let maxCount = -1;
      for (const [winId, winTabs] of tabsByWindow.entries()) {
        if (winTabs.length > maxCount) {
          maxCount = winTabs.length;
          targetWindowId = winId;
        }
      }
      if (targetWindowId == null) {
        // Fallback: use the window of the first tab
        targetWindowId = domainTabsUnpinned[0].windowId;
      }

      // Move tabs not in target window into target window
      const toMove = domainTabsUnpinned.filter(t => t.windowId !== targetWindowId).map(t => t.id).filter(Boolean);
      try {
        if (toMove.length > 0) {
          await chrome.tabs.move(toMove, { windowId: targetWindowId, index: -1 });
        }
        const groupId = await chrome.tabs.group({ tabIds, createProperties: { windowId: targetWindowId } });
        const color = colors[colorIndex++ % colors.length];
        await chrome.tabGroups.update(groupId, { title: domain, color });
      } catch (_) {
        // Ignore errors
      }
    }
  }

  // Finally, create a single pooled group for all small domains if any
  if (smallTabs.length > 0) {
    try {
      const unpinned = smallTabs.filter(t => !t.pinned);
      if (unpinned.length === 0) {
        return;
      }
      if (unpinned.length > threshold) {
        const newWin = await chrome.windows.create({});
        const ids = unpinned.map(t => t.id).filter(Boolean);
        if (ids.length > 0) {
          await chrome.tabs.move(ids, { windowId: newWin.id, index: -1 });
        }
        const groupId = await chrome.tabs.group({ tabIds: ids, createProperties: { windowId: newWin.id } });
        const color = colors[colorIndex++ % colors.length];
        await chrome.tabGroups.update(groupId, { title: smallLabel, color });
      } else {
        // Consolidate into single existing window with most of these tabs
        const byWindow = new Map();
        for (const t of unpinned) {
          const arr = byWindow.get(t.windowId) || [];
          arr.push(t);
          byWindow.set(t.windowId, arr);
        }
        let targetWindowId = null;
        let maxCount = -1;
        for (const [winId, winTabs] of byWindow.entries()) {
          if (winTabs.length > maxCount) { maxCount = winTabs.length; targetWindowId = winId; }
        }
        if (targetWindowId == null) targetWindowId = unpinned[0].windowId;
        const ids = unpinned.map(t => t.id).filter(Boolean);
        const toMove = ids.filter(id => {
          const tab = unpinned.find(t => t.id === id);
          return tab && tab.windowId !== targetWindowId;
        });
        if (toMove.length > 0) {
          await chrome.tabs.move(toMove, { windowId: targetWindowId, index: -1 });
        }
        const groupId = await chrome.tabs.group({ tabIds: ids, createProperties: { windowId: targetWindowId } });
        const color = colors[colorIndex++ % colors.length];
        await chrome.tabGroups.update(groupId, { title: smallLabel, color });
      }
    } catch (_) {
      // ignore errors
    }
  }

  // Rerender with current options
  refresh();
}

document.getElementById('save-merge-rules').addEventListener('click', async () => {
  const ta = /** @type {HTMLTextAreaElement} */ (document.getElementById('merge-rules'));
  const text = ta?.value || '';
  await saveMergeRulesText(text);
  await refresh();
});

document.getElementById('dev-mode').addEventListener('change', async (e) => {
  const checked = /** @type {HTMLInputElement} */ (e.target).checked;
  await saveDevMode(checked);
  await refresh();
});

// Show/hide merge rules under Dev mode
async function toggleDevPanelsVisibility() {
  try {
    const devMode = document.getElementById('dev-mode').checked;
    const rules = document.querySelector('.merge-rules');
    if (rules) rules.hidden = !devMode;
  } catch (_) {}
}

document.getElementById('dev-mode').addEventListener('change', toggleDevPanelsVisibility);
document.addEventListener('DOMContentLoaded', toggleDevPanelsVisibility);

// Header CTA: group the current active tab in current window
document.getElementById('group-active').addEventListener('click', async () => {
  const panel = document.getElementById('group-active-panel');
  const select = /** @type {HTMLSelectElement} */ (document.getElementById('group-select'));
  const titleInput = /** @type {HTMLInputElement} */ (document.getElementById('group-title'));
  const titleRow = document.getElementById('group-title-row');
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!activeTab) return;
    const windowId = activeTab.windowId;
    const defaultTitle = extractHostname(activeTab.url || '') || 'Group';

    // Populate select with groups from ALL windows
    select.textContent = '';
    const groups = await chrome.tabGroups.query({});
    const newOpt = document.createElement('option');
    newOpt.value = 'new';
    newOpt.textContent = 'New group…';
    select.appendChild(newOpt);
    for (const g of groups) {
      const opt = document.createElement('option');
      opt.value = JSON.stringify({ id: g.id, windowId: g.windowId });
      const label = g.title || `Group #${g.id}`;
      opt.textContent = `${label} (Window ${g.windowId})`;
      select.appendChild(opt);
    }
    select.value = 'new';
    titleInput.value = defaultTitle;
    titleRow.hidden = false;
    panel.hidden = false;

    select.onchange = () => {
      const isNew = select.value === 'new';
      titleRow.hidden = !isNew;
    };

    document.getElementById('group-active-cancel').onclick = () => {
      panel.hidden = true;
    };

    document.getElementById('group-active-confirm').onclick = async () => {
      try {
        const [activeTab2] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!activeTab2 || activeTab2.id == null) return;
        const ids = [activeTab2.id];
        if (select.value === 'new') {
          const title = titleInput.value.trim() || defaultTitle;
          const groupId = await chrome.tabs.group({ tabIds: ids, createProperties: { windowId } });
          await chrome.tabGroups.update(groupId, { title });
        } else {
          const parsed = JSON.parse(select.value);
          const targetWinId = parsed.windowId;
          const groupId = parsed.id;
          if (activeTab2.windowId !== targetWinId) {
            await chrome.tabs.move(ids, { windowId: targetWinId, index: -1 });
          }
          await chrome.tabs.group({ tabIds: ids, groupId });
        }
      } catch (_) {
        // ignore
      } finally {
        panel.hidden = true;
      }
    };
  } catch (_) {
    // ignore
  }
});

async function renderGroupButtons() {
  const container = document.getElementById('group-buttons');
  container.textContent = '';
  try {
    const wins = await chrome.windows.getAll();
    const makeBtn = (id, label, handler) => {
      const b = document.createElement('button');
      b.id = id;
      b.textContent = label;
      b.title = label;
      b.addEventListener('click', handler);
      return b;
    };
    if (wins.length <= 1) {
      container.appendChild(makeBtn('group-current-window', 'Group tabs', () => groupIntoChromeTabGroups(false)));
    } else {
      container.appendChild(makeBtn('group-current-window', 'Group tabs (current window)', () => groupIntoChromeTabGroups(false)));
      container.appendChild(makeBtn('group-all-windows', 'Group tabs (all windows)', () => groupIntoChromeTabGroups(true)));
    }
  } catch (_) {
    // ignore
  }
}


