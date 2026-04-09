# Tab Grouper by Subdomain (Firefox)

A Firefox extension that groups tabs by domain and subdomain in a sidebar view. This is the Firefox alternative to Chrome's native tab groups feature.

![Tab Grouper Icon](icons/icon128.png)

## Features

- **Sidebar Tab Groups View**: Visual representation of tabs grouped by domain/subdomain
- **Smart Grouping**: Automatically groups tabs by hostname
- **Color-coded Groups**: Each group gets a unique color (avoids adjacent conflicts)
- **Collapsible Groups**: Click to expand/collapse tab groups
- **Quick Actions**:
  - Click a tab to switch to it
  - Close individual tabs
  - Move all tabs from a group together
  - Close all tabs in a group
- **Settings**:
  - Ignore "www" prefix
  - Sort groups alphabetically
  - Show tab count badges

## How It Works

Since Firefox doesn't have native tab groups like Chrome, this extension provides a **sidebar panel** that displays your tabs organized by domain/subdomain:

| URL | Group Name |
|-----|------------|
| `mail.google.com` | mail |
| `drive.google.com` | drive |
| `grafana.mms.company.com` | grafana |
| `github.com` | github |

## Installation

### Temporary Installation (Development)

1. Open Firefox and navigate to `about:debugging`
2. Click "This Firefox" in the left sidebar
3. Click "Load Temporary Add-on..."
4. Navigate to the `firefox` folder and select `manifest.json`
5. The extension will be loaded temporarily (until Firefox restarts)

### Permanent Installation

1. Package the extension:
   ```bash
   cd firefox
   zip -r tab-grouper-firefox.xpi *
   ```

2. For personal use:
   - Go to `about:addons`
   - Click the gear icon → "Install Add-on From File..."
   - Select the `.xpi` file

3. For distribution:
   - Submit to [Firefox Add-ons](https://addons.mozilla.org/)

## Usage

### Opening the Sidebar

1. **Click the extension icon** in the toolbar and click "Open Tab Groups Sidebar"
2. **Or** use keyboard shortcut: `Ctrl+Shift+Y` (customizable in Firefox settings)
3. **Or** go to View → Sidebar → Tab Groups

### Sidebar Controls

- **Click group header**: Expand/collapse the group
- **Click tab**: Switch to that tab
- **× button on tab**: Close the tab
- **⊞ button**: Move all tabs in the group together
- **⋯ button**: More options (close others, close all)
- **Collapse All / Expand All**: Header buttons to control all groups

### Settings (via popup)

Click the extension icon to access settings:
- **Ignore "www" Prefix**: Treat `www.site.com` same as `site.com`
- **Sort by Domain**: Alphabetically sort groups
- **Show Tab Count**: Display number of tabs per group

## File Structure

```
firefox/
├── manifest.json       # Firefox extension manifest (v2)
├── background.js       # Background script for tab management
├── sidebar.html        # Sidebar panel UI
├── sidebar.js          # Sidebar functionality
├── popup.html          # Settings popup UI
├── popup.js            # Popup functionality
├── icons/
│   ├── icon16.png
│   ├── icon32.png
│   ├── icon48.png
│   └── icon128.png
└── README.md
```

## Permissions

- `tabs`: Access tab information for grouping
- `storage`: Save settings and group colors

## Differences from Chrome Version

| Feature | Chrome | Firefox |
|---------|--------|---------|
| Native Tab Groups | ✅ Yes | ❌ No |
| Implementation | Uses `chrome.tabGroups` API | Sidebar-based view |
| Auto-grouping | Automatic | Manual via sidebar |
| Visual Groups in Tab Bar | ✅ Yes | ❌ No (sidebar only) |
| Group Actions | Native | Via sidebar context menu |

## Keyboard Shortcuts

You can customize keyboard shortcuts in Firefox:
1. Go to `about:addons`
2. Click the gear icon → "Manage Extension Shortcuts"
3. Find "Tab Grouper by Subdomain" and set your preferred shortcuts

## Browser Compatibility

- **Firefox**: ✅ Fully supported (91+)
- **Firefox ESR**: ✅ Should work
- **Firefox Developer Edition**: ✅ Supported
- **Firefox Nightly**: ✅ Supported

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT License - feel free to use, modify, and distribute this extension.

---

Made with ❤️ for Firefox users who want organized tabs
