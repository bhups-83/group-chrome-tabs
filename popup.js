async function queryCurrentWindowTabs() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
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
    const tabs = await queryCurrentWindowTabs();
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
  const tabs = await queryCurrentWindowTabs();
  const domainToTabs = groupTabsByDomain(tabs);
  const windowId = tabs[0]?.windowId;
  if (windowId == null) return;

  const colors = [
    'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'
  ];

  let colorIndex = 0;
  const sortedDomains = [...domainToTabs.keys()].sort((a, b) => a.localeCompare(b));
  for (const domain of sortedDomains) {
    const tabIds = domainToTabs.get(domain).map(t => t.id).filter(Boolean);
    if (tabIds.length === 0) continue;
    try {
      const groupId = await chrome.tabs.group({ tabIds, createProperties: { windowId } });
      const color = colors[colorIndex++ % colors.length];
      await chrome.tabGroups.update(groupId, { title: domain, color });
    } catch (_) {
      // Ignore grouping errors
    }
  }
}

document.getElementById('group').addEventListener('click', () => {
  groupIntoChromeTabGroups();
});


