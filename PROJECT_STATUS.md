# Command Centre

**Status:** Active
**Last Active:** 2026-05-05
**Quick Context:** Web dashboard for monitoring Claude Code sessions AND managing the full project portfolio — sessions, projects, risks, activity, audit. Windows-native, portable, shareable.

## Current State

- **Version:** 0.4.0 (harness enforcement engine)
- **GitHub:** `bigtuff8/claude-command-centre` (all commits pushed)
- **Server:** Live on `0.0.0.0:4111`, auto-started by launcher + watchdog on boot
- **Auto-update:** On boot, pulls latest from GitHub, rebuilds if needed, then starts watchdog
- **Landing page:** Portfolio dashboard (5 tabs: Sessions, Portfolio, Risks, Activity, Audit)
- **Sessions:** 31 session features complete, 2 partial
- **Portfolio:** 21 portfolio features built (P001-P021), scanning 50 real projects
- **Harness enforcement:** 4-layer engine (checkpoints, state machine, PreToolUse enforcement, phase orchestrator)
- **Tests:** 33 Playwright E2E tests (sessions) + 25 harness enforcement tests = 58 total
- **Persistence:** Sessions via `data/state.json`, portfolio via in-memory cache with 60s file-scan refresh, harness via `data/harness-ledger.jsonl`
- **Auto-approve:** ON — global + per-session toggles (harness enforcement runs BEFORE auto-approve)

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

### Distribution & Auto-Update (B018)

- Code lives in GitHub repo `bigtuff8/claude-command-centre`
- On boot, `scripts/auto-update.js` runs before the watchdog: fetches from GitHub, pulls if behind (ff-only), conditionally runs `npm install` if `package-lock.json` changed, rebuilds TypeScript, restarts server
- Manual update: `npm run update` (pull + rebuild) or `npm run update:start` (pull + rebuild + start watchdog)
- Update log written to `data/update.log`
- Phase 2 (backlog): scheduled task for periodic checks, multi-device setup script

### Harness Enforcement Engine (New — v0.4.0)

4-layer enforcement engine that prevents Claude from skipping harness steps:

- **Layer 1 — Checkpoint files:** `.harness/` dir in project folders, JSON with artefact hashes, server-side validation
- **Layer 2 — State machine:** `harness-state.json` per project, phase transitions, rework cycles, overrides. Centralised `data/harness-ledger.jsonl` feeds portfolio reporting.
- **Layer 3 — PreToolUse enforcement:** Denies tool calls that violate phase rules. `mustReadBefore` (must read agent prompt before writing), `blockWrite` (no code in init/design/test), `blockBash` (no commit in init, no push with failing tests), `requireCheckpoint` (previous phase must be complete).
- **Layer 4 — Phase orchestrator:** Generates context-rich prompts per phase, validates transition readiness, executes phase advances via REST API.

API endpoints: `/api/harness/status`, `/create`, `/advance`, `/transition`, `/override`, `/pause`, `/gate/clear`, `/ledger`, `/projects`, `/summary`, `/transition-ready`, `/phase-prompt`, `/validate`

All 7 agent prompts updated with mandatory checkpoint writing sections.

### What's Partial / Known Issues

- **Data source:** Portfolio data comes from parsing markdown files every 60s — fragile, not a reliable source of truth for activity freshness. Harness ledger provides structured data for harness-managed projects.
- **Health score:** 32% reflects real state but penalties are coarse
- **Risk register:** Template file with placeholder rows, so 0 risks shown
- **B006** — Hold/resume UI limited value (claude -p is one-shot)
- **Portfolio tests** — No Playwright tests yet for portfolio tabs
- **Harness dashboard UI** — No visual panel for harness control yet (API-only). Phase 2.
- **Portfolio config:** Was using wrong username in fallback paths. Fixed to use `config.json` with correct paths.

## Next Steps

1. **Harness dashboard UI** — Visual panel in Command Centre for harness control (phase progress, file read tracking, override buttons, gate UI)
2. **Portfolio Database Layer (P-DB)** — SQLite database as source of truth for portfolio data. Harness ledger already provides structured data for harness-managed projects.
3. Portfolio Playwright E2E tests (P-TEST)
4. B016 — Mobile push notifications (scope decision pending)
5. B018 Phase 2 — Scheduled auto-update checks, multi-device setup script

## How to Resume

1. Read this file for current state
2. Server is likely already running — check: `curl -s http://localhost:4111/healthz`
3. If not running: `cd "Command Centre" && npm run build && npm start`
4. Or use watchdog: `npm run watchdog` (auto-restarts on crash)
5. To pull latest and rebuild: `npm run update`
6. Dashboard at http://localhost:4111 — opens portfolio view (all 5 tabs)
7. Sessions-only view: http://localhost:4111/sessions.html
8. **Auto-approve is ON** — toggle in metrics bar
9. Sessions persist across restarts (`data/state.json`)
10. Portfolio data refreshes every 60s from file system scan
11. Key docs: `portfolio-design-spec.md`, `portfolio-design-research.md`, `ARCHITECTURE.md`
12. Source: `src/` (TypeScript), `src/portfolio/` (portfolio backend), `public/` (frontend)

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
| `scripts/auto-update.js` | Auto-updater — git pull, npm install, build, restart |
| `scripts/watchdog.js` | Crash recovery — respawns server on non-zero exit |
| `scripts/install-service.js` | Installs boot startup (auto-update + watchdog) |
| `portfolio-design-spec.md` | Full design specification for the portfolio extension |
| `portfolio-design-research.md` | Design research (market analysis, techniques, references) |
| `portfolio-feature-list.json` | Portfolio feature list (21 features) |
| `config.json` | Runtime config (host, port, auto-approve, portfolio roots) |
| `data/state.json` | Persisted session state |
| `data/update.log` | Auto-update history log |
| `src/harness/` | Harness enforcement engine — types, state, checkpoints, rules, ledger, orchestrator |
| `src/routes/harness.ts` | Harness REST API routes (`/api/harness/*`) |
| `tests/harness.spec.ts` | 25 Playwright integration tests for harness enforcement |
| `data/harness-ledger.jsonl` | Centralised harness event log (append-only) |
| `data/harness-projects.json` | Computed snapshot of harness state per project |

## Session Log

| Date | Summary |
|------|---------|
| 2026-04-11 | Research phase. Assessed 11 tools, identified HTTP hooks + web dashboard as build path. |
| 2026-04-12 | Design + MVP build. 17 features. Transcript panel, permissions, toasts, scroll-lock, rename. 21 tests. |
| 2026-04-13 | Text input (F029). Priority backlog B001-B009. Launcher integration. 33 tests. |
| 2026-04-15 | Terminal focus fix (PID registration). Per-session token counts. Spawner path fix. |
| 2026-04-16-17 | Major session. B010-B017 built. PowerShell toasts, persistence, watchdog, auto-approve, accurate tokens. |
| 2026-04-18-19 | Portfolio extension. Full build harness run: design (4 iterations, 3 directions combined), build (21 features — parsers, scanner, cache, API, 5-tab frontend with glassmorphism/aurora/heat trails/decay), merge as landing page. 50 projects discovered. Health score 32%. |
| 2026-04-24 | B018 Phase 1: Pushed 8 unpushed commits to GitHub. Created auto-update script (`scripts/auto-update.js`) — git pull, conditional npm install, rebuild, server restart. Integrated into boot startup (auto-update runs before watchdog on login). Added `npm run update` and `npm run update:start` scripts. Configured git identity on desktop. Updated all project docs. |
| 2026-05-05 | **Harness Enforcement Engine (v0.4.0).** Root cause analysis of harness non-compliance. Designed 4-layer enforcement (SteerCo review: 8 sections, 3 amendments, all approved). Built Layers 1-3 (checkpoints, state machine, PreToolUse enforcement, ledger) + Layer 4 (orchestrator). Updated all 7 agent prompts with checkpoint writing. 25 Playwright tests passing. Fixed portfolio config (wrong username in fallback paths). Two commits pushed to GitHub. |
