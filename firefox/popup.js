/**
 * Popup script for Tab Grouper by Subdomain (Firefox)
 */

// DOM Elements
const ignoreWwwToggle = document.getElementById('ignoreWww');
const sortByDomainToggle = document.getElementById('sortByDomain');
const showTabCountToggle = document.getElementById('showTabCount');
const openSidebarBtn = document.getElementById('openSidebar');
const sidebarLink = document.getElementById('sidebarLink');
const statusEl = document.getElementById('status');

/**
 * Show status message
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

  ignoreWwwToggle.checked = settings.ignoreWww;
  sortByDomainToggle.checked = settings.sortByDomain;
  showTabCountToggle.checked = settings.showTabCount;
}

/**
 * Save settings to background script
 */
async function saveSettings() {
  const settings = {
    ignoreWww: ignoreWwwToggle.checked,
    sortByDomain: sortByDomainToggle.checked,
    showTabCount: showTabCountToggle.checked
  };

  await browser.runtime.sendMessage({ action: 'saveSettings', settings });
  showStatus('Settings saved!', 'success');
}

// Event Listeners

// Toggle changes
ignoreWwwToggle.addEventListener('change', saveSettings);
sortByDomainToggle.addEventListener('change', saveSettings);
showTabCountToggle.addEventListener('change', saveSettings);

// Open sidebar button
openSidebarBtn.addEventListener('click', () => {
  browser.sidebarAction.open();
  window.close();
});

// Sidebar link
sidebarLink.addEventListener('click', (e) => {
  e.preventDefault();
  browser.sidebarAction.open();
  window.close();
});

// Initialize
loadSettings();
