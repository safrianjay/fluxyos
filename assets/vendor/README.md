# Vendored third-party scripts

Files here are committed on purpose: FluxyOS has **no build step**, and the CSP
is `script-src 'self'` (plus a short allowlist that does not include a CDN for
these), so a browser-side library has to be served from our own origin.

| File | Version | Loaded by | Why |
|---|---|---|---|
| `xlsx.mini.min.js` | SheetJS `xlsx` 0.18.5 (`dist/xlsx.mini.min.js`) | `assets/js/inventory-bulk-import.js` | Reads `.xlsx` / `.xls` uploads for the inventory bulk import. |

## Why `mini` and not `full`

`mini` is 248 KB against `full`'s 864 KB and reads every format we accept. It is
also **loaded lazily** — only when the user picks a spreadsheet file. A CSV
upload, which is the common path, pays nothing for it.

## Keeping it in step

`xlsx` is already a package.json dependency because two Netlify functions parse
uploads server-side with it. This file is a **copy of that same version**, so
after `npm update xlsx` re-copy it and note the new version above:

    cp node_modules/xlsx/dist/xlsx.mini.min.js assets/vendor/xlsx.mini.min.js

A drifted copy means the browser and the server disagree about what a
spreadsheet says, which is the kind of difference nobody notices until a number
is wrong.
