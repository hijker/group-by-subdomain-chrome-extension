# Tab Grouper by Subdomain (Firefox)

A Firefox extension that automatically groups tabs by domain and subdomain into Firefox's native tab groups.

![Tab Grouper Icon](icons/icon128.png)

## Requirements

- **Firefox 131+** (Tab Groups API required)

## Features

- **Automatic Tab Grouping**: Tabs are automatically grouped as you browse
- **Native Tab Groups**: Uses Firefox's built-in tab groups (visible in tab bar)
- **Smart Grouping**: Groups tabs by the full hostname
- **First Word Naming**: Group names use just the first word (subdomain or domain)
- **Smart Colors**: Adjacent groups get different colors automatically
- **Color Updates on Move**: Colors adjust when you drag groups around
- **Customizable Settings**:
  - Enable/disable extension
  - Toggle auto-grouping for new tabs
  - Collapse new groups automatically
  - Ignore "www" prefix option
- **Manual Controls**: Group all tabs, regroup, or ungroup with one click

## How It Works

| URL | Group Name |
|-----|------------|
| `mail.google.com` | mail |
| `drive.google.com` | drive |
| `grafana.mms.company.com` | grafana |
| `prometheus.mms.company.com` | prometheus |
| `github.com` | github |
| `www.example.com` | example |

## Installation

### Temporary Installation (Development)

1. Open Firefox and navigate to `about:debugging`
2. Click "This Firefox" in the left sidebar
3. Click "Load Temporary Add-on..."
4. Navigate to the `firefox` folder and select `manifest.json`
5. The extension will be loaded (until Firefox restarts)

### Permanent Installation

1. Package the extension:
   ```bash
   cd firefox
   zip -r tab-grouper-firefox.xpi *
   ```

2. Submit to [Firefox Add-ons](https://addons.mozilla.org/) for signing

## Usage

### Automatic Grouping

Once installed, the extension automatically:
- Groups new tabs based on their URL
- Moves tabs to the correct group when URL changes
- Assigns non-conflicting colors to adjacent groups

### Popup Controls

Click the extension icon to access:

**Settings:**
- **Enable Extension**: Turn tab grouping on/off
- **Auto-group New Tabs**: Automatically group tabs as they open
- **Collapse New Groups**: Start new groups in collapsed state
- **Ignore "www" Prefix**: Treat www.site.com same as site.com

**Actions:**
- **Group New**: Groups only ungrouped tabs (respects existing groups)
- **Regroup All**: Forces all tabs to be regrouped by subdomain
- **Ungroup**: Removes all tab groups

## File Structure

```
firefox/
├── manifest.json       # Firefox extension manifest (v2)
├── background.js       # Background script (tab grouping logic)
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
- `tabGroups`: Create and manage Firefox tab groups
- `storage`: Save settings

## Browser Compatibility

- **Firefox 131+**: ✅ Full support (native tab groups)
- **Firefox < 131**: ❌ Not supported (no tab groups API)
- **Firefox ESR**: ❌ Not supported (ESR is behind on features)

## Differences from Chrome Version

The Firefox version is functionally identical to the Chrome version, both using native tab groups APIs.

| Feature | Chrome | Firefox |
|---------|--------|---------|
| Native Tab Groups | ✅ | ✅ (131+) |
| Auto-grouping | ✅ | ✅ |
| Smart Colors | ✅ | ✅ |
| Respects Existing Groups | ✅ | ✅ |

## License

MIT License - feel free to use, modify, and distribute this extension.

---

Made with ❤️ for Firefox users who want organized tabs
