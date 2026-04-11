# Design Specification: Command Centre

**Mode:** Unconstrained
**Direction:** Mission Control
**Created:** 2026-04-11
**Designer Agent Session**

---

## Design System

### Colour Palette

| Name | Hex | Usage |
|------|-----|-------|
| Base | `#09090b` | Page background |
| Card | `#111113` | Cards, sidebar, elevated surfaces |
| Card Hover | `#1a1a1d` | Hover states on cards and interactive elements |
| Elevated | `#1e1e21` | Modals, dropdowns, overlays |
| Border | `#27272a` | All borders — subtle, never prominent |
| Border Hover | `#3f3f46` | Borders on hover |
| Text Primary | `#fafafa` | Headings, session names, primary content |
| Text Secondary | `#a1a1aa` | Descriptions, activity text |
| Text Muted | `#71717a` | Labels, timestamps, metadata |
| Blue | `#3b82f6` | Interactive elements, active selection, primary actions |
| Blue Dim | `rgba(59,130,246,0.15)` | Blue backgrounds (selected states) |
| Green | `#10b981` | Active/healthy status, approve actions |
| Green Dim | `rgba(16,185,129,0.15)` | Green backgrounds (status badges) |
| Amber | `#f59e0b` | Waiting/attention-needed status, warning |
| Amber Dim | `rgba(245,158,11,0.15)` | Amber backgrounds (permission bar) |
| Rose | `#f43f5e` | Error status, deny actions |
| Rose Dim | `rgba(244,63,94,0.15)` | Rose backgrounds (error badges) |

### Typography

| Role | Font | Size | Weight | Line Height |
|------|------|------|--------|-------------|
| UI text | Inter | 13px | 400 | 1.5 |
| Labels | Inter | 11px uppercase | 500 | 1.2 |
| Session names | Inter | 14px | 600 | 1.3 |
| Page titles | Inter | 14px | 600 | 1.3 |
| Metric values | Inter | 20px | 600 | 1.2 |
| Code/output | JetBrains Mono | 11-12px | 400 | 1.5 |
| Keyboard shortcuts | JetBrains Mono | 10px | 400 | 1.2 |

### Spacing

Base unit: 4px. Scale: 4, 8, 12, 16, 20, 24, 32, 48.
- Card padding: 20px
- Card gap: 16px
- Section padding: 24px horizontal
- Sidebar width: 260px (collapsible)
- Border radius: 6px (buttons), 8px (sidebar items), 10px (permission bar), 12px (cards)

### Components

**Session Card**
- 1px border (`--border`), 12px radius
- Header: status dot + name (left), status badge (right)
- Project path in monospace (muted)
- Activity description (secondary text, may contain inline `code`)
- Footer: stats (files, tools, tokens) left, elapsed time right
- Hover: translateY(-1px), shadow, border lightens
- Needs-attention variant: amber border, 2px amber top stripe

**Status Dot**
- 8px circle with matching box-shadow glow
- Active: green, pulsing animation (2s)
- Waiting: amber, pulsing animation (1s, faster to draw attention)
- Error: rose, static glow
- Completed: muted grey, no glow

**Status Badge**
- Pill shape (10px radius), dim background + coloured text
- Active/Waiting/Error/Completed variants

**Permission Bar**
- Full-width bar below content header
- Amber dim background, amber border, 10px radius
- Icon (32px square, amber border) + text (session name + tool detail) + Approve/Deny buttons
- Stacks vertically if multiple permissions pending
- Slides in with animation (0.3s ease-out)

**Metrics Bar (top)**
- Fixed, never scrolls
- Logo left, metrics centre, actions right
- Metrics: value (large) + label (small uppercase) stacked
- Colour-coded values (green for sessions, amber for attention, blue for tokens)

**Activity Feed (bottom)**
- Collapsible panel, max-height 180px
- Sticky header
- Each row: timestamp (monospace) | session name (blue, truncated) | event description
- Hover highlight

**Command Palette**
- Triggered by Ctrl+K
- Frosted glass overlay (backdrop-filter: blur)
- Centred modal with search input + results list
- Actions: jump to session, approve all, launch new, filter by status

### States

| State | Visual |
|-------|--------|
| Loading | Skeleton cards with shimmer animation matching card dimensions |
| Empty (no sessions) | Centred message: "No active sessions" + "Launch a session or start Claude Code with hooks configured" + primary button |
| Error (server disconnected) | Red banner at top: "Disconnected from Command Centre server. Reconnecting..." with retry countdown |
| Success (permission approved) | Brief green flash on the permission bar before it dismisses. Toast notification: "Approved: [tool] for [session]" |

### Animation / Interaction

| Element | Animation |
|---------|-----------|
| Session card hover | translateY(-1px), box-shadow increase, 0.2s ease |
| Permission bar entry | slideDown 0.3s ease-out (opacity 0→1, translateY -10→0) |
| Permission bar dismiss | slideUp 0.2s ease-in |
| Status dot pulse | opacity 1→0.5→1, 2s infinite (active), 1s infinite (waiting) |
| Card→detail view transition | View Transitions API crossfade (future enhancement) |
| Command palette open | scale 0.95→1, opacity 0→1, 0.15s ease-out |
| Activity feed new item | Brief highlight flash (0.5s) on new rows |
| Toast notification | Slide in from right, auto-dismiss after 5s |

---

## Hosting Model

The dashboard is a **locally-hosted web application**, not a static HTML file. Express serves both the API endpoints (for Claude Code hooks) and the dashboard UI (as static files) from a single server on `localhost:4111`.

```
npx command-centre
  → Express starts on localhost:4111
  → Dashboard served at http://localhost:4111 (opens automatically)
  → Hook endpoints at http://localhost:4111/hooks/*
  → Socket.io WebSocket on same port
```

**Why not a local file?** The dashboard needs a live WebSocket connection to receive real-time session events and send permission decisions back to the server. `file://` pages cannot establish WebSocket connections to `localhost` due to browser security policies.

**Why not a hosted service?** All data stays on-machine. Hook payloads contain file paths and code — they never leave localhost. No accounts, no cloud, no internet dependency.

---

## Page Specifications

### Dashboard (Main View)

**Purpose:** See all sessions at a glance, act on anything that needs attention
**URL:** `/` (root)
**Primary Action:** Approve/deny pending permissions

**Layout:**
```
┌──────────────────────────────────────────────────────────┐
│ METRICS BAR (fixed)                                       │
│ Logo | Sessions | Attention | Tokens | Cost | [Ctrl+K] [+]│
├───────────┬──────────────────────────────────────────────┤
│ SIDEBAR   │ CONTENT HEADER (view toggle: Grid/List)       │
│           ├──────────────────────────────────────────────┤
│ Sessions  │ PERMISSION BAR (if any pending)               │
│ list with ├──────────────────────────────────────────────┤
│ status    │                                              │
│ dots      │ SESSION CARDS GRID                           │
│           │ (auto-fill, min 340px per card)              │
│           │                                              │
│           │                                              │
│           ├──────────────────────────────────────────────┤
│           │ ACTIVITY FEED (collapsible, max 180px)       │
└───────────┴──────────────────────────────────────────────┘
```

**Components:**

| Element | Type | Data Source | Behaviour |
|---------|------|-------------|-----------|
| Metrics bar | Fixed header | Aggregated from all sessions | Always visible, real-time updates via WebSocket |
| Session sidebar | Scrollable list | `sessionsList` from server | Click to highlight card, needs-attention items have amber background |
| Permission bar | Alert banner | `pendingPermissions` from server | Shows when any session has pending permission. Approve/Deny send response via WebSocket. Stacks if multiple. |
| Session cards | Bento grid | `sessionsList` from server | Auto-fill responsive grid. Click to show detail view (future). Hover for elevation. |
| Activity feed | Scrollable log | `eventFeed` from server | Chronological, newest at top. Auto-updates via WebSocket. Max 500 events in memory. |
| New Session button | Primary button | N/A | Opens modal: project dir + name + optional prompt → spawns session |
| Command palette | Modal overlay | All sessions + commands | Ctrl+K trigger. Search/filter/jump/approve-all. |

**States:**
- Loading: Skeleton sidebar items + skeleton cards
- Empty: "No active sessions" message with setup instructions
- Error: Red reconnection banner replaces metrics bar temporarily
- Success: Green toast on approve, card updates status in real-time

### Session Detail View (Future Enhancement)

**Purpose:** Deep-dive into a single session's activity, output, and file changes
**URL:** `/#/session/:id`
**Primary Action:** Monitor progress, approve permissions for this session

This view would replace the grid area when a card is clicked. For MVP, clicking a card highlights it and scrolls the activity feed to show only that session's events.

### New Session Modal

**Purpose:** Launch a new Claude Code session from the dashboard
**Trigger:** "New Session" button or Ctrl+N

**Fields:**
- Project directory (text input with autocomplete from known projects)
- Session name (text input, optional — defaults to folder name)
- Initial prompt (textarea, optional)
- Permission mode (dropdown: default, acceptEdits, bypassPermissions)

**Actions:** Launch (spawns terminal + Claude), Cancel

---

## Responsive Behaviour

| Breakpoint | Behaviour |
|-----------|-----------|
| > 1200px | Full layout: sidebar + 3-column card grid + activity feed |
| 900-1200px | Sidebar collapses to icons only (40px). 2-column card grid. |
| < 900px | Sidebar hidden (hamburger toggle). Single-column cards. Activity feed full-width below cards. |

**Primary target:** Desktop (1920x1080 and above). This is a developer tool — mobile is not a priority. Tablet (landscape) should be usable.

---

## Accessibility

- All interactive elements keyboard-focusable with visible focus rings (2px blue outline)
- Status communicated via text labels AND colour (not colour alone)
- Minimum contrast ratio 4.5:1 for text on backgrounds
- Approve/Deny buttons have descriptive aria-labels including session name and tool
- Activity feed has aria-live="polite" for screen reader announcements
- Command palette supports full keyboard navigation (arrow keys, enter, escape)
- Reduced motion: disable pulse/slide animations when `prefers-reduced-motion: reduce`
