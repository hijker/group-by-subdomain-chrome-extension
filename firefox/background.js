/**
 * Tab Grouper by Subdomain - Firefox Version
 * Groups tabs by domain and subdomain with sidebar view
 */

// Color palette for groups (CSS colors for sidebar display)
const GROUP_COLORS = [
  '#4285f4', // blue
  '#ea4335', // red
  '#fbbc04', // yellow
  '#34a853', // green
  '#ff6d91', // pink
  '#9334e6', // purple
  '#00bcd4', // cyan
  '#ff9800', // orange
  '#9e9e9e'  // grey
];

// Settings with defaults
let settings = {
  enabled: true,
  ignoreWww: true,
  sortByDomain: true,
  showTabCount: true
};

// Color assignments for groups (persisted)
let groupColors = {};

// Load settings from storage
async function loadSettings() {
  try {
    const stored = await browser.storage.sync.get(['settings', 'groupColors']);
    if (stored.settings) {
      settings = { ...settings, ...stored.settings };
    }
    if (stored.groupColors) {
      groupColors = stored.groupColors;
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

// Save group colors
async function saveGroupColors() {
  await browser.storage.sync.set({ groupColors });
}

/**
 * Extract the grouping key from a URL
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
    return null;
  }
}

/**
 * Get display name for a group
 * @param {string} key - The grouping key
 * @returns {string} - Display name
 */
function getDisplayName(key) {
  if (/^\d+\.\d+\.\d+\.\d+$/.test(key) || key === 'localhost') {
    return key;
  }
  const parts = key.split('.');
  return parts[0];
}

/**
 * Get color for a group (assigns new color if needed)
 * @param {string} key - The grouping key
 * @param {Array} existingColors - Colors already used by adjacent groups
 * @returns {string} - Color hex value
 */
function getGroupColor(key, existingColors = []) {
  if (groupColors[key]) {
    return groupColors[key];
  }

  // Find a color not used by neighbors
  const availableColors = GROUP_COLORS.filter(c => !existingColors.includes(c));
  const color = availableColors.length > 0
    ? availableColors[Math.floor(Math.random() * availableColors.length)]
    : GROUP_COLORS[Math.floor(Math.random() * GROUP_COLORS.length)];

  groupColors[key] = color;
  saveGroupColors();
  return color;
}

/**
 * Get all tabs grouped by domain/subdomain
 * @param {number} windowId - Optional window ID (current window if not specified)
 * @returns {Promise<Object>} - Groups object with tabs
 */
async function getGroupedTabs(windowId = null) {
  const queryOptions = windowId ? { windowId } : { currentWindow: true };
  const tabs = await browser.tabs.query(queryOptions);

  const groups = {};
  const groupOrder = [];

  for (const tab of tabs) {
    if (tab.pinned) continue;

    const key = getGroupingKey(tab.url);
    if (!key) continue;

    if (!groups[key]) {
      groups[key] = {
        key,
        name: getDisplayName(key),
        tabs: [],
        color: null // Will be assigned later
      };
      groupOrder.push(key);
    }

    groups[key].tabs.push({
      id: tab.id,
      title: tab.title,
      url: tab.url,
      favIconUrl: tab.favIconUrl,
      active: tab.active
    });
  }

  // Assign colors avoiding adjacent conflicts
  let prevColor = null;
  for (const key of groupOrder) {
    const existingColors = prevColor ? [prevColor] : [];
    groups[key].color = getGroupColor(key, existingColors);
    prevColor = groups[key].color;
  }

  // Sort groups if enabled
  if (settings.sortByDomain) {
    const sortedKeys = Object.keys(groups).sort((a, b) => {
      return getDisplayName(a).localeCompare(getDisplayName(b));
    });
    const sortedGroups = {};
    for (const key of sortedKeys) {
      sortedGroups[key] = groups[key];
    }
    return sortedGroups;
  }

  return groups;
}

/**
 * Focus a specific tab
 * @param {number} tabId - Tab ID to focus
 */
async function focusTab(tabId) {
  try {
    const tab = await browser.tabs.get(tabId);
    await browser.tabs.update(tabId, { active: true });
    await browser.windows.update(tab.windowId, { focused: true });
  } catch (e) {
    console.error('Error focusing tab:', e);
  }
}

/**
 * Close all tabs in a group except active
 * @param {string} groupKey - The group key
 */
async function closeGroupTabs(groupKey) {
  const groups = await getGroupedTabs();
  const group = groups[groupKey];
  if (!group) return;

  const tabIds = group.tabs
    .filter(t => !t.active)
    .map(t => t.id);

  if (tabIds.length > 0) {
    await browser.tabs.remove(tabIds);
  }
}

/**
 * Close all tabs in a group
 * @param {string} groupKey - The group key
 */
async function closeAllGroupTabs(groupKey) {
  const groups = await getGroupedTabs();
  const group = groups[groupKey];
  if (!group) return;

  const tabIds = group.tabs.map(t => t.id);
  if (tabIds.length > 0) {
    await browser.tabs.remove(tabIds);
  }
}

/**
 * Move all tabs from a group together
 * @param {string} groupKey - The group key
 */
async function consolidateGroup(groupKey) {
  const groups = await getGroupedTabs();
  const group = groups[groupKey];
  if (!group || group.tabs.length < 2) return;

  // Get the first tab's index as target
  const firstTab = await browser.tabs.get(group.tabs[0].id);
  let targetIndex = firstTab.index;

  // Move all other tabs next to the first one
  for (let i = 1; i < group.tabs.length; i++) {
    targetIndex++;
    await browser.tabs.move(group.tabs[i].id, { index: targetIndex });
  }
}

// Message listener for sidebar and popup
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.action) {
    case 'getGroupedTabs':
      getGroupedTabs().then(sendResponse);
      return true;

    case 'getSettings':
      sendResponse(settings);
      return false;

    case 'saveSettings':
      saveSettings(message.settings).then(() => sendResponse({ success: true }));
      return true;

    case 'focusTab':
      focusTab(message.tabId).then(() => sendResponse({ success: true }));
      return true;

    case 'closeGroupTabs':
      closeGroupTabs(message.groupKey).then(() => sendResponse({ success: true }));
      return true;

    case 'closeAllGroupTabs':
      closeAllGroupTabs(message.groupKey).then(() => sendResponse({ success: true }));
      return true;

    case 'consolidateGroup':
      consolidateGroup(message.groupKey).then(() => sendResponse({ success: true }));
      return true;

    case 'setGroupColor':
      groupColors[message.groupKey] = message.color;
      saveGroupColors().then(() => sendResponse({ success: true }));
      return true;
  }
});

// Notify sidebar when tabs change
function notifyTabsChanged() {
  browser.runtime.sendMessage({ action: 'tabsChanged' }).catch(() => {});
}

browser.tabs.onCreated.addListener(notifyTabsChanged);
browser.tabs.onRemoved.addListener(notifyTabsChanged);
browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url || changeInfo.title) {
    notifyTabsChanged();
  }
});
browser.tabs.onMoved.addListener(notifyTabsChanged);
browser.tabs.onActivated.addListener(notifyTabsChanged);

// Initialize
loadSettings().then(() => {
  console.log('Tab Grouper by Subdomain (Firefox) initialized');
});
