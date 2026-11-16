# PAT Manager (Windows desktop)

A desktop app for managing portable appliance testing (PAT): clients, sites, locations, the asset register, test results, retests, failures and repairs, and certificates. It is laid out like PATGuard-style office software and runs fully offline.

## Getting the app

Each push that changes `desktop/` triggers the **Build PAT Manager for Windows** GitHub Action, which builds two files:

- `PAT-Manager-Setup-x.y.z.exe`: an installer with Start menu and desktop shortcuts.
- `PAT-Manager-Portable-x.y.z.exe`: a single exe that runs without installing.

Download them from the run's **Artifacts** section on the repository's **Actions** tab. Pushing a tag such as `desktop-v1.0.0` also attaches them to a GitHub Release.

The exe isn't code-signed, so Windows SmartScreen shows a warning the first time. Click **More info → Run anyway**.

## Features

- **Clients → Sites → Locations tree.** Click any level to filter every screen to it. Right-click it to edit, add sites or locations, print a certificate, or start a test there.
- **Asset register.** Sortable, searchable and filterable by status, class and type. Multi-select with Ctrl and Shift supports bulk actions: test in sequence, move, set the retest interval, print labels, retire, or delete. Right-click for quick actions.
- **Test entry.** Type or scan an asset number; a known asset loads its details and its last readings. The 11-point visual inspection has an **All pass** button. Earth continuity, insulation, protective conductor or touch current, polarity, functional and RCD readings come with automatic limits under the **IET Code of Practice (5th ed.)** or **BS EN 50699:2021**. You see a live PASS/FAIL, a % change from the previous test with deterioration warnings, and the next-due date. **Save & next** keeps the client, site and location for fast room-by-room testing. New clients, sites and locations are created as you type them.
- **Dashboard.** Counts for in-date, due soon, overdue, failed and never-tested assets, a 12-month retest forecast, the year's pass rate, instrument calibration warnings and recent tests.
- **Retest planner.** Assets that are overdue or due in the next 30/60/90/365 days, or a custom date range, grouped by site. You can print a tick-list, export CSV, or **test them all** in sequence.
- **Failures & repairs.** Failed items awaiting action, actioned items awaiting retest, and a repair log with cost. Scrapped or removed items are retired automatically.
- **Test history** across all assets, with filters, CSV export and a printable schedule.
- **Instruments.** Your testers, with calibration dates and expiry warnings. **Engineers** have qualifications, and both are shown on certificates.
- **Reports**, previewed first, then printed or saved as PDF:
  - PAT certificate
  - test results schedule
  - compliance summary
  - retest due list
  - failed items
  - asset register
  - per-asset test records with trend history
  - asset labels with a Code 128 barcode for A4 label sheets (24, 14 or 40 per sheet)
- **Import.** CSV from other PAT software or spreadsheets, with column matching, or a backup from the **PAT Test Log** phone app in `../pat/`. CSV export is also available.
- **Settings.** Company details and logo for reports, the standard, the default retest interval, the "due soon" window, and editable pass/fail limits.

## Data

Everything is stored in one file: `Documents\PAT Manager\pat-manager-data.json`. Changes save automatically. A copy goes into the `Backups` folder beside it once a day, and the last 30 copies are kept. **File → Back Up Now** saves a copy anywhere you choose. **Settings → Open another data file** lets you keep the file on a shared or OneDrive folder. Only open it on one PC at a time.

**Check the default pass/fail limits against your copy of the standard and your company's test policy.** You can change every limit under Settings.

## Development

```
cd desktop
npm install
npm start                       # run the app
npx electron-builder --win portable   # portable exe (works from Linux/macOS too)
npx electron-builder --win nsis       # installer (needs Windows, or Wine on Linux)
```

There's no framework and no build step. The UI is plain HTML, CSS and JS in `src/`; `main.js` handles the data file, dialogs and PDF/printing. `src/standards.js` is shared with the phone app.
