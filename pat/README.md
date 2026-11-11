# PAT Test Log

An offline-first web app (PWA) for in-service inspection and testing of electrical equipment. Open it on a phone, then use **Add to Home Screen**. It works without a signal after the first load.

## Features

- **Visual inspection:** an 11-point checklist (Pass/Fail/N/A) based on the IET formal visual inspection. Any failed item fails the asset.
- **Manual test entry:** earth continuity, insulation resistance (with a `>` over-range toggle), protective conductor or touch current, polarity, a functional check, and optional RCD trip times.
- **Automatic pass/fail:** readings are checked against the **IET Code of Practice (5th ed.)** or **BS EN 50699:2021**, based on class (I/II/III), cord size and length, and heating elements with their power rating. The calculated limits fill in automatically and can be overtyped.
- **Barcode/QR scanning** with the phone camera. Uses the native `BarcodeDetector` where available (Android Chrome) and ZXing elsewhere (iOS Safari). Torch is supported where the device allows it.
- **Asset tagging:** asset number, description, site, location, make, model, serial, class, type, cord, fuse, power. Site and location autocomplete from earlier entries.
- **History and comparison:** entering or scanning a known asset number loads its details and shows the last test. Each reading shows the % change from the previous one and flags significant deterioration. Asset pages show trend charts and the full history.
- **Photos:** taken with the camera, compressed, and stored with the test.
- **CSV export** of filtered records, filterable by date range, site, location, result, tester, free-text search, and latest-test-per-asset only.
- **PDF reports** open in a preview first, where you can scroll every page before tapping **Send / share** or **Download**. They come as one page per asset (results vs limits vs previous, visual checklist, photos, history, signature lines) or a landscape multi-asset schedule table.
- **Limit calculator:** earth bond limit from conductor size and length under both standards, with the working shown, plus a quick-reference table by class.
- **Backup/restore** to a JSON file, including photos.

## Limits used (defaults, editable in Settings)

| Test | IET CoP | BS EN 50699 |
|---|---|---|
| Earth continuity (Class I) | 0.1 Ω + cord protective conductor R | 0.3 Ω up to 5 m, +0.1 Ω per extra 7.5 m, max 1 Ω |
| Insulation resistance | Class I ≥ 1 MΩ (heating ≥ 3 kW: 0.3 MΩ), Class II ≥ 2 MΩ, Class III ≥ 0.25 MΩ @ 250 V | Same (heating: 0.3 MΩ) |
| Protective conductor current (Class I) | ≤ 3.5 mA (heating > 3.5 kW: 1 mA/kW, max 10 mA) | Same |
| Touch current (Class II) | ≤ 0.25 mA | ≤ 0.5 mA |
| RCD | × 1 ≤ 300 ms, × 5 ≤ 40 ms | Same |

Cord resistance (copper, 20 °C): 0.5 mm² 39, 0.75 mm² 26, 1.0 mm² 19.5, 1.25 mm² 15.6, 1.5 mm² 13.3, 2.5 mm² 8.0, 4.0 mm² 5.0 mΩ/m.

**Check these against your copy of the standard and your company's test policy.** Any value can be changed under Settings → Pass/fail limits.

## Data

Everything is stored in the browser's IndexedDB on the device. There is no server and no sync yet. Use **Settings → Back up** regularly.

## Running locally

Serve the folder over HTTP, for example `python3 -m http.server` inside `pat/`, then open `http://localhost:8000`. The camera needs `https` or `localhost`. GitHub Pages works for hosting.

Vendored libraries are in `vendor/`, each with its licence file: jsPDF 2.5.2, jspdf-autotable 3.8.4, PDF.js 3.11.174 (for the preview) and @zxing/library 0.21.3 (MIT/Apache-2.0).
