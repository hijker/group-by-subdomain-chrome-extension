/**
 * Sidebar script for Tab Grouper by Subdomain (Firefox)
 */

const groupsContainer = document.getElementById('groupsContainer');
const contextMenu = document.getElementById('contextMenu');
const collapseAllBtn = document.getElementById('collapseAll');
const expandAllBtn = document.getElementById('expandAll');

// Track collapsed state
const collapsedGroups = new Set();
let currentContextGroup = null;

/**
 * Render the tab groups
 */
async function renderGroups() {
  const groups = await browser.runtime.sendMessage({ action: 'getGroupedTabs' });
  const groupKeys = Object.keys(groups);

  if (groupKeys.length === 0) {
    groupsContainer.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📑</div>
        <p>No tab groups yet</p>
      </div>
    `;
    return;
  }

  groupsContainer.innerHTML = groupKeys.map(key => {
    const group = groups[key];
    const isCollapsed = collapsedGroups.has(key);

    return `
      <div class="group ${isCollapsed ? 'collapsed' : ''}" data-group-key="${key}">
        <div class="group-header" data-group-key="${key}">
          <div class="group-color" style="background-color: ${group.color}"></div>
          <span class="group-name">${escapeHtml(group.name)}</span>
          <span class="group-count">${group.tabs.length}</span>
          <div class="group-actions">
            <button class="group-action-btn" data-action="consolidate" title="Move tabs together">⊞</button>
            <button class="group-action-btn" data-action="menu" title="More options">⋯</button>
          </div>
          <span class="group-toggle">▼</span>
        </div>
        <div class="group-tabs">
          ${group.tabs.map(tab => `
            <div class="tab ${tab.active ? 'active' : ''}" data-tab-id="${tab.id}">
              ${tab.favIconUrl
                ? `<img class="tab-favicon" src="${escapeHtml(tab.favIconUrl)}" onerror="this.className='tab-favicon-placeholder'">`
                : '<div class="tab-favicon-placeholder"></div>'
              }
              <span class="tab-title" title="${escapeHtml(tab.title)}">${escapeHtml(tab.title)}</span>
              <button class="tab-close" data-tab-id="${tab.id}" title="Close tab">×</button>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }).join('');

  // Attach event listeners
  attachEventListeners();
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text || '';
  return div.innerHTML;
}

/**
 * Attach event listeners to dynamic elements
 */
function attachEventListeners() {
  // Group header clicks (toggle collapse)
  document.querySelectorAll('.group-header').forEach(header => {
    header.addEventListener('click', (e) => {
      if (e.target.closest('.group-actions')) return;

      const groupKey = header.dataset.groupKey;
      const group = header.closest('.group');

      if (collapsedGroups.has(groupKey)) {
        collapsedGroups.delete(groupKey);
        group.classList.remove('collapsed');
      } else {
        collapsedGroups.add(groupKey);
        group.classList.add('collapsed');
      }
    });
  });

  // Tab clicks (focus tab)
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', (e) => {
      if (e.target.closest('.tab-close')) return;

      const tabId = parseInt(tab.dataset.tabId);
      browser.runtime.sendMessage({ action: 'focusTab', tabId });
    });
  });

  // Tab close buttons
  document.querySelectorAll('.tab-close').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const tabId = parseInt(btn.dataset.tabId);
      await browser.tabs.remove(tabId);
    });
  });

  // Group action buttons
  document.querySelectorAll('.group-action-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const action = btn.dataset.action;
      const groupKey = btn.closest('.group-header').dataset.groupKey;

      if (action === 'consolidate') {
        browser.runtime.sendMessage({ action: 'consolidateGroup', groupKey });
      } else if (action === 'menu') {
        showContextMenu(e, groupKey);
      }
    });
  });
}

/**
 * Show context menu
 */
function showContextMenu(event, groupKey) {
  currentContextGroup = groupKey;
  contextMenu.style.left = `${event.clientX}px`;
  contextMenu.style.top = `${event.clientY}px`;
  contextMenu.classList.add('show');

  // Adjust position if menu goes off screen
  const rect = contextMenu.getBoundingClientRect();
  if (rect.right > window.innerWidth) {
    contextMenu.style.left = `${window.innerWidth - rect.width - 10}px`;
  }
  if (rect.bottom > window.innerHeight) {
    contextMenu.style.top = `${window.innerHeight - rect.height - 10}px`;
  }
}

/**
 * Hide context menu
 */
function hideContextMenu() {
  contextMenu.classList.remove('show');
  currentContextGroup = null;
}

// Context menu item clicks
contextMenu.querySelectorAll('.context-menu-item').forEach(item => {
  item.addEventListener('click', () => {
    const action = item.dataset.action;

    if (currentContextGroup) {
      switch (action) {
        case 'consolidate':
          browser.runtime.sendMessage({ action: 'consolidateGroup', groupKey: currentContextGroup });
          break;
        case 'closeOthers':
          browser.runtime.sendMessage({ action: 'closeGroupTabs', groupKey: currentContextGroup });
          break;
        case 'closeAll':
          browser.runtime.sendMessage({ action: 'closeAllGroupTabs', groupKey: currentContextGroup });
          break;
      }
    }

    hideContextMenu();
  });
});

// Hide context menu on click outside
document.addEventListener('click', (e) => {
  if (!contextMenu.contains(e.target)) {
    hideContextMenu();
  }
});

// Collapse/Expand all buttons
collapseAllBtn.addEventListener('click', () => {
  document.querySelectorAll('.group').forEach(group => {
    const key = group.dataset.groupKey;
    collapsedGroups.add(key);
    group.classList.add('collapsed');
  });
});

expandAllBtn.addEventListener('click', () => {
  document.querySelectorAll('.group').forEach(group => {
    const key = group.dataset.groupKey;
    collapsedGroups.delete(key);
    group.classList.remove('collapsed');
  });
});

// Listen for tab changes from background
browser.runtime.onMessage.addListener((message) => {
  if (message.action === 'tabsChanged') {
    renderGroups();
  }
});

// Initial render
renderGroups();
