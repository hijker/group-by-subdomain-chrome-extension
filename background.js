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
 * Returns subdomain.domain or just domain if no subdomain
 * @param {string} url - The tab URL
 * @returns {string|null} - The grouping key or null for invalid URLs
 */
function getGroupingKey(url) {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname;

    // Skip chrome:// and other special URLs
    if (!hostname || urlObj.protocol === 'chrome:' || urlObj.protocol === 'chrome-extension:' || urlObj.protocol === 'about:') {
      return null;
    }

    const parts = hostname.split('.');

    // Handle IP addresses - group by full IP
    if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
      return hostname;
    }

    // Handle localhost
    if (hostname === 'localhost') {
      return 'localhost';
    }

    // Need at least domain.tld
    if (parts.length < 2) {
      return hostname;
    }

    // Common TLDs that have two parts (co.uk, com.au, etc.)
    const twoPartTlds = ['co.uk', 'com.au', 'co.nz', 'co.jp', 'com.br', 'co.in', 'org.uk', 'net.au'];
    const lastTwo = parts.slice(-2).join('.');
    const isTwoPartTld = twoPartTlds.includes(lastTwo);

    let domain, subdomain;

    if (isTwoPartTld && parts.length >= 3) {
      // For two-part TLDs like co.uk: subdomain.domain.co.uk
      domain = parts.slice(-3).join('.');
      subdomain = parts.length > 3 ? parts[parts.length - 4] : null;
    } else {
      // Standard TLDs: subdomain.domain.tld
      domain = parts.slice(-2).join('.');
      subdomain = parts.length > 2 ? parts[parts.length - 3] : null;
    }

    // Handle www prefix based on settings
    if (settings.ignoreWww && subdomain === 'www') {
      subdomain = null;
    }

    // Return subdomain.domain if subdomain exists, otherwise just domain
    if (subdomain) {
      return `${subdomain}.${domain}`;
    }

    return domain;
  } catch (e) {
    console.error('Error parsing URL:', url, e);
    return null;
  }
}

/**
 * Get display name for a group (clean format)
 * @param {string} key - The grouping key
 * @returns {string} - Display name for the group
 */
function getDisplayName(key) {
  // Capitalize first letter and clean up
  return key.charAt(0).toUpperCase() + key.slice(1);
}

/**
 * Get the next color for a new group
 * @returns {string} - Color name
 */
function getNextColor() {
  const color = GROUP_COLORS[colorIndex % GROUP_COLORS.length];
  colorIndex++;
  return color;
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
 */
async function groupTab(tab) {
  if (!settings.enabled || !settings.autoGroup) return;
  if (!tab.url || tab.pinned) return;

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

      // Update group properties
      await chrome.tabGroups.update(groupId, {
        title: getDisplayName(key),
        color: getNextColor(),
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
 */
async function groupAllTabsInWindow(windowId) {
  if (!settings.enabled) return;

  const tabs = await chrome.tabs.query({ windowId });
  const tabsByKey = new Map();

  // Group tabs by their key
  for (const tab of tabs) {
    if (tab.pinned || !tab.url) continue;

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

        await chrome.tabGroups.update(groupId, {
          title: getDisplayName(key),
          color: getNextColor(),
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
 */
async function groupAllTabs() {
  const windows = await chrome.windows.getAll({ windowTypes: ['normal'] });
  for (const window of windows) {
    await groupAllTabsInWindow(window.id);
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

// Tab created
chrome.tabs.onCreated.addListener((tab) => {
  // Wait a bit for the URL to be set
  setTimeout(() => {
    chrome.tabs.get(tab.id).then(groupTab).catch(() => {});
  }, 100);
});

// Tab updated (URL changed)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url) {
    groupTab(tab);
  }
});

// Tab attached to window
chrome.tabs.onAttached.addListener((tabId, attachInfo) => {
  chrome.tabs.get(tabId).then(groupTab).catch(() => {});
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

// Listen for messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'getSettings') {
    sendResponse(settings);
  } else if (message.action === 'saveSettings') {
    saveSettings(message.settings).then(() => sendResponse({ success: true }));
    return true; // Async response
  } else if (message.action === 'groupAllTabs') {
    groupAllTabs().then(() => sendResponse({ success: true }));
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
