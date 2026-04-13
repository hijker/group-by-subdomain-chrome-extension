/**
 * Popup script for Tab Grouper by Subdomain
 */

// DOM Elements
const enabledToggle = document.getElementById('enabled');
const autoGroupToggle = document.getElementById('autoGroup');
const collapseGroupsToggle = document.getElementById('collapseGroups');
const ignoreWwwToggle = document.getElementById('ignoreWww');
const capitalizeNamesToggle = document.getElementById('capitalizeNames');
const groupAllBtn = document.getElementById('groupAll');
const forceGroupBtn = document.getElementById('forceGroup');
const ungroupAllBtn = document.getElementById('ungroupAll');
const resetNamesBtn = document.getElementById('resetNames');
const customNamesCountEl = document.getElementById('customNamesCount');
const customNamesListEl = document.getElementById('customNamesList');
const statusEl = document.getElementById('status');

/**
 * Show status message
 * @param {string} message - The message to show
 * @param {string} type - 'success' or 'info'
 */
function showStatus(message, type = 'success') {
  statusEl.textContent = message;
  statusEl.className = `status show ${type}`;

  setTimeout(() => {
    statusEl.classList.remove('show');
  }, 2000);
}

/**
 * Load settings from background script
 */
async function loadSettings() {
  const settings = await chrome.runtime.sendMessage({ action: 'getSettings' });

  enabledToggle.checked = settings.enabled;
  autoGroupToggle.checked = settings.autoGroup;
  collapseGroupsToggle.checked = settings.collapseGroups;
  ignoreWwwToggle.checked = settings.ignoreWww;
  capitalizeNamesToggle.checked = settings.capitalizeNames || false;

  // Load custom names count
  await loadCustomNamesCount();
}

/**
 * Load and display custom names list
 */
async function loadCustomNamesCount() {
  const customNames = await chrome.runtime.sendMessage({ action: 'getCustomNames' });
  const entries = Object.entries(customNames || {});
  const count = entries.length;
  customNamesCountEl.textContent = count;
  resetNamesBtn.disabled = count === 0;

  // Render the list
  customNamesListEl.innerHTML = '';
  for (const [key, name] of entries) {
    const row = document.createElement('div');
    row.className = 'custom-name-row';

    const keySpan = document.createElement('span');
    keySpan.className = 'custom-name-key';
    keySpan.textContent = key;
    keySpan.title = key;

    const arrow = document.createElement('span');
    arrow.className = 'custom-name-arrow';
    arrow.textContent = '→';

    const valueSpan = document.createElement('span');
    valueSpan.className = 'custom-name-value';
    valueSpan.textContent = name;

    row.appendChild(keySpan);
    row.appendChild(arrow);
    row.appendChild(valueSpan);
    customNamesListEl.appendChild(row);
  }
}

/**
 * Save settings to background script
 */
async function saveSettings() {
  const settings = {
    enabled: enabledToggle.checked,
    autoGroup: autoGroupToggle.checked,
    collapseGroups: collapseGroupsToggle.checked,
    ignoreWww: ignoreWwwToggle.checked,
    capitalizeNames: capitalizeNamesToggle.checked
  };

  await chrome.runtime.sendMessage({ action: 'saveSettings', settings });
  showStatus('Settings saved!', 'success');
}

// Event Listeners

// Toggle changes
enabledToggle.addEventListener('change', saveSettings);
autoGroupToggle.addEventListener('change', saveSettings);
collapseGroupsToggle.addEventListener('change', saveSettings);
ignoreWwwToggle.addEventListener('change', saveSettings);
capitalizeNamesToggle.addEventListener('change', saveSettings);

// Group new tabs button (respects existing groups)
groupAllBtn.addEventListener('click', async () => {
  groupAllBtn.disabled = true;
  groupAllBtn.textContent = 'Grouping...';

  try {
    await chrome.runtime.sendMessage({ action: 'groupAllTabs' });
    showStatus('Ungrouped tabs organized!', 'success');
  } catch (e) {
    showStatus('Error grouping tabs', 'info');
  }

  groupAllBtn.disabled = false;
  groupAllBtn.textContent = 'Group New';
});

// Force regroup all tabs button (overrides existing groups)
forceGroupBtn.addEventListener('click', async () => {
  forceGroupBtn.disabled = true;
  forceGroupBtn.textContent = 'Regrouping...';

  try {
    await chrome.runtime.sendMessage({ action: 'forceGroupAllTabs' });
    showStatus('All tabs regrouped!', 'success');
  } catch (e) {
    showStatus('Error regrouping tabs', 'info');
  }

  forceGroupBtn.disabled = false;
  forceGroupBtn.textContent = 'Regroup All';
});

// Ungroup all tabs button
ungroupAllBtn.addEventListener('click', async () => {
  ungroupAllBtn.disabled = true;
  ungroupAllBtn.textContent = 'Ungrouping...';

  try {
    await chrome.runtime.sendMessage({ action: 'ungroupAllTabs' });
    showStatus('All tabs ungrouped!', 'success');
  } catch (e) {
    showStatus('Error ungrouping tabs', 'info');
  }

  ungroupAllBtn.disabled = false;
  ungroupAllBtn.textContent = 'Ungroup';
});

// Reset custom names button
resetNamesBtn.addEventListener('click', async () => {
  resetNamesBtn.disabled = true;
  resetNamesBtn.textContent = 'Resetting...';

  try {
    await chrome.runtime.sendMessage({ action: 'resetCustomNames' });
    customNamesCountEl.textContent = '0';
    customNamesListEl.innerHTML = '';
    showStatus('Custom names cleared!', 'success');
  } catch (e) {
    showStatus('Error resetting names', 'info');
  }

  resetNamesBtn.disabled = false;
  resetNamesBtn.textContent = 'Reset Custom Names';
});

// Initialize
loadSettings();
