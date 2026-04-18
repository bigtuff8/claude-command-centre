# Design Specification: Command Centre — Portfolio Management Extension

**Mode:** Unconstrained
**Direction:** Bento Control (combined — glassmorphism bento grid + Signal Board list view + Gravity Well decay effects)
**Created:** 2026-04-18
**Designer Agent Session**
**Extends:** design-spec.md (v1), design-spec-v2.md (v2), design-spec-v3.md (v3)

---

## Design System

The portfolio extension inherits and extends the existing Mission Control design system. No changes to the core palette, typography, or spacing — only additions.

### Colour Palette (inherited)

| Name | Hex | Usage |
|------|-----|-------|
| Base | `#09090b` | Page background |
| Card | `#111113` | Cards, elevated surfaces |
| Card Hover | `#1a1a1d` | Hover states |
| Elevated | `#1e1e21` | Modals, overlays |
| Border | `#27272a` | All borders |
| Border Hover | `#3f3f46` | Borders on hover |
| Text Primary | `#fafafa` | Headings, names |
| Text Secondary | `#a1a1aa` | Descriptions, body text |
| Text Muted | `#71717a` | Labels, timestamps, metadata |
| Blue | `#3b82f6` | Interactive elements, active selection |
| Green | `#10b981` | Active/healthy status, approve actions |
| Amber | `#f59e0b` | Waiting/attention, warning, staleness |
| Rose | `#f43f5e` | Error, deny, risk |

### New: Glassmorphism Layer

All portfolio tiles/cards use a frosted glass effect:

```css
.glass {
  background: rgba(17, 17, 19, 0.75);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid var(--border);
  border-radius: 12px;
}
```

Tinted variants for semantic sections:
- **Gate queue tiles:** `background: rgba(245, 158, 11, 0.05)` + `border-top: 2px solid var(--amber)`
- **Stale projects tile:** `background: rgba(245, 158, 11, 0.05)` + `border-left: 3px solid var(--amber)`
- **Risk register tile:** `background: rgba(244, 63, 94, 0.05)` + `border-left: 3px solid var(--rose)`

### New: Aurora Background

Three animated radial gradient blobs positioned fixed behind all content:
- Blob 1: Blue (`rgba(59,130,246,0.06)`), 600px, drifts top-left to centre
- Blob 2: Purple (`rgba(139,92,246,0.05)`), 500px, drifts right to centre-left
- Blob 3: Teal (`rgba(20,184,166,0.04)`), 550px, drifts bottom to centre

Animation: 60-second CSS keyframe cycle. `filter: blur(120px)`. Barely perceptible — peripheral awareness, not decoration.

### New: Desaturation Decay

Project cards apply a CSS `filter: saturate(X)` based on days since last activity:
- 0-3 days: `saturate(1.0)` — full colour
- 4-7 days: `saturate(0.85)` — slight fade
- 8-14 days: `saturate(0.7)` — noticeable
- 15-21 days: `saturate(0.5)` — clearly aged
- 22-30 days: `saturate(0.35)` — faded
- 30+ days: `saturate(0.2)` — nearly greyscale

On hover, card resets to `saturate(1.0)` — the card "wakes up."

### New: Heat Trail Activity Strips

30-cell horizontal strips showing daily activity for the last 30 days:
- Each cell: 4px wide × 12px tall
- Rightmost cell = today, leftmost = 30 days ago
- Active days: `#10b981` (green) at varying opacity (0.3-1.0 based on intensity)
- Inactive days: `#1a1a1d` (card background)
- Container: 3px border-radius

### Typography (inherited + additions)

| Role | Font | Size | Weight |
|------|------|------|--------|
| Tile headers | Inter | 18px | 600 |
| Metric values (large) | Inter | 28px | 700 |
| Project names (cards) | Inter | 14px | 600 |
| Body text | Inter | 13px | 400 |
| Metadata/timestamps | Inter | 11px | 400 |
| Monospace (hashes, code) | JetBrains Mono | 11px | 400 |
| Status pills | Inter | 11px | 500 |
| Filter pills | Inter | 12px | 500 |

### Spacing (inherited)

Base unit: 4px. Scale: 4, 8, 12, 16, 20, 24, 32, 48.
- Tile padding: 20px
- Bento grid gap: 16px
- Main content padding: 24px horizontal
- Card border-radius: 12px

---

## Global Structure

The portfolio extension adds 4 new tabs to the existing Command Centre. The page structure is:

```
┌─────────────────────────────────────────────────────┐
│ METRICS BAR (sticky, z-index: 10)                   │
│ ● Command Centre    39 | 6 | 3 | 2 | 1    [Actions]│
├─────────────────────────────────────────────────────┤
│ NAV TABS (sticky, z-index: 9)                       │
│ Sessions | Portfolio | Risks | Activity | Audit     │
├─────────────────────────────────────────────────────┤
│ FILTER ROW (sticky, consistent across ALL tabs)     │
│ [tab-specific filter pills]        [tab-specific    │
│                                     controls]       │
├─────────────────────────────────────────────────────┤
│ GLOBAL PERMISSION BAR (when permissions pending)    │
│ ● session needs permission: Tool — detail  [A] [D]  │
├─────────────────────────────────────────────────────┤
│ TAB CONTENT (scrollable)                            │
│                                                     │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Consistent Frame Rule

Every tab has the same vertical structure: metrics bar → nav tabs → filter row → content. The filter row is always present with the same height (min-height: 44px) and padding (8px 24px 12px). Only the content within the filter row changes per tab. This prevents vertical shifting when switching tabs.

### Global Permission Bar

The permission bar sits between the filter row and tab content. It is visible on ALL tabs — the user never needs to switch to Sessions to approve/deny a permission. Features:
- Amber glass tint (`rgba(245,158,11,0.08)`)
- Pulsing amber dot
- Session name + tool name + detail in monospace
- Approve (green) / Deny (rose) buttons
- Countdown timer (30s, falls through to CLI on timeout)
- Slides in with animation, slides out on resolve
- Red pulsing badge appears on Sessions tab when permissions are pending

---

## Page Specifications

### Tab 1: Sessions

**Purpose:** Real-time monitoring of active Claude Code sessions (existing CC functionality)
**Filter Row:** All / Active / Waiting / Completed + session count

**Layout:**
- Session cards in a responsive grid (3 columns desktop, stacking on mobile)
- Each card: glassmorphism, status dot + name, project path (monospace), status/SDK/working badges, footer with elapsed time, tokens, cost, files, tools
- Click card → transcript panel appears on right (half-width)
- Transcript shows user/assistant/tool messages with role labels and thinking indicator
- Bottom: compact activity feed (session events)

**States:**
- Loading: skeleton cards
- Empty: "No active sessions" with Launch Session button
- Error: toast notification

### Tab 2: Portfolio

**Purpose:** Portfolio overview — all active projects, gate queue, staleness, risks, compliance
**Filter Row:** All / Work / Personal / Stale / At Gate + Board/List view toggle

#### Board View (default)

12-column CSS Grid bento layout:

**Row 1:**
| Tile | Grid Span | Content |
|------|-----------|---------|
| Gate Queue | 8 cols | SteerCo governance gate items. Amber glass tint. Each item: project name, gate type, date reached, days waiting, Open Review + Launch Session buttons. Empty state: "All Clear ✓" compressed tile. |
| Portfolio Overview | 4 cols | 6 large metric boxes: Total, Active, Stale, At Gate, Open Risks, Archived. Colour-coded values (28px bold). |

**Row 2:**
| Tile | Grid Span | Content |
|------|-----------|---------|
| Stale Projects | 6 cols | Projects >21 days inactive. Amber glass tint. Each: name, status pill, last active, staleness badge, heat trail, Launch Session button. Header: "⚠ Needs Attention (N projects)". |
| Risk Register | 6 cols | Summary table of open/recent risks. Rose glass tint. Columns: ID, Project, Perspective (coloured dot), Severity (pill), Status (outline pill). Description as secondary text. |

**Row 3: Project Cards**
- Full width, auto-fill grid (`minmax(320px, 1fr)`)
- Each card (glassmorphism): project name + status pill, Work/Personal tag + staleness dot, quick context line, feature progress bar (if applicable), heat trail, last active date, Launch Session button
- Desaturation decay based on age
- Hover: lift, border brighten, saturate reset
- Click → detail panel (slide-in from right, 50vw, glass background)

**Row 4:**
| Tile | Grid Span | Content |
|------|-----------|---------|
| Data Dictionary Audit | 4 cols | Per-project: name + ✓/✗ + last updated. Stale (>30d) flagged amber. Missing flagged rose. |
| Activity Feed | 4 cols | Last 10 activities: timestamp (monospace), project name (blue), action description. |
| Quick Stats | 4 cols | Work/Personal split bar, most active project, sessions/commits/features this week. |

#### List View

Full-width glassmorphism table with collapsible sections:

**Columns:** Status dot | Project | Type | Last Active | Age | Gate | Features | Risks | Dict | Activity (30d heat trail)

**Sections:** Gate Queue (amber left border) → Work → Personal → Archived (collapsed by default)

**Row styling:**
- Status dot colour: green (<7d), amber (7-21d), rose (>21d), grey (archived)
- Age column colour-coded to match dot
- Features column: inline progress bar + "X/Y" text
- Dict column: ✓ (green) or ✗ (rose)
- Desaturation on stale rows
- Click row → same detail panel as Board view

#### Detail Panel (shared)

Triggered by clicking any project card (Board) or row (List).

- Slides in from right, 50vw width
- Glass background: `backdrop-filter: blur(30px)`, `background: rgba(17,17,19,0.85)`
- Close: × button or Escape key
- Overlay dims rest of page

Content sections:
1. **Header:** Project name (20px 700), status pill, Work/Personal tag, last active + staleness
2. **Features** (if applicable): progress bar, "X of Y complete", last 5 features with ✓/✗
3. **Recent Commits:** 5 entries with hash (monospace blue), message, date
4. **Session Log:** 4 entries from PROJECT_STATUS.md
5. **Risks** (if applicable): project-specific risks from register
6. **Launch Session** button (btn-primary, full width)

### Tab 3: Risks

**Purpose:** Full SteerCo risk register — view, filter, and manage risks
**Filter Row:** All / Open / Accepted / Mitigated + Project dropdown

**Layout:**

**Top section:** Risk summary metrics (4 glassmorphism metric boxes in a row)
- Open (rose, 28px bold)
- Accepted (amber, 28px bold)
- Mitigated (green, 28px bold)
- Total (text-secondary, 28px bold)

**Main content:** Full-width glassmorphism table
- Columns: ID | Date Raised | Project | Perspective | Severity | Status | Description | Actions
- Perspective column: coloured dot (Security=rose, Compliance=amber, Technical=text-muted, Finance=blue, Transition=green, Product=blue)
- Severity: pill badges (Critical/High=rose, Medium=amber, Low=green)
- Status: outline pills (Open=rose, Accepted=amber, Mitigated=green)
- Actions: Accept / Mitigate buttons on open risks (writes back to risk-register.md)
- Click row to expand: shows full description, mitigation notes, dates
- Description shown as secondary text below main row

### Tab 4: Activity

**Purpose:** Full portfolio-wide activity timeline
**Filter Row:** Today / This Week / This Month / All Time + Project dropdown + All / Commits / Sessions type pills

**Layout:** Two-column split (8 cols + 4 cols)

**Left: Activity Timeline**
- Vertical timeline grouped by date headers
- Each entry: time (monospace muted), project name (blue), type badge (COMMIT=blue-dim pill, SESSION=green-dim pill), description, metadata (hash for commits, duration + tokens for sessions)

**Right: Contribution Heatmap**
- GitHub-style grid: 12 weeks × 7 days
- Cell size: 12px square, 2px gap
- Colour intensity: no activity (#111113) → low (green 0.2) → medium (0.4) → high (0.7) → very high (#10b981)
- Month labels at top, day labels on left (M, W, F)
- Legend: Less □□□□□ More
- Below: "This Week" stats box (sessions, commits, tokens, cost)

### Tab 5: Audit

**Purpose:** Portfolio documentation and compliance health
**Filter Row:** All Categories / Data Dictionaries / Status Files / Feature Lists / Risk Exposure + health score display

**Layout:**

**Top: Health Score Gauge**
- SVG circular arc gauge showing percentage (28px bold centre)
- Colour: green >70%, amber 50-70%, rose <50%
- Label: "Portfolio Health Score"
- Subtitle: "Based on documentation completeness, data dictionary coverage, and project freshness"

**Main: 2×2 Audit Grid** (each tile glassmorphism, span 6 cols)

| Tile | Content |
|------|---------|
| Data Dictionary Coverage | Score (X/Y projects, percentage), progress bar, per-project table with ✓/✗ and last updated, stale/missing flagging |
| PROJECT_STATUS.md Freshness | Score (X/Y have status files), fresh/stale/very stale/missing counts with colour-coded numbers, per-project table |
| Feature List Coverage | Score (X/Y have feature lists), per-project progress bars with completion percentages, total features complete across portfolio |
| Risk Exposure Summary | Open risk count, severity breakdown (Critical/High/Medium/Low), perspective breakdown (horizontal bar chart), per-project risk counts, link to Risks tab |

---

## Responsive Behaviour

**Breakpoint: 900px**
- Bento grid: all tiles stack to single column
- List view: horizontal scroll
- Session cards: single column
- Audit grid: single column
- Activity layout: single column (heatmap below timeline)
- Detail panel: full width instead of 50vw

**Breakpoint: 600px**
- Metrics bar: hide metric labels, show values only
- Filter row: horizontal scroll on pills
- Nav tabs: horizontal scroll

---

## Accessibility

- All interactive elements keyboard-focusable
- Escape key closes detail panel and modals
- Status dots use colour + shape (pulsing = active, static = resolved)
- Severity/status pills have text labels (not colour-only)
- Minimum contrast ratios maintained (text-muted on bg-card passes WCAG AA for large text)
- Heat trail is supplementary information, not the only way to see activity

---

## Data Architecture — Database Layer

### Design Decision (approved at gate)

The portfolio extension will NOT parse markdown files on every API request. Instead, a **database layer** sits between the filesystem and the dashboard:

```
Source Files                    Sync Layer              Database           Dashboard
─────────────                   ──────────              ────────           ─────────
PROJECT_STATUS.md ─────┐
feature-list.json ─────┤
risk-register.md  ─────┼──→  Ingestion Service  ──→  SQLite DB  ──→  Express API  ──→  UI
DATA_DICTIONARY.md ────┤     (parse + normalise)      (local file)    /api/portfolio/*
git log ───────────────┘
```

### Database: SQLite

- Zero infrastructure — ships as a single file alongside the server
- No external dependencies (use `better-sqlite3` npm package)
- Works with existing Node/Express stack
- Fast reads for dashboard queries
- File location: `data/portfolio.db` (gitignored, alongside existing `data/state.json`)

### Sync/Ingestion Layer

Runs:
- On server startup (full scan)
- On configurable interval (default: 60 seconds)
- On demand via `POST /api/portfolio/sync`

Process:
1. Walk configured project directories
2. For each project folder:
   - Parse PROJECT_STATUS.md → `projects` table
   - Parse feature-list.json → `features` table
   - Stat DATA_DICTIONARY.md → `audit` table (existence + mtime)
   - Detect review HTML files → `gate_documents` table
3. Parse risk-register.md → `risks` table
4. Run `git log` per repo (cached, incremental) → `activity` table
5. Record sync metadata → `sync_log` table

### Separation of Concerns

This database layer is a **companion project** to the portfolio UI build. It is referenced here as an architectural dependency but will be designed and built as its own piece of work with:
- Its own data dictionary
- Its own feature list
- Schema design reviewed at its own design gate

The portfolio UI will be built against the database API, not the filesystem. If the database layer is not yet built, the UI can temporarily fall back to direct file parsing (same logic, different data source) — but the target architecture is always database-first.

### Why Not Cosmos DB / Cloud?

SQLite is chosen because:
- Command Centre is a local tool, not a cloud service
- No network dependency for reads
- No cost (Cosmos DB has RU charges)
- Portable — moves with the machine
- If the product moves to cloud/SaaS later, the API layer abstracts the storage — swap SQLite for Cosmos/Postgres without changing the UI

---

## Build Scope — All 5 Tabs

All tabs are in scope for the portfolio extension build. The Sessions tab already exists as the current dashboard — it receives minor integration work (tab navigation wrapper, global permission bar extraction). The other four tabs are new builds.

| Tab | Build Effort | Notes |
|-----|-------------|-------|
| Sessions | Small | Already built. Wrap in tab navigation. Extract permission bar to global position. |
| Portfolio | Large | Main new build. Board + List views, project cards, gate queue, detail panel, filters. |
| Risks | Medium | Table + filters + expand/collapse + write-back to markdown (or database). |
| Activity | Medium | Git log aggregation, timeline rendering, contribution heatmap. |
| Audit | Small-Medium | Calculated views from database queries. Health score, coverage tables. |

Shared infrastructure (built once, used by all tabs):
- Tab navigation framework
- Global permission bar
- Consistent filter row
- Detail panel component
- Glassmorphism card component
- Heat trail component
- Toast notification system

---

## Product Distribution Assessment

### Tier 1: Colleague-Shareable (close to ready)

| Requirement | Status | Gap |
|------------|--------|-----|
| Self-contained Node.js app | ✓ Done | — |
| Setup wizard | ✓ Done | — |
| Auto hook injection | ✓ Done | — |
| GitHub repo | ✗ | B018 in backlog — move from OneDrive to GitHub |
| `npx` one-liner install | ✗ | npm publish needed |
| Auto-update | ✗ | Git pull on schedule or webhook |
| Non-James documentation | Partial | INSTALL.md exists but assumes context |
| Configurable project paths | ✗ | Currently assumes James's OneDrive structure |
| Cross-platform notifications | ✗ | PowerShell toasts = Windows only |

### Tier 2: Open Market / Paid Service (significant work)

| Requirement | Status | Effort |
|------------|--------|--------|
| Authentication (token/OAuth/SSO) | ✗ | Large — currently zero auth |
| Multi-user support | ✗ | Large — user scoping, permissions, shared vs private |
| Cloud deployment option | ✗ | Large — hosted infrastructure, not just localhost |
| Generic project onboarding | ✗ | Medium — "add project" flow instead of dir scanning |
| Billing/licensing | ✗ | Medium — subscription management |
| Branding/white-label | ✗ | Small — remove Airedale-specific references |
| Cross-platform (Linux, macOS) | ✗ | Medium — notification alternatives, path handling |
| Data privacy (cloud) | ✗ | Large — encryption, data isolation, GDPR |

### Architecture Readiness

The current architecture (Express + Socket.io + vanilla JS frontend) is sound for all three tiers:
- **Colleague:** Ship as-is with better packaging
- **Open market (self-hosted):** Add auth middleware, config wizard, cross-platform support
- **Open market (SaaS):** Abstract storage layer (SQLite → managed DB), add multi-tenancy, deploy to cloud

The database layer decision (SQLite with an API abstraction) specifically supports this progression — swap the storage backend without changing the UI or API contracts.

---

## Monitoring Design

### What "Healthy" Looks Like
- All projects have a PROJECT_STATUS.md updated within 30 days
- No projects >21 days stale without explicit archiving
- All projects with data models have a DATA_DICTIONARY.md
- Gate queue items resolved within 7 days
- Zero critical/high open risks

### Success Criteria
- James opens one URL and sees the state of every project
- Gate items are actioned within the same session they're discovered
- Stale projects are surfaced without James having to remember to check
- Portfolio health score trends upward over time

### Failure Indicators
- Health score drops below 50%
- Gate queue items older than 7 days
- More than 5 projects with "Missing" data dictionary status
- Risk register not updated for 30+ days
