# Portfolio Management Extension — Design Brief

**Created:** 2026-04-18
**Author:** James Brown (via Claude session)
**Project:** Command Centre (extension)
**Harness:** Build
**Mode:** Unconstrained
**Status:** Ready for design session

---

## What This Is

An extension to the Command Centre that adds portfolio management views — giving James a single place to see the state of all active projects, what needs his attention, what's healthy, and what's stale. This is the portfolio management tool envisioned in the SteerCo Operating Model.

---

## Why

James has 39 active projects across Work and Personal. The current portfolio view is static markdown files that only update when a Claude session touches them. There's no single place to see:
- Which projects are waiting for his approval at a SteerCo gate
- Which projects are stale (no activity in weeks)
- Which deployed services are healthy
- What the risk landscape looks like
- What to work on next

The Command Centre already manages Claude sessions. Extending it to manage the portfolio that those sessions serve is a natural fit.

---

## Core Requirements

### 1. Change/WIP View ("What's in flight?")

**Portfolio Board:**
- All active projects displayed as cards with: name, status, last active date, staleness indicator (green/amber/red)
- Filterable by: Work/Personal, status, staleness, has pending gate
- Sortable by: priority, last active, staleness
- Click-through to project detail (PROJECT_STATUS.md content, feature list progress, git activity)

**SteerCo Gate Queue:**
- Prominent section showing projects currently at a governance gate
- For each: which gate (design, pre-deployment, strategic), when it was reached, what document is waiting
- **Direct access to approval documents** — if a review HTML exists for the project, link directly to it (open in browser) or embed it
- **Launch session button** — start a Claude session pointed at that project, using the existing Command Centre session launcher. Pre-populate the working directory and optionally a prompt (e.g., "Resume from Design Gate")

**Activity Feed:**
- Recent activity across all projects (git commits, session starts/ends, status changes)
- Sourced from: git log across repos, SESSION_LOG entries in PROJECT_STATUS.md files, Command Centre session history

**Risk Register View:**
- Visualise the SteerCo risk register (from `steerco/risk-register.md`)
- Filter by: project, perspective, severity, status
- James can accept/mitigate risks directly from the UI (writes back to the markdown file)

**Data Dictionary Audit:**
- Which projects have a DATA_DICTIONARY.md
- When each was last updated
- Flag stale or missing dictionaries

### 2. BAU/Operations View ("Is everything running?") — Phase 2

**Service Health Grid:**
- Every deployed service (Pi Docker containers, Azure apps, MCP servers) with live status
- Health check polling (where /healthz or equivalent exists)
- Docker container status via Docker API (Pi over Tailscale SSH)

**System Metrics:**
- Pi: disk space, memory, CPU, container states
- Trend lines for key metrics

**Alerts Panel:**
- Services that are down or degraded
- Health checks that have failed
- Certificates or tokens approaching expiry

**Success Criteria:**
- Per-project KPIs where instrumented
- Trend visualisation

### 3. Cross-Cutting Requirements

**Session Integration:**
- From any project card or gate queue item, "Launch Session" opens a Claude session pointed at that project
- Leverages the existing Command Centre `launch-session` socket event and spawner
- Pre-sets working directory to the project folder
- Optionally pre-populates the opening message (e.g., harness invocation with the right brief)

**Approval Document Access:**
- The portfolio view detects review HTML files in project folders (e.g., `review.html`, `prototype/index.html`)
- Gate queue items link directly to these documents
- Clicking opens the document in the browser (or serves it via Express static route)

**Real-Time Updates:**
- Portfolio data refreshes via Socket.io (same pattern as existing session updates)
- File watchers on key markdown files, or periodic polling with change detection

**Data Parsing:**
- PROJECT_STATUS.md → structured data (name, status, last active, current state, next steps)
- PROJECT_REGISTRY.md → project index with paths and dependencies
- feature-list.json → feature progress (count complete / total)
- risk-register.md → risk entries
- DATA_DICTIONARY.md → existence and last-modified date
- git log → recent commits per project

---

## What Exists Already (Command Centre)

| Capability | Exists | Reuse for Portfolio |
|------------|--------|-------------------|
| Session launching (terminal + SDK) | Yes | "Launch session" from any project card |
| Socket.io real-time | Yes | Portfolio data push updates |
| Express HTTP server | Yes | New API routes for portfolio data |
| Health check endpoint | Yes (`/healthz`) | Pattern for other services |
| Vanilla JS frontend | Yes | New pages/views in same style |
| Session state persistence | Yes | Pattern for portfolio state caching |
| Playwright test suite | Yes | Extend for portfolio views |
| Config system | Yes | Add portfolio config (project paths, refresh intervals) |

---

## Data Sources

| Source | Location | Parse Complexity |
|--------|----------|-----------------|
| PROJECT_STATUS.md | Every project folder | Medium — markdown with known structure |
| PROJECT_REGISTRY.md | Projects root | Medium — markdown tables |
| feature-list.json | Some project folders | Low — JSON |
| risk-register.md | steerco/ | Medium — markdown tables |
| DATA_DICTIONARY.md | Some project folders | Low — existence + stat |
| git log | Each project's .git | Low — shell command |
| Docker API | Pi via Tailscale SSH | Medium — requires SSH tunnel or API proxy |
| Review HTML files | Project folders | Low — glob for review.html, prototype/index.html |

---

## Architecture Notes

- **New routes** under `/api/portfolio/` — projects, gates, risks, activity, health
- **New frontend page** — portfolio.html (or tab within existing index.html)
- **Markdown parser** — lightweight, extracts structured sections from known-format markdown files
- **File scanner** — walks configured project directories, finds artefacts, builds portfolio state
- **Cache layer** — portfolio state cached in memory (like session state), refreshed on interval or file change
- **Phase 2** adds a collector/poller for Docker API and health endpoints

---

## Phasing

### Phase 1: Portfolio Dashboard
- Portfolio board with project cards (parsed from PROJECT_STATUS.md + PROJECT_REGISTRY.md)
- SteerCo gate queue with approval document links
- Session launching from project cards
- Risk register view
- Data dictionary audit
- Activity feed (git log + session history)
- Staleness indicators

### Phase 2: Live Monitoring
- Docker container health (Pi)
- Health endpoint polling
- Pi system metrics
- Alerts panel
- Success criteria tracking

### Phase 3: Polish & Notifications
- Mobile push notifications for alerts
- Email notifications via Outlook MCP for gate arrivals
- Portfolio health score (composite metric)
- Trend visualisations

---

## Success Criteria

1. James can open one URL and see the state of every active project
2. Projects at SteerCo gates are immediately visible with one-click access to approval documents
3. Sessions can be launched from the portfolio view with the correct project context
4. Stale projects are surfaced without James having to remember to check
5. The risk register is visible and manageable from the UI
6. Data dictionary compliance is auditable at a glance
7. (Phase 2) Deployed service health is visible in real time
8. (Phase 2) Failures surface proactively, not when James happens to check

---

## Open Questions for Design Session

1. **Single page or separate pages?** Portfolio as a new tab in the existing Command Centre SPA, or a separate page?
2. **Project path configuration** — hardcode the two root directories (Work, Personal), or make configurable?
3. **Markdown parsing depth** — how much of PROJECT_STATUS.md do we parse vs display raw?
4. **Git access** — shell out to `git log`, or use a JS git library?
5. **Docker API access** — SSH tunnel to Pi, or install a lightweight API proxy on the Pi?
6. **Review document serving** — serve via Express static route, or just `window.open()` to the file path?
