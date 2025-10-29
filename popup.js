async function queryTabs(includeAllWindows) {
  const queryInfo = includeAllWindows ? {} : { currentWindow: true };
  const tabs = await chrome.tabs.query(queryInfo);
  return tabs.filter(t => !!t.url);
}

function extractHostname(urlString) {
  try {
    const { hostname } = new URL(urlString);
    return hostname || 'unknown';
  } catch (_) {
    return 'unknown';
  }
}

function groupTabsByDomain(tabs) {
  const domainToTabs = new Map();
  for (const tab of tabs) {
    const domain = extractHostname(tab.url);
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

  const sortedDomains = [...domainToTabs.keys()].sort((a, b) => a.localeCompare(b));
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

async function refresh() {
  try {
    const includeAllWindows = document.getElementById('all-windows').checked;
    const tabs = await queryTabs(includeAllWindows);
    const groups = groupTabsByDomain(tabs);
    renderGroups(groups);
  } catch (err) {
    const groupsContainer = document.getElementById('groups');
    groupsContainer.textContent = String(err);
  }
}

document.getElementById('refresh').addEventListener('click', () => {
  refresh();
});

document.addEventListener('DOMContentLoaded', () => {
  refresh();
});

async function groupIntoChromeTabGroups() {
  const includeAllWindows = document.getElementById('all-windows').checked;
  const thresholdInput = /** @type {HTMLInputElement} */ (document.getElementById('threshold'));
  const threshold = Math.max(1, parseInt(thresholdInput?.value || '20', 10) || 20);

  const tabs = await queryTabs(includeAllWindows);
  const domainToTabs = groupTabsByDomain(tabs);

  const colors = [
    'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'
  ];

  let colorIndex = 0;
  const sortedDomains = [...domainToTabs.keys()].sort((a, b) => a.localeCompare(b));
  for (const domain of sortedDomains) {
    const domainTabs = domainToTabs.get(domain);
    const tabIds = domainTabs.map(t => t.id).filter(Boolean);
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
      for (const t of domainTabs) {
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
        targetWindowId = domainTabs[0].windowId;
      }

      // Move tabs not in target window into target window
      const toMove = domainTabs.filter(t => t.windowId !== targetWindowId).map(t => t.id).filter(Boolean);
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

  // Rerender with current options
  refresh();
}

document.getElementById('group').addEventListener('click', () => {
  groupIntoChromeTabGroups();
});


