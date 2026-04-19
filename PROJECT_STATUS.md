# Command Centre

**Status:** Active
**Last Active:** 2026-04-19
**Quick Context:** Web dashboard for monitoring Claude Code sessions AND managing the full project portfolio — sessions, projects, risks, activity, audit. Windows-native, portable, shareable.

## Current State

- **Version:** 0.3.0 (portfolio extension merged)
- **Server:** Live on `0.0.0.0:4111`, auto-started by launcher + watchdog on boot
- **Landing page:** Portfolio dashboard (5 tabs: Sessions, Portfolio, Risks, Activity, Audit)
- **Sessions:** 31 session features complete, 2 partial
- **Portfolio:** 21 portfolio features built (P001-P021), scanning 50 real projects
- **Tests:** 33 Playwright E2E tests (session features — portfolio tests not yet written)
- **Persistence:** Sessions via `data/state.json`, portfolio via in-memory cache with 60s file-scan refresh
- **Auto-approve:** ON — global + per-session toggles

### Landing Page — Portfolio Dashboard

Opening `localhost:4111` now shows the portfolio dashboard with 5 tabs:

- **Sessions** — Existing session monitoring (embedded via iframe from sessions.html)
- **Portfolio** — Board view (bento grid) + List view of all 50 projects, gate queue, stale projects, risk summary, data dictionary audit, activity feed, quick stats. Glassmorphism cards with desaturation decay on stale projects, heat trail activity strips, detail panel on click.
- **Risks** — Full SteerCo risk register with filters by status and project. Accept/mitigate actions.
- **Activity** — Timeline of git commits and session activity grouped by date, contribution heatmap, weekly stats.
- **Audit** — Portfolio health score gauge (currently 32%), data dictionary coverage, status file freshness, feature list coverage, risk exposure summary.

Global permission bar visible on all tabs. Consistent filter row frame across all tabs.

### Architecture

- Backend: `src/portfolio/` module — types, markdown parsers, directory scanner, in-memory cache, Express API routes under `/api/portfolio/*`
- Frontend: `public/index.html` (portfolio), `public/portfolio.css`, `public/portfolio.js` — all separate from the sessions dashboard code
- Sessions dashboard: `public/sessions.html`, `public/styles.css`, `public/app.js` — completely untouched

### What's Partial / Known Issues

- **Data source:** Portfolio data comes from parsing markdown files every 60s — fragile, not a reliable source of truth for activity freshness
- **Health score:** 32% reflects real state but penalties are coarse
- **Risk register:** Template file with placeholder rows, so 0 risks shown
- **B006** — Hold/resume UI limited value (claude -p is one-shot)
- **Portfolio tests** — No Playwright tests yet for portfolio tabs

## Next Steps

1. **Portfolio Database Layer** — SQLite database as source of truth for portfolio data. Sync/ingestion from MD files. Process enforcement via harness + CLAUDE.md to mandate DB updates. Audit exception queue for discrepancies. This is the next project.
2. Portfolio Playwright E2E tests
3. B016 — Mobile push notifications (scope decision pending)
4. npm publish / GitHub distribution (B018)

## How to Resume

1. Read this file for current state
2. Server is likely already running — check: `curl -s http://localhost:4111/healthz`
3. If not running: `cd "Command Centre" && npm run build && npm start`
4. Or use watchdog: `npm run watchdog` (auto-restarts on crash)
5. Dashboard at http://localhost:4111 — opens portfolio view (all 5 tabs)
6. Sessions-only view: http://localhost:4111/sessions.html
7. **Auto-approve is ON** — toggle in metrics bar
8. Sessions persist across restarts (`data/state.json`)
9. Portfolio data refreshes every 60s from file system scan
10. Key docs: `portfolio-design-spec.md`, `portfolio-design-research.md`, `ARCHITECTURE.md`
11. Source: `src/` (TypeScript), `src/portfolio/` (portfolio backend), `public/` (frontend)

## Key Files

| File | Purpose |
|------|---------|
| `src/portfolio/` | Portfolio backend — types, parsers, scanner, cache |
| `src/routes/portfolio.ts` | Portfolio API routes (`/api/portfolio/*`) |
| `public/index.html` | Portfolio dashboard (landing page) |
| `public/portfolio.css` | Portfolio styles (glassmorphism, aurora, bento grid) |
| `public/portfolio.js` | Portfolio frontend JS (API-driven rendering) |
| `public/sessions.html` | Sessions dashboard (original CC, embedded as iframe in Sessions tab) |
| `public/styles.css` | Sessions dashboard styles (unchanged) |
| `public/app.js` | Sessions dashboard JS (unchanged) |
| `portfolio-design-spec.md` | Full design specification for the portfolio extension |
| `portfolio-design-research.md` | Design research (market analysis, techniques, references) |
| `portfolio-feature-list.json` | Portfolio feature list (21 features) |
| `config.json` | Runtime config (host, port, auto-approve, portfolio roots) |
| `data/state.json` | Persisted session state |

## Session Log

| Date | Summary |
|------|---------|
| 2026-04-11 | Research phase. Assessed 11 tools, identified HTTP hooks + web dashboard as build path. |
| 2026-04-12 | Design + MVP build. 17 features. Transcript panel, permissions, toasts, scroll-lock, rename. 21 tests. |
| 2026-04-13 | Text input (F029). Priority backlog B001-B009. Launcher integration. 33 tests. |
| 2026-04-15 | Terminal focus fix (PID registration). Per-session token counts. Spawner path fix. |
| 2026-04-16-17 | Major session. B010-B017 built. PowerShell toasts, persistence, watchdog, auto-approve, accurate tokens. |
| 2026-04-18-19 | Portfolio extension. Full build harness run: design (4 iterations, 3 directions → combined), build (21 features — parsers, scanner, cache, API, 5-tab frontend with glassmorphism/aurora/heat trails/decay), merge as landing page. 50 projects discovered. Health score 32%. Next: database layer as source of truth. |
