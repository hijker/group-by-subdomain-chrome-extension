/**
 * Tab Grouper by Subdomain
 * Automatically groups tabs by domain and subdomain (up to 1 level)
 */

// Store for group IDs mapped to subdomain keys
const groupCache = new Map();

// Color palette for tab groups
const GROUP_COLORS = ['blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange', 'grey'];
let colorIndex = 0;

// Settings with defaults
let settings = {
  enabled: true,
  autoGroup: true,
  collapseGroups: false,
  ignoreWww: true
};

// Load settings from storage
async function loadSettings() {
  const stored = await chrome.storage.sync.get('settings');
  if (stored.settings) {
    settings = { ...settings, ...stored.settings };
  }
}

// Save settings to storage
async function saveSettings(newSettings) {
  settings = { ...settings, ...newSettings };
  await chrome.storage.sync.set({ settings });
}

/**
 * Extract the grouping key from a URL
 * Returns the full hostname (handles www prefix based on settings)
 * @param {string} url - The tab URL
 * @returns {string|null} - The grouping key or null for invalid URLs
 */
function getGroupingKey(url) {
  try {
    const urlObj = new URL(url);
    let hostname = urlObj.hostname;

    // Skip chrome:// and other special URLs
    if (!hostname || urlObj.protocol === 'chrome:' || urlObj.protocol === 'chrome-extension:' || urlObj.protocol === 'about:') {
      return null;
    }

    // Handle IP addresses - group by full IP
    if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
      return hostname;
    }

    // Handle localhost
    if (hostname === 'localhost') {
      return 'localhost';
    }

    // Handle www prefix based on settings - remove www. from the beginning
    if (settings.ignoreWww && hostname.startsWith('www.')) {
      hostname = hostname.substring(4);
    }

    return hostname;
  } catch (e) {
    console.error('Error parsing URL:', url, e);
    return null;
  }
}

/**
 * Get display name for a group (clean format)
 * Returns the first word of the hostname (subdomain or domain name)
 * @param {string} key - The grouping key (e.g., "grafana.mms.company.com" or "google.com")
 * @returns {string} - Display name for the group (e.g., "grafana" or "google")
 */
function getDisplayName(key) {
  // Handle IP addresses and localhost - return as-is
  if (/^\d+\.\d+\.\d+\.\d+$/.test(key) || key === 'localhost') {
    return key;
  }

  // Return the first part (leftmost subdomain or domain name)
  const parts = key.split('.');
  return parts[0];
}

/**
 * Get a color that doesn't conflict with adjacent groups
 * @param {number} windowId - The window ID
 * @param {number} tabIndex - The index of the tab being grouped
 * @returns {Promise<string>} - Color name
 */
async function getSmartColor(windowId, tabIndex) {
  try {
    // Get all groups in the window
    const groups = await chrome.tabGroups.query({ windowId });

    if (groups.length === 0) {
      return GROUP_COLORS[0];
    }

    // Get all tabs to understand group positions
    const tabs = await chrome.tabs.query({ windowId });

    // Find adjacent group colors based on tab position
    let prevGroupColor = null;
    let nextGroupColor = null;

    // Look backwards for previous group
    for (let i = tabIndex - 1; i >= 0; i--) {
      if (tabs[i] && tabs[i].groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
        const group = groups.find(g => g.id === tabs[i].groupId);
        if (group) {
          prevGroupColor = group.color;
          break;
        }
      }
    }

    // Look forwards for next group
    for (let i = tabIndex + 1; i < tabs.length; i++) {
      if (tabs[i] && tabs[i].groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
        const group = groups.find(g => g.id === tabs[i].groupId);
        if (group) {
          nextGroupColor = group.color;
          break;
        }
      }
    }

    // Find a color that's different from both neighbors
    const availableColors = GROUP_COLORS.filter(c => c !== prevGroupColor && c !== nextGroupColor);

    if (availableColors.length > 0) {
      // Pick a random color from available ones for variety
      return availableColors[Math.floor(Math.random() * availableColors.length)];
    }

    // Fallback: just pick one different from immediate previous
    const fallbackColors = GROUP_COLORS.filter(c => c !== prevGroupColor);
    return fallbackColors.length > 0 ? fallbackColors[0] : GROUP_COLORS[0];

  } catch (e) {
    // Fallback to simple rotation
    const color = GROUP_COLORS[colorIndex % GROUP_COLORS.length];
    colorIndex++;
    return color;
  }
}

/**
 * Find or create a tab group for the given key
 * @param {string} key - The grouping key
 * @param {number} windowId - The window ID
 * @returns {Promise<number>} - The group ID
 */
async function findOrCreateGroup(key, windowId) {
  const cacheKey = `${windowId}-${key}`;

  // Check cache first
  if (groupCache.has(cacheKey)) {
    const groupId = groupCache.get(cacheKey);
    try {
      // Verify group still exists
      await chrome.tabGroups.get(groupId);
      return groupId;
    } catch (e) {
      // Group no longer exists, remove from cache
      groupCache.delete(cacheKey);
    }
  }

  // Look for existing group with matching title
  const groups = await chrome.tabGroups.query({ windowId });
  const displayName = getDisplayName(key);

  for (const group of groups) {
    if (group.title === displayName) {
      groupCache.set(cacheKey, group.id);
      return group.id;
    }
  }

  // No existing group found, will need to create one
  return null;
}

/**
 * Group a single tab by its URL
 * @param {chrome.tabs.Tab} tab - The tab to group
 * @param {boolean} force - If true, ignore existing group membership
 */
async function groupTab(tab, force = false) {
  if (!settings.enabled || !settings.autoGroup) return;
  if (!tab.url || tab.pinned) return;

  // Respect existing groups - don't move tabs that are already grouped
  if (!force && tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
    return;
  }

  const key = getGroupingKey(tab.url);
  if (!key) return;

  try {
    let groupId = await findOrCreateGroup(key, tab.windowId);

    if (groupId) {
      // Add to existing group
      await chrome.tabs.group({ tabIds: tab.id, groupId });
    } else {
      // Create new group
      groupId = await chrome.tabs.group({ tabIds: tab.id });

      // Get a color that doesn't conflict with adjacent groups
      const color = await getSmartColor(tab.windowId, tab.index);

      // Update group properties
      await chrome.tabGroups.update(groupId, {
        title: getDisplayName(key),
        color: color,
        collapsed: settings.collapseGroups
      });

      // Cache the new group
      const cacheKey = `${tab.windowId}-${key}`;
      groupCache.set(cacheKey, groupId);
    }
  } catch (e) {
    console.error('Error grouping tab:', e);
  }
}

/**
 * Group all tabs in a window
 * @param {number} windowId - The window ID
 * @param {boolean} force - If true, regroup all tabs ignoring existing groups
 */
async function groupAllTabsInWindow(windowId, force = false) {
  if (!settings.enabled) return;

  const tabs = await chrome.tabs.query({ windowId });
  const tabsByKey = new Map();

  // Group tabs by their key
  for (const tab of tabs) {
    if (tab.pinned || !tab.url) continue;

    // Respect existing groups - skip tabs that are already grouped (unless force)
    if (!force && tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
      continue;
    }

    const key = getGroupingKey(tab.url);
    if (!key) continue;

    if (!tabsByKey.has(key)) {
      tabsByKey.set(key, []);
    }
    tabsByKey.get(key).push(tab);
  }

  // Create groups for each key
  for (const [key, keyTabs] of tabsByKey) {
    if (keyTabs.length === 0) continue;

    try {
      const tabIds = keyTabs.map(t => t.id);
      let groupId = await findOrCreateGroup(key, windowId);

      if (groupId) {
        // Add to existing group
        await chrome.tabs.group({ tabIds, groupId });
      } else {
        // Create new group
        groupId = await chrome.tabs.group({ tabIds });

        // Get a color that doesn't conflict with adjacent groups
        // Use the first tab's index as reference
        const firstTabIndex = keyTabs[0].index;
        const color = await getSmartColor(windowId, firstTabIndex);

        await chrome.tabGroups.update(groupId, {
          title: getDisplayName(key),
          color: color,
          collapsed: settings.collapseGroups
        });

        const cacheKey = `${windowId}-${key}`;
        groupCache.set(cacheKey, groupId);
      }
    } catch (e) {
      console.error('Error grouping tabs for key:', key, e);
    }
  }
}

/**
 * Group all tabs in all windows
 * @param {boolean} force - If true, regroup all tabs ignoring existing groups
 */
async function groupAllTabs(force = false) {
  const windows = await chrome.windows.getAll({ windowTypes: ['normal'] });
  for (const window of windows) {
    await groupAllTabsInWindow(window.id, force);
  }
}

/**
 * Ungroup all tabs in all windows
 */
async function ungroupAllTabs() {
  const tabs = await chrome.tabs.query({});
  const groupedTabs = tabs.filter(t => t.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE);

  if (groupedTabs.length > 0) {
    await chrome.tabs.ungroup(groupedTabs.map(t => t.id));
  }

  groupCache.clear();
}

// Event Listeners

// Tab created - always move to correct group based on URL
chrome.tabs.onCreated.addListener((tab) => {
  // Wait a bit for the URL to be set
  setTimeout(() => {
    chrome.tabs.get(tab.id).then((t) => groupTab(t, true)).catch(() => { });
  }, 100);
});

// Tab updated (URL changed) - always move to correct group based on new URL
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url) {
    groupTab(tab, true);
  }
});

// Tab attached to window - always move to correct group
chrome.tabs.onAttached.addListener((tabId, attachInfo) => {
  chrome.tabs.get(tabId).then((t) => groupTab(t, true)).catch(() => { });
});

// Group removed - clean up cache
chrome.tabGroups.onRemoved.addListener((group) => {
  // Remove from cache
  for (const [key, id] of groupCache) {
    if (id === group.id) {
      groupCache.delete(key);
      break;
    }
  }
});

/**
 * Update color of a group if it conflicts with adjacent groups
 * @param {number} groupId - The group ID to check
 * @param {number} windowId - The window ID
 */
async function updateGroupColorIfNeeded(groupId, windowId) {
  try {
    const groups = await chrome.tabGroups.query({ windowId });
    const tabs = await chrome.tabs.query({ windowId });

    // Sort groups by their first tab's position
    const groupPositions = [];
    for (const group of groups) {
      const firstTab = tabs.find(t => t.groupId === group.id);
      if (firstTab) {
        groupPositions.push({ group, index: firstTab.index });
      }
    }
    groupPositions.sort((a, b) => a.index - b.index);

    // Find the moved group and its neighbors
    const movedIndex = groupPositions.findIndex(gp => gp.group.id === groupId);
    if (movedIndex === -1) return;

    const movedGroup = groupPositions[movedIndex].group;
    const prevGroup = movedIndex > 0 ? groupPositions[movedIndex - 1].group : null;
    const nextGroup = movedIndex < groupPositions.length - 1 ? groupPositions[movedIndex + 1].group : null;

    // Check if color conflicts with neighbors
    const hasConflict =
      (prevGroup && prevGroup.color === movedGroup.color) ||
      (nextGroup && nextGroup.color === movedGroup.color);

    if (hasConflict) {
      // Find a color that doesn't conflict
      const usedColors = [prevGroup?.color, nextGroup?.color].filter(Boolean);
      const availableColors = GROUP_COLORS.filter(c => !usedColors.includes(c));

      if (availableColors.length > 0) {
        const newColor = availableColors[Math.floor(Math.random() * availableColors.length)];
        await chrome.tabGroups.update(groupId, { color: newColor });
      }
    }
  } catch (e) {
    console.error('Error updating group color:', e);
  }
}

// Debounce timer for group moves
let groupMoveTimeout = null;

// Tab moved - check if group colors need updating
chrome.tabs.onMoved.addListener((tabId, moveInfo) => {
  // Debounce to avoid multiple updates during drag
  clearTimeout(groupMoveTimeout);
  groupMoveTimeout = setTimeout(async () => {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
        await updateGroupColorIfNeeded(tab.groupId, tab.windowId);
      }
    } catch (e) { }
  }, 300);
});

// Group updated - check colors when group properties change
chrome.tabGroups.onUpdated.addListener((group) => {
  // Debounce to avoid rapid updates
  clearTimeout(groupMoveTimeout);
  groupMoveTimeout = setTimeout(() => {
    updateGroupColorIfNeeded(group.id, group.windowId);
  }, 300);
});

// Listen for messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'getSettings') {
    sendResponse(settings);
  } else if (message.action === 'saveSettings') {
    saveSettings(message.settings).then(() => sendResponse({ success: true }));
    return true; // Async response
  } else if (message.action === 'groupAllTabs') {
    // Only group ungrouped tabs (respects existing groups)
    groupAllTabs(false).then(() => sendResponse({ success: true }));
    return true;
  } else if (message.action === 'forceGroupAllTabs') {
    // Force regroup all tabs (ignores existing groups)
    groupAllTabs(true).then(() => sendResponse({ success: true }));
    return true;
  } else if (message.action === 'ungroupAllTabs') {
    ungroupAllTabs().then(() => sendResponse({ success: true }));
    return true;
  }
});

// Initialize
loadSettings().then(() => {
  console.log('Tab Grouper by Subdomain initialized');
  // Optionally group existing tabs on install
  if (settings.autoGroup) {
    groupAllTabs();
  }
});
