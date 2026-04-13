/**
 * Popup script for Tab Grouper by Subdomain (Firefox)
 */

// DOM Elements
const enabledToggle = document.getElementById('enabled');
const autoGroupToggle = document.getElementById('autoGroup');
const collapseGroupsToggle = document.getElementById('collapseGroups');
const ignoreWwwToggle = document.getElementById('ignoreWww');
const groupAllBtn = document.getElementById('groupAll');
const forceGroupBtn = document.getElementById('forceGroup');
const ungroupAllBtn = document.getElementById('ungroupAll');
const resetNamesBtn = document.getElementById('resetNames');
const customNamesCountEl = document.getElementById('customNamesCount');
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
  const settings = await browser.runtime.sendMessage({ action: 'getSettings' });

  enabledToggle.checked = settings.enabled;
  autoGroupToggle.checked = settings.autoGroup;
  collapseGroupsToggle.checked = settings.collapseGroups;
  ignoreWwwToggle.checked = settings.ignoreWww;

  // Load custom names count
  await loadCustomNamesCount();
}

/**
 * Load and display the count of custom names
 */
async function loadCustomNamesCount() {
  const customNames = await browser.runtime.sendMessage({ action: 'getCustomNames' });
  const count = Object.keys(customNames || {}).length;
  customNamesCountEl.textContent = count;
  resetNamesBtn.disabled = count === 0;
}

/**
 * Save settings to background script
 */
async function saveSettings() {
  const settings = {
    enabled: enabledToggle.checked,
    autoGroup: autoGroupToggle.checked,
    collapseGroups: collapseGroupsToggle.checked,
    ignoreWww: ignoreWwwToggle.checked
  };

  await browser.runtime.sendMessage({ action: 'saveSettings', settings });
  showStatus('Settings saved!', 'success');
}

// Event Listeners

// Toggle changes
enabledToggle.addEventListener('change', saveSettings);
autoGroupToggle.addEventListener('change', saveSettings);
collapseGroupsToggle.addEventListener('change', saveSettings);
ignoreWwwToggle.addEventListener('change', saveSettings);

// Group new tabs button (respects existing groups)
groupAllBtn.addEventListener('click', async () => {
  groupAllBtn.disabled = true;
  groupAllBtn.textContent = 'Grouping...';

  try {
    await browser.runtime.sendMessage({ action: 'groupAllTabs' });
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
    await browser.runtime.sendMessage({ action: 'forceGroupAllTabs' });
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
    await browser.runtime.sendMessage({ action: 'ungroupAllTabs' });
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
    await browser.runtime.sendMessage({ action: 'resetCustomNames' });
    customNamesCountEl.textContent = '0';
    showStatus('Custom names cleared!', 'success');
  } catch (e) {
    showStatus('Error resetting names', 'info');
  }

  resetNamesBtn.disabled = false;
  resetNamesBtn.textContent = 'Reset Custom Names';
});

// Initialize
loadSettings();
