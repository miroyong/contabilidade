---
name: "Contabilidade Workspace"
description: "Use when working on this HTML/CSS/JavaScript PWA, Supabase/PostgREST data flow, financial launches, month routing, currency inputs, tests, commits, GitHub Pages deployment, or service-worker cache."
applyTo: "**"
---

# Contabilidade Workspace Rules

## Project

- This is a dependency-free HTML/CSS/JavaScript PWA.
- The backend is Supabase Postgres accessed from the browser through PostgREST.
- The published branch is `main`; the live site is `https://miroyong.github.io/contabilidade/`.
- `apps-script/Code.gs` is legacy reference only and is not the live backend.

## Workflow

- Communicate with the user in Portuguese unless asked otherwise.
- Inspect current file contents and `git status` before editing; preserve unrelated user changes.
- Make the smallest focused change that follows existing code patterns.
- After every edit, run the narrowest relevant executable check, then run the full suite when practical:
  `node scripts/test-backend.js`, `node scripts/test-frontend.js`, `node scripts/test-persistencia.js`, and `node scripts/test-cache.js`.
- Run `git diff --check` before committing.
- Commit validated changes automatically with a concise Portuguese commit message and push to `origin/main` unless the user says not to.
- Do not create empty commits, revert unrelated changes, or use destructive Git commands.

## Financial behavior

- New launches default to `Saida` and keep `Saida` before `Entrada` in the form.
- New launches belong to the month derived from their date. Create the month when needed and reload/select the destination month after the server confirms the save.
- Editing an existing launch must not move it to another month implicitly.
- The `Conta` choices for new launches are exactly `Pix / Cartao` and `Dinheiro`. Preserve legacy stored values when reading old data.
- Monetary inputs use a cent-based mask: digits are entered from right to left with a fixed comma and two decimals, so `1`, `2`, `3`, `4`, `4` becomes `0,01`, `0,12`, `1,23`, `12,34`, `123,44`. Small values keep the `0,` prefix.
- Do not apply the monetary mask to descriptions or quantity fields.
- There is no recurring-launch option and no QR Code/NFC-e feature. Do not reintroduce either unless explicitly requested.

## PWA and deployment

- When changing `app.js`, `index.html`, `style.css`, or other precached assets, bump the `?v=` asset version in `index.html` and the cache version and precache URLs in `service-worker.js`.
- Keep navigation network-first in the service worker so deployed changes are not trapped behind stale HTML; cache is the offline fallback.
- Verify the live Pages HTML/assets after publishing when the user reports that changes did not appear.

## Data safety

- Do not bypass CAPTCHA, anti-bot controls, or fiscal portals.
- Prefer the existing `chamar`/Supabase adapter and local cache patterns over new abstractions.
- Preserve the backend contract: `meses`, `lancamentos`, `tipo`, `data`, `descricao`, `categoria`, `conta`, `valor`, and stable `num` lines.