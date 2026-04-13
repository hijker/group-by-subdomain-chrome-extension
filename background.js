/**
 * Tab Grouper by Subdomain
 * Automatically groups tabs by domain and subdomain (up to 1 level)
 */

// Store for group IDs mapped to subdomain keys
const groupCache = new Map();

// Reverse lookup: groupId -> grouping key (to detect renames)
const groupIdToKey = new Map();

// Lock mechanism to prevent race conditions when creating groups
const pendingGroups = new Map(); // key -> Promise

// Color palette for tab groups
const GROUP_COLORS = ['blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange', 'grey'];
let colorIndex = 0;

// Custom names: grouping key -> user-defined name
let customNames = {};

// Settings with defaults
let settings = {
  enabled: true,
  autoGroup: true,
  collapseGroups: false,
  ignoreWww: true,
  capitalizeNames: false
};

// Load settings and custom names from storage
async function loadSettings() {
  const stored = await chrome.storage.sync.get(['settings', 'customNames']);
  if (stored.settings) {
    settings = { ...settings, ...stored.settings };
  }
  if (stored.customNames) {
    customNames = stored.customNames;
  }
}

// Save settings to storage
async function saveSettings(newSettings) {
  settings = { ...settings, ...newSettings };
  await chrome.storage.sync.set({ settings });
}

// Save custom names to storage
async function saveCustomNames() {
  await chrome.storage.sync.set({ customNames });
}

// Reset all custom names
async function resetCustomNames() {
  customNames = {};
  await chrome.storage.sync.remove('customNames');
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
 * Checks custom names first, then falls back to first word of hostname
 * @param {string} key - The grouping key (e.g., "grafana.mms.company.com" or "google.com")
 * @returns {string} - Display name for the group (e.g., "grafana" or "google")
 */
function getDisplayName(key) {
  // Check if user has set a custom name for this key
  if (customNames[key]) {
    return customNames[key];
  }

  // Handle IP addresses and localhost - return as-is
  if (/^\d+\.\d+\.\d+\.\d+$/.test(key) || key === 'localhost') {
    return key;
  }

  // Return the first part (leftmost subdomain or domain name)
  const parts = key.split('.');
  const name = parts[0];
  return settings.capitalizeNames ? name.charAt(0).toUpperCase() + name.slice(1) : name;
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
      groupIdToKey.set(groupId, key);
      return groupId;
    } catch (e) {
      // Group no longer exists, remove from cache
      groupCache.delete(cacheKey);
      groupIdToKey.delete(groupId);
    }
  }

  // Look for existing group with matching title (check both custom and default names)
  const groups = await chrome.tabGroups.query({ windowId });
  const displayName = getDisplayName(key);
  const defaultName = getDefaultDisplayName(key);

  for (const group of groups) {
    if (group.title === displayName || group.title === defaultName) {
      groupCache.set(cacheKey, group.id);
      groupIdToKey.set(group.id, key);
      return group.id;
    }
  }

  // No existing group found, will need to create one
  return null;
}

/**
 * Get or create a group for the given key with locking to prevent race conditions
 * @param {string} key - The grouping key
 * @param {number} windowId - The window ID
 * @param {number} tabIndex - The tab index for color selection
 * @returns {Promise<number>} - The group ID
 */
async function getOrCreateGroupWithLock(key, windowId, tabIndex) {
  const lockKey = `${windowId}-${key}`;

  // If there's already a pending operation for this key, wait for it
  if (pendingGroups.has(lockKey)) {
    await pendingGroups.get(lockKey);
    // After waiting, the group should exist - find it
    const existingGroupId = await findOrCreateGroup(key, windowId);
    if (existingGroupId) return existingGroupId;
  }

  // Check if group already exists
  let groupId = await findOrCreateGroup(key, windowId);
  if (groupId) return groupId;

  // Create a promise that others can wait on
  let resolvePromise;
  const promise = new Promise(resolve => { resolvePromise = resolve; });
  pendingGroups.set(lockKey, promise);

  try {
    // Double-check after acquiring lock (another call might have created it)
    groupId = await findOrCreateGroup(key, windowId);
    if (groupId) return groupId;

    // Create the group - we use a temporary tab approach
    // The actual tab will be added by the caller
    return null; // Signal that caller should create the group
  } finally {
    // Clean up the lock after a short delay to handle rapid successive calls
    setTimeout(() => {
      pendingGroups.delete(lockKey);
    }, 500);
    resolvePromise();
  }
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
      await chrome.tabs.group({ tabIds: tab.id, groupId });
    } else {
      // Acquire lock for creating the group
      let resolvePromise;
      const promise = new Promise(resolve => { resolvePromise = resolve; });
      pendingGroups.set(lockKey, promise);

      try {
        // Double-check (another call might have created it while we set up lock)
        groupId = await findOrCreateGroup(key, tab.windowId);

        if (groupId) {
          await chrome.tabs.group({ tabIds: tab.id, groupId });
        } else {
          // Create new group
          groupId = await chrome.tabs.group({ tabIds: tab.id });

          // Get a color that doesn't conflict with adjacent groups
          const color = await getSmartColor(tab.windowId, tab.index);

          // Update group properties (suppress rename detection for programmatic title set)
          suppressRenameDetection = true;
          await chrome.tabGroups.update(groupId, {
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

  const tabs = await chrome.tabs.query({ windowId });
  const tabsByKey = new Map();

  // Group tabs by their key
  for (const tab of tabs) {
    if (tab.pinned || !tab.url) continue;

    // Skip tabs that are still loading - they'll be grouped when they finish
    if (tab.status === 'loading' && (!tab.url || tab.url === 'about:blank' || tab.url.startsWith('chrome://'))) {
      continue;
    }

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

        // Suppress rename detection for programmatic title set
        suppressRenameDetection = true;
        await chrome.tabGroups.update(groupId, {
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
  groupIdToKey.clear();
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
  groupIdToKey.delete(group.id);
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

// Flag to suppress rename detection when we're setting the title programmatically
let suppressRenameDetection = false;

// Group updated - detect user renames and check colors
chrome.tabGroups.onUpdated.addListener((group) => {
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
  } else if (message.action === 'getCustomNames') {
    sendResponse(customNames);
  } else if (message.action === 'resetCustomNames') {
    resetCustomNames().then(() => sendResponse({ success: true }));
    return true;
  }
});

// Handle first install - wait for tabs to fully load before grouping
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('Tab Grouper by Subdomain installed - waiting for tabs to load...');
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
  console.log('Tab Grouper by Subdomain initialized');
});
