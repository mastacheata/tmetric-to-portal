# TMetric ➔ Beyonder Portal Sync Userscript (v1.2.0)

An automated Userscript for Chrome, Firefox, Edge, and Safari that queries time entries from the [TMetric API (v3)](https://app.tmetric.com/api-docs/) and automatically populates:
1. **Timesheets** (`https://portal.beyonder.de/management/timesheet/create/`)
2. **Zeitabschnitte / Tracking Periods** (`https://portal.beyonder.de/time/tracking/create/`)
3. **Portal Project Sync to TMetric** (`POST /api/v3/accounts/{accountId}/projects`)

---

## 🚀 Quick Setup & Installation Guide for Colleagues

### Step 1: Install Tampermonkey or Violentmonkey
Install a userscript manager extension in your browser:
- **Chrome / Edge / Brave**: [Tampermonkey for Chrome](https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo)
- **Firefox**: [Tampermonkey for Firefox](https://addons.mozilla.org/en-US/firefox/addon/tampermonkey/) or [Violentmonkey](https://addons.mozilla.org/en-US/firefox/addon/violentmonkey/)
- **Safari**: [Tampermonkey for Safari](https://apps.apple.com/app/tampermonkey/id1482490089)

### Step 2: Install the Userscript
1. Click the Tampermonkey / Violentmonkey extension icon in your browser toolbar and select **Create a new script...**
2. Copy and paste the complete content of [`tmetric-portal-sync.user.js`](file:///home/benedikt/tmetric-to-portal/tmetric-portal-sync.user.js) into the editor.
3. Save the script (**Ctrl+S** or **File ➔ Save**).

---

## ⚙️ How to Use

### 1. Syncing Time Entries & Tracking Periods (🚀 Sync from TMetric)
- Click the **🚀 Sync from TMetric** button in the header toolbar.
- **Multi-Day Syncing**: Choose between **Past 3 Days** or **Single Date** range.
- **Selective Checkboxes**: Toggle individual timesheets or days.
- **Submit**: Click **Approve & Sync Selected**.

### 2. Creating Missing Projects in TMetric (📁 Sync Projects to TMetric)
- Click the **📁 Sync Projects to TMetric** button in the header toolbar.
- The script automatically locates your **Mein Profil** link (`/account/employee/detail/{id}/`), fetches your assigned projects, and compares them with your existing TMetric projects.
- **Role Extraction**: Automatically cleans project names (e.g. `DVG - Konzeptsprint (IT-Architekt*in)` ➔ Name: `DVG - Konzeptsprint`).
- **Client & Code Assignment**: Specify an optional **TMetric Client** (dropdown fetched from your TMetric account) and **Project Code** for each new project.
- **Safety Guarantee**: Syncing will **NEVER delete** or modify existing projects in TMetric. It only creates missing projects upon explicit confirmation.

---

## 🧪 Testing

To run the automated unit tests:
```bash
node tests/matching.test.js
```
