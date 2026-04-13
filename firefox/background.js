/**
 * Tab Grouper by Subdomain - Firefox Version
 * Automatically groups tabs by domain and subdomain using Firefox's native tab groups
 */

// Store for group IDs mapped to subdomain keys
const groupCache = new Map();

// Reverse lookup: groupId -> grouping key (to detect renames)
const groupIdToKey = new Map();

// Lock mechanism to prevent race conditions when creating groups
const pendingGroups = new Map(); // key -> Promise

// Color palette for tab groups (Firefox uses same color names as Chrome)
const GROUP_COLORS = ['blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange', 'grey'];
let colorIndex = 0;

// Custom names: grouping key -> user-defined name
let customNames = {};

// Settings with defaults
let settings = {
  enabled: true,
  autoGroup: true,
  collapseGroups: false,
  ignoreWww: true
};

// Load settings and custom names from storage
async function loadSettings() {
  try {
    const stored = await browser.storage.sync.get(['settings', 'customNames']);
    if (stored.settings) {
      settings = { ...settings, ...stored.settings };
    }
    if (stored.customNames) {
      customNames = stored.customNames;
    }
  } catch (e) {
    console.error('Error loading settings:', e);
  }
}

// Save settings to storage
async function saveSettings(newSettings) {
  settings = { ...settings, ...newSettings };
  await browser.storage.sync.set({ settings });
}

// Save custom names to storage
async function saveCustomNames() {
  await browser.storage.sync.set({ customNames });
}

// Reset all custom names
async function resetCustomNames() {
  customNames = {};
  await browser.storage.sync.remove('customNames');
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

    // Skip special URLs
    if (!hostname ||
        urlObj.protocol === 'about:' ||
        urlObj.protocol === 'moz-extension:' ||
        urlObj.protocol === 'file:') {
      return null;
    }

    // Handle IP addresses
    if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
      return hostname;
    }

    // Handle localhost
    if (hostname === 'localhost') {
      return 'localhost';
    }

    // Handle www prefix based on settings
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
 * Get display name for a group
 * Checks custom names first, then falls back to first word of hostname
 * @param {string} key - The grouping key
 * @returns {string} - Display name for the group
 */
function getDisplayName(key) {
  // Check if user has set a custom name for this key
  if (customNames[key]) {
    return customNames[key];
  }

  if (/^\d+\.\d+\.\d+\.\d+$/.test(key) || key === 'localhost') {
    return key;
  }
  const parts = key.split('.');
  return parts[0];
}

/**
 * Get the default (auto-generated) display name for a key, ignoring custom names
 * @param {string} key - The grouping key
 * @returns {string} - Default display name
 */
function getDefaultDisplayName(key) {
  if (/^\d+\.\d+\.\d+\.\d+$/.test(key) || key === 'localhost') {
    return key;
  }
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
    const groups = await browser.tabGroups.query({ windowId });

    if (groups.length === 0) {
      return GROUP_COLORS[0];
    }

    const tabs = await browser.tabs.query({ windowId });

    let prevGroupColor = null;
    let nextGroupColor = null;

    // Look backwards for previous group
    for (let i = tabIndex - 1; i >= 0; i--) {
      if (tabs[i] && tabs[i].groupId !== browser.tabGroups.TAB_GROUP_ID_NONE) {
        const group = groups.find(g => g.id === tabs[i].groupId);
        if (group) {
          prevGroupColor = group.color;
          break;
        }
      }
    }

    // Look forwards for next group
    for (let i = tabIndex + 1; i < tabs.length; i++) {
      if (tabs[i] && tabs[i].groupId !== browser.tabGroups.TAB_GROUP_ID_NONE) {
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
      return availableColors[Math.floor(Math.random() * availableColors.length)];
    }

    const fallbackColors = GROUP_COLORS.filter(c => c !== prevGroupColor);
    return fallbackColors.length > 0 ? fallbackColors[0] : GROUP_COLORS[0];

  } catch (e) {
    const color = GROUP_COLORS[colorIndex % GROUP_COLORS.length];
    colorIndex++;
    return color;
  }
}

/**
 * Find or create a tab group for the given key
 * @param {string} key - The grouping key
 * @param {number} windowId - The window ID
 * @returns {Promise<number>} - The group ID or null
 */
async function findOrCreateGroup(key, windowId) {
  const cacheKey = `${windowId}-${key}`;

  if (groupCache.has(cacheKey)) {
    const groupId = groupCache.get(cacheKey);
    try {
      await browser.tabGroups.get(groupId);
      groupIdToKey.set(groupId, key);
      return groupId;
    } catch (e) {
      groupCache.delete(cacheKey);
      groupIdToKey.delete(groupId);
    }
  }

  // Look for existing group with matching title (check both custom and default names)
  const groups = await browser.tabGroups.query({ windowId });
  const displayName = getDisplayName(key);
  const defaultName = getDefaultDisplayName(key);

  for (const group of groups) {
    if (group.title === displayName || group.title === defaultName) {
      groupCache.set(cacheKey, group.id);
      groupIdToKey.set(group.id, key);
      return group.id;
    }
  }

  return null;
}

/**
 * Group a single tab by its URL
 * @param {object} tab - The tab to group
 * @param {boolean} force - If true, ignore existing group membership
 */
async function groupTab(tab, force = false) {
  if (!settings.enabled || !settings.autoGroup) return;
  if (!tab.url || tab.pinned) return;

  if (!force && tab.groupId !== browser.tabGroups.TAB_GROUP_ID_NONE) {
    return;
  }

  const key = getGroupingKey(tab.url);
  if (!key) return;

  const lockKey = `${tab.windowId}-${key}`;

  try {
    // If there's a pending group creation, wait for it
    if (pendingGroups.has(lockKey)) {
      await pendingGroups.get(lockKey);
    }

    // Check if group exists (might have been created while waiting)
    let groupId = await findOrCreateGroup(key, tab.windowId);

    if (groupId) {
      // Add to existing group
      await browser.tabs.group({ tabIds: tab.id, groupId });
    } else {
      // Acquire lock for creating the group
      let resolvePromise;
      const promise = new Promise(resolve => { resolvePromise = resolve; });
      pendingGroups.set(lockKey, promise);

      try {
        // Double-check (another call might have created it while we set up lock)
        groupId = await findOrCreateGroup(key, tab.windowId);

        if (groupId) {
          await browser.tabs.group({ tabIds: tab.id, groupId });
        } else {
          // Create new group
          groupId = await browser.tabs.group({ tabIds: tab.id });

          const color = await getSmartColor(tab.windowId, tab.index);

          // Suppress rename detection for programmatic title set
          suppressRenameDetection = true;
          await browser.tabGroups.update(groupId, {
            title: getDisplayName(key),
            color: color,
            collapsed: false
          });
          suppressRenameDetection = false;

          // Cache the new group
          groupCache.set(lockKey, groupId);
          groupIdToKey.set(groupId, key);
        }
      } finally {
        resolvePromise();
        // Keep the lock for a short time to catch rapid successive calls
        setTimeout(() => pendingGroups.delete(lockKey), 300);
      }
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

  const tabs = await browser.tabs.query({ windowId });
  const tabsByKey = new Map();

  for (const tab of tabs) {
    if (tab.pinned || !tab.url) continue;

    // Skip tabs that are still loading - they'll be grouped when they finish
    if (tab.status === 'loading' && (!tab.url || tab.url === 'about:blank' || tab.url.startsWith('about:'))) {
      continue;
    }

    if (!force && tab.groupId !== browser.tabGroups.TAB_GROUP_ID_NONE) {
      continue;
    }

    const key = getGroupingKey(tab.url);
    if (!key) continue;

    if (!tabsByKey.has(key)) {
      tabsByKey.set(key, []);
    }
    tabsByKey.get(key).push(tab);
  }

  for (const [key, keyTabs] of tabsByKey) {
    if (keyTabs.length === 0) continue;

    try {
      const tabIds = keyTabs.map(t => t.id);
      let groupId = await findOrCreateGroup(key, windowId);

      if (groupId) {
        await browser.tabs.group({ tabIds, groupId });
      } else {
        groupId = await browser.tabs.group({ tabIds });

        const firstTabIndex = keyTabs[0].index;
        const color = await getSmartColor(windowId, firstTabIndex);

        // Suppress rename detection for programmatic title set
        suppressRenameDetection = true;
        await browser.tabGroups.update(groupId, {
          title: getDisplayName(key),
          color: color,
          collapsed: settings.collapseGroups
        });
        suppressRenameDetection = false;

        const cacheKey = `${windowId}-${key}`;
        groupCache.set(cacheKey, groupId);
        groupIdToKey.set(groupId, key);
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
  const windows = await browser.windows.getAll({ windowTypes: ['normal'] });
  for (const window of windows) {
    await groupAllTabsInWindow(window.id, force);
  }
}

/**
 * Ungroup all tabs in all windows
 */
async function ungroupAllTabs() {
  const tabs = await browser.tabs.query({});
  const groupedTabs = tabs.filter(t => t.groupId !== browser.tabGroups.TAB_GROUP_ID_NONE);

  if (groupedTabs.length > 0) {
    await browser.tabs.ungroup(groupedTabs.map(t => t.id));
  }

  groupCache.clear();
  groupIdToKey.clear();
}

/**
 * Update color of a group if it conflicts with adjacent groups
 * @param {number} groupId - The group ID to check
 * @param {number} windowId - The window ID
 */
async function updateGroupColorIfNeeded(groupId, windowId) {
  try {
    const groups = await browser.tabGroups.query({ windowId });
    const tabs = await browser.tabs.query({ windowId });

    const groupPositions = [];
    for (const group of groups) {
      const firstTab = tabs.find(t => t.groupId === group.id);
      if (firstTab) {
        groupPositions.push({ group, index: firstTab.index });
      }
    }
    groupPositions.sort((a, b) => a.index - b.index);

    const movedIndex = groupPositions.findIndex(gp => gp.group.id === groupId);
    if (movedIndex === -1) return;

    const movedGroup = groupPositions[movedIndex].group;
    const prevGroup = movedIndex > 0 ? groupPositions[movedIndex - 1].group : null;
    const nextGroup = movedIndex < groupPositions.length - 1 ? groupPositions[movedIndex + 1].group : null;

    const hasConflict =
      (prevGroup && prevGroup.color === movedGroup.color) ||
      (nextGroup && nextGroup.color === movedGroup.color);

    if (hasConflict) {
      const usedColors = [prevGroup?.color, nextGroup?.color].filter(Boolean);
      const availableColors = GROUP_COLORS.filter(c => !usedColors.includes(c));

      if (availableColors.length > 0) {
        const newColor = availableColors[Math.floor(Math.random() * availableColors.length)];
        await browser.tabGroups.update(groupId, { color: newColor });
      }
    }
  } catch (e) {
    console.error('Error updating group color:', e);
  }
}

// Event Listeners

// Tab created - always move to correct group based on URL
browser.tabs.onCreated.addListener((tab) => {
  setTimeout(() => {
    browser.tabs.get(tab.id).then((t) => groupTab(t, true)).catch(() => {});
  }, 100);
});

// Tab updated (URL changed) - always move to correct group based on new URL
browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url) {
    groupTab(tab, true);
  }
});

// Tab attached to window - always move to correct group
browser.tabs.onAttached.addListener((tabId, attachInfo) => {
  browser.tabs.get(tabId).then((t) => groupTab(t, true)).catch(() => {});
});

// Group removed - clean up cache
browser.tabGroups.onRemoved.addListener((group) => {
  for (const [key, id] of groupCache) {
    if (id === group.id) {
      groupCache.delete(key);
      break;
    }
  }
  groupIdToKey.delete(group.id);
});

// Debounce timer for group moves
let groupMoveTimeout = null;

// Tab moved - check if group colors need updating
browser.tabs.onMoved.addListener((tabId, moveInfo) => {
  clearTimeout(groupMoveTimeout);
  groupMoveTimeout = setTimeout(async () => {
    try {
      const tab = await browser.tabs.get(tabId);
      if (tab.groupId !== browser.tabGroups.TAB_GROUP_ID_NONE) {
        await updateGroupColorIfNeeded(tab.groupId, tab.windowId);
      }
    } catch (e) {}
  }, 300);
});

// Flag to suppress rename detection when we're setting the title programmatically
let suppressRenameDetection = false;

// Group updated - detect user renames and check colors
browser.tabGroups.onUpdated.addListener((group) => {
  // Detect user rename: if we know the key for this group, and the title
  // is different from both the custom name and the default name, it's a rename
  if (!suppressRenameDetection && group.title !== undefined) {
    const key = groupIdToKey.get(group.id);
    if (key) {
      const defaultName = getDefaultDisplayName(key);
      const currentCustom = customNames[key];
      const expectedName = currentCustom || defaultName;

      // If the title changed to something different, the user renamed it
      if (group.title !== expectedName && group.title !== defaultName) {
        customNames[key] = group.title;
        saveCustomNames();
        console.log(`Custom name saved: "${key}" → "${group.title}"`);
      }
      // If the user renamed it back to the default name, remove the custom name
      else if (group.title === defaultName && currentCustom) {
        delete customNames[key];
        saveCustomNames();
        console.log(`Custom name cleared for "${key}" (reverted to default)`);
      }
    }
  }

  // Debounce color check to avoid rapid updates
  clearTimeout(groupMoveTimeout);
  groupMoveTimeout = setTimeout(() => {
    updateGroupColorIfNeeded(group.id, group.windowId);
  }, 300);
});

// Listen for messages from popup
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'getSettings') {
    sendResponse(settings);
  } else if (message.action === 'saveSettings') {
    saveSettings(message.settings).then(() => sendResponse({ success: true }));
    return true;
  } else if (message.action === 'groupAllTabs') {
    groupAllTabs(false).then(() => sendResponse({ success: true }));
    return true;
  } else if (message.action === 'forceGroupAllTabs') {
    groupAllTabs(true).then(() => sendResponse({ success: true }));
    return true;
  } else if (message.action === 'ungroupAllTabs') {
    ungroupAllTabs().then(() => sendResponse({ success: true }));
    return true;
  } else if (message.action === 'getCustomNames') {
    sendResponse(customNames);
  } else if (message.action === 'resetCustomNames') {
    resetCustomNames().then(() => sendResponse({ success: true }));
    return true;
  }
});

// Handle first install - wait for tabs to fully load before grouping
browser.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('Tab Grouper by Subdomain (Firefox) installed - waiting for tabs to load...');
    // Wait longer on first install for all tabs to have their final URLs
    setTimeout(async () => {
      await loadSettings();
      if (settings.autoGroup) {
        console.log('Grouping existing tabs...');
        await groupAllTabs();
      }
    }, 2000); // 2 second delay for tabs to fully load
  }
});

// Initialize on startup (not first install)
loadSettings().then(() => {
  console.log('Tab Grouper by Subdomain (Firefox) initialized');
});
