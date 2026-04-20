# Tab Grouper by Subdomain

Published on mozilla : 
https://addons.mozilla.org/en-US/firefox/addon/tab-grouper-by-subdomain/

A Chrome extension that automatically groups tabs by domain and subdomain (up to 1 level) into Chrome's native tab groups.

![Tab Grouper Icon](icons/icon128.png)

## Features

- **Automatic Tab Grouping**: Tabs are automatically grouped as you browse
- **Subdomain Awareness**: Groups tabs by subdomain.domain (e.g., `mail.google.com` and `drive.google.com` get separate groups)
- **Smart Grouping**: Handles various URL formats including:
  - Standard domains (google.com, github.com)
  - Subdomains (docs.google.com, api.github.com)
  - Two-part TLDs (co.uk, com.au)
  - IP addresses and localhost
- **Customizable Settings**:
  - Enable/disable extension
  - Toggle auto-grouping for new tabs
  - Collapse new groups automatically
  - Ignore "www" prefix option
- **Manual Controls**: Group all tabs or ungroup all tabs with one click
- **Color-coded Groups**: Each domain gets a unique color from Chrome's color palette

## How It Works

The extension analyzes each tab's URL and groups by the full hostname. Group names use just the first word (leftmost subdomain or domain name):

| URL | Group Name |
|-----|------------|
| `https://mail.google.com/inbox` | mail |
| `https://drive.google.com/files` | drive |
| `https://grafana.mms.company.com` | grafana |
| `https://prometheus.mms.company.com` | prometheus |
| `https://www.github.com/user/repo` | github |
| `https://api.github.com/users` | api |
| `https://example.co.uk/page` | example |
| `https://192.168.1.1/admin` | 192.168.1.1 |

**Note:** Multi-level subdomains like `grafana.mms.company.com` and `prometheus.mms.company.com` are grouped separately, each named by their first word.

## Installation

### From Source (Developer Mode)

1. **Download or clone this repository**
   ```bash
   git clone https://github.com/your-username/group-by-subdomain.git
   ```

2. **Open Chrome Extensions page**
   - Navigate to `chrome://extensions/`
   - Or click Menu (⋮) → More Tools → Extensions

3. **Enable Developer Mode**
   - Toggle the "Developer mode" switch in the top-right corner

4. **Load the extension**
   - Click "Load unpacked"
   - Select the `group-by-subdomain` folder
   - The extension should now appear in your toolbar

### Files Structure

```
group-by-subdomain/
├── manifest.json       # Extension configuration
├── background.js       # Service worker (tab grouping logic)
├── popup.html          # Settings popup UI
├── popup.js            # Popup script
├── icons/
│   ├── icon16.png
│   ├── icon32.png
│   ├── icon48.png
│   ├── icon128.png
│   └── icon.svg        # Source SVG
└── README.md
```

## Usage

1. **Click the extension icon** in your Chrome toolbar to open settings
2. **Toggle settings** as needed:
   - **Enable Extension**: Turn tab grouping on/off
   - **Auto-group New Tabs**: Automatically group tabs as they open
   - **Collapse New Groups**: Start new groups in collapsed state
   - **Ignore "www" Prefix**: Treat www.site.com same as site.com
3. **Use action buttons**:
   - **Group All Tabs**: Manually group all current tabs
   - **Ungroup All**: Remove all tab groups

## Permissions

This extension requires the following permissions:

- `tabs`: Access tab URLs to determine grouping
- `tabGroups`: Create and manage Chrome tab groups
- `storage`: Save your preferences

## Development

### Regenerating Icons

If you need to regenerate the icons:

```bash
# Using Node.js
npm install canvas
node scripts/generate-icons.js

# Or open in browser
open icons/generate-icons.html
```

### Building for Production

The extension is ready to use as-is. For Chrome Web Store submission:

1. Create a ZIP file of the extension folder
2. Exclude development files (`node_modules/`, `scripts/`, etc.)

## Browser Compatibility

- **Chrome**: ✅ Fully supported (requires Chrome 89+)
- **Edge**: ✅ Should work (Chromium-based)
- **Brave**: ✅ Should work (Chromium-based)
- **Firefox**: ❌ Not supported (uses different tab group API)

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT License - feel free to use, modify, and distribute this extension.

---

Made with ❤️ for tab organization enthusiasts
