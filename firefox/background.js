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

// Track titles we set programmatically: groupId -> title
// Used to distinguish user renames from our own title updates
const programmaticTitles = new Map();

// Settings with defaults
let settings = {
  enabled: true,
  autoGroup: true,
  collapseGroups: false,
  ignoreWww: true,
  capitalizeNames: false
};

// Promise that resolves when settings are loaded - prevents race conditions on startup
let settingsReady;
const settingsReadyPromise = new Promise(resolve => { settingsReady = resolve; });

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
  settingsReady();
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
 * Get max name length based on number of groups in window
 * @param {number} groupCount - Number of groups
 * @returns {number|null} - Max characters, or null for no limit
 */
function getMaxNameLength(groupCount) {
  if (groupCount > 15) return 1;
  if (groupCount > 10) return 3;
  return null; // No limit
}

/**
 * Apply truncation to a name based on max length
 * @param {string} name - The full name
 * @param {number|null} maxLen - Max characters, or null for no limit
 * @returns {string} - Truncated name
 */
function truncateName(name, maxLen) {
  if (maxLen === null || name.length <= maxLen) return name;
  return name.substring(0, maxLen);
}

/**
 * Get display name for a group (clean format)
 * Checks custom names first, then falls back to first word of hostname
 * @param {string} key - The grouping key
 * @param {number|null} maxLen - Optional max length for truncation
 * @returns {string} - Display name for the group
 */
function getDisplayName(key, maxLen = null) {
  // Check if user has set a custom name for this key
  if (customNames[key]) {
    return truncateName(customNames[key], maxLen);
  }

  if (/^\d+\.\d+\.\d+\.\d+$/.test(key) || key === 'localhost') {
    return truncateName(key, maxLen);
  }
  const parts = key.split('.');
  const name = parts[0];
  const formatted = settings.capitalizeNames ? name.charAt(0).toUpperCase() + name.slice(1) : name;
  return truncateName(formatted, maxLen);
}

/**
 * Get the default (auto-generated) display name for a key, ignoring custom names
 * @param {string} key - The grouping key
 * @param {number|null} maxLen - Optional max length for truncation
 * @returns {string} - Default display name
 */
function getDefaultDisplayName(key, maxLen = null) {
  if (/^\d+\.\d+\.\d+\.\d+$/.test(key) || key === 'localhost') {
    return truncateName(key, maxLen);
  }
  const parts = key.split('.');
  const name = parts[0];
  const formatted = settings.capitalizeNames ? name.charAt(0).toUpperCase() + name.slice(1) : name;
  return truncateName(formatted, maxLen);
}

/**
 * Get the full (untruncated) display name for matching purposes
 * @param {string} key - The grouping key
 * @returns {string} - Full display name
 */
function getFullDisplayName(key) {
  if (customNames[key]) return customNames[key];
  if (/^\d+\.\d+\.\d+\.\d+$/.test(key) || key === 'localhost') return key;
  const parts = key.split('.');
  const name = parts[0];
  return settings.capitalizeNames ? name.charAt(0).toUpperCase() + name.slice(1) : name;
}

/**
 * Get the full (untruncated) default display name for matching purposes
 * @param {string} key - The grouping key
 * @returns {string} - Full default display name
 */
function getFullDefaultDisplayName(key) {
  if (/^\d+\.\d+\.\d+\.\d+$/.test(key) || key === 'localhost') return key;
  const parts = key.split('.');
  const name = parts[0];
  return settings.capitalizeNames ? name.charAt(0).toUpperCase() + name.slice(1) : name;
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

  // Look for existing group with matching title
  // Check all possible truncation levels (full, 3-char, 1-char) and both custom and default names
  const groups = await browser.tabGroups.query({ windowId });
  const fullDisplay = getFullDisplayName(key);
  const fullDefault = getFullDefaultDisplayName(key);
  const possibleTitles = new Set([
    fullDisplay, fullDefault,
    truncateName(fullDisplay, 3), truncateName(fullDefault, 3),
    truncateName(fullDisplay, 1), truncateName(fullDefault, 1)
  ]);

  for (const group of groups) {
    if (possibleTitles.has(group.title)) {
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
  await settingsReadyPromise; // Ensure settings & custom names are loaded
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

          // Determine truncation based on group count (including this new one)
          const allGroups = await browser.tabGroups.query({ windowId: tab.windowId });
          const maxLen = getMaxNameLength(allGroups.length);

          // Track title to avoid false rename detection
          const title = getDisplayName(key, maxLen);
          programmaticTitles.set(groupId, title);
          await browser.tabGroups.update(groupId, {
            title: title,
            color: color,
            collapsed: false
          });

          // Cache the new group
          groupCache.set(lockKey, groupId);
          groupIdToKey.set(groupId, key);

          // Check if we crossed a threshold — update all group names
          await updateGroupNamesForWindow(tab.windowId);
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
  await settingsReadyPromise; // Ensure settings & custom names are loaded
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

        // Track title to avoid false rename detection
        const title = getDisplayName(key);
        programmaticTitles.set(groupId, title);
        await browser.tabGroups.update(groupId, {
          title: title,
          color: color,
          collapsed: settings.collapseGroups
        });

        const cacheKey = `${windowId}-${key}`;
        groupCache.set(cacheKey, groupId);
        groupIdToKey.set(groupId, key);
      }
    } catch (e) {
      console.error('Error grouping tabs for key:', key, e);
    }
  }

  // After all groups created, update names based on final group count
  await updateGroupNamesForWindow(windowId);
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
 * Update all group names in a window based on current group count (for truncation)
 * Called when groups are added/removed to handle threshold crossings
 * @param {number} windowId - The window ID
 */
async function updateGroupNamesForWindow(windowId) {
  const groups = await browser.tabGroups.query({ windowId });
  const tabs = await browser.tabs.query({ windowId });
  const maxLen = getMaxNameLength(groups.length);

  for (const group of groups) {
    let key = groupIdToKey.get(group.id);
    if (!key) {
      const groupTab = tabs.find(t => t.groupId === group.id && t.url);
      if (groupTab) {
        key = getGroupingKey(groupTab.url);
        if (key) groupIdToKey.set(group.id, key);
      }
    }
    if (key) {
      const newTitle = getDisplayName(key, maxLen);
      if (group.title !== newTitle) {
        programmaticTitles.set(group.id, newTitle);
        await browser.tabGroups.update(group.id, { title: newTitle });
      }
    }
  }
}

/**
 * Refresh all existing group titles based on current settings
 * Used when capitalize setting changes
 */
async function refreshGroupNames() {
  const windows = await browser.windows.getAll({ windowTypes: ['normal'] });
  for (const win of windows) {
    await updateGroupNamesForWindow(win.id);
  }
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

// Group removed - clean up cache and update remaining group names (may expand)
browser.tabGroups.onRemoved.addListener((group) => {
  // Remove from cache
  for (const [key, id] of groupCache) {
    if (id === group.id) {
      groupCache.delete(key);
      break;
    }
  }
  groupIdToKey.delete(group.id);
  programmaticTitles.delete(group.id);

  // Update remaining group names — count dropped, names might expand
  if (group.windowId) {
    setTimeout(() => updateGroupNamesForWindow(group.windowId), 200);
  }
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

// Group updated - detect user renames and check colors
browser.tabGroups.onUpdated.addListener((group) => {
  // Detect user rename — but skip if we set this title ourselves
  if (group.title !== undefined) {
    // Check if this was a programmatic title change we made
    const programmaticTitle = programmaticTitles.get(group.id);
    if (programmaticTitle !== undefined && group.title === programmaticTitle) {
      // This is our own update, ignore it and clean up
      programmaticTitles.delete(group.id);
    } else {
      // Not our update — could be a user rename
      programmaticTitles.delete(group.id); // Clean up stale entry if any
      const key = groupIdToKey.get(group.id);
      if (key) {
        // Use full names for comparison — truncated versions are our own
        const fullDefault = getFullDefaultDisplayName(key);
        const fullDisplay = getFullDisplayName(key);
        const currentCustom = customNames[key];

        // Build set of all names we might have set (full + all truncations)
        const ourNames = new Set([
          fullDisplay, fullDefault,
          truncateName(fullDisplay, 3), truncateName(fullDefault, 3),
          truncateName(fullDisplay, 1), truncateName(fullDefault, 1)
        ]);

        // If the title is NOT one of ours, the user renamed it
        if (!ourNames.has(group.title)) {
          customNames[key] = group.title;
          saveCustomNames();
          console.log(`Custom name saved: "${key}" → "${group.title}"`);
        }
        // If the user renamed it back to the default name, remove the custom name
        else if (group.title === fullDefault && currentCustom) {
          delete customNames[key];
          saveCustomNames();
          console.log(`Custom name cleared for "${key}" (reverted to default)`);
        }
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
  } else if (message.action === 'refreshGroupNames') {
    refreshGroupNames().then(() => sendResponse({ success: true }));
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
