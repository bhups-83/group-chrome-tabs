Tabstract (Chrome Extension)

Read URLs of all open tabs in the current window and group them by domain.

Install (Developer Mode)

1. Open Chrome and go to chrome://extensions/
2. Enable Developer mode (top-right).
3. Click Load unpacked and select this folder:
   - /home/bhups/tools/tabs/
4. The extension icon will appear in the toolbar. Click it to open the popup.

Usage

- The popup lists domains with counts and the tabs under each domain.
- Click a tab title to activate that tab.
- Click the refresh button to re-scan the current window's tabs.

Permissions

- tabs: Required to query open tabs in the current window.

Files

- manifest.json: Extension manifest (MV3) with tabs permission and popup action.
- popup.html: Popup UI scaffold.
- popup.css: Styles for the popup.
- popup.js: Logic to query tabs and group by domain.
- assets/: Place `icon-16.png`, `icon-32.png`, `icon-48.png`, `icon-128.png` here.

Create icons from a base logo (Linux)

If you have a base PNG/SVG logo, you can generate required sizes with ImageMagick:

```bash
cd /home/bhups/tools/tabs
mkdir -p assets
convert logo.png -resize 128x128 assets/icon-128.png
convert logo.png -resize 48x48   assets/icon-48.png
convert logo.png -resize 32x32   assets/icon-32.png
convert logo.png -resize 16x16   assets/icon-16.png
```

