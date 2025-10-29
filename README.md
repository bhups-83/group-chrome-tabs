Tab Domain Grouper (Chrome Extension)

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

