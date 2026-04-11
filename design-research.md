# Design Research: Command Centre

**Domain:** Real-time AI coding session monitoring & management
**Date:** 2026-04-11
**Research basis:** Web search + training knowledge (live search limited)

## Current Trends

1. **Dark-mode-first with layered depth** — Not flat black but layered surfaces (#0a0a0a base, #111 cards, #1a1a1a hover). Vercel, Linear, Railway all use this. Creates depth without borders.
2. **Bento grid layouts** — Variable-size panels (1x1, 2x1, 2x2) creating visual hierarchy. Maps perfectly to session monitoring: large panel for primary session, smaller for background.
3. **Terminal aesthetic** — Monospace fonts, green-on-black accents, scanline effects. Warp terminal, Fig. Signals "power user tool."
4. **Real-time streaming patterns** — Token-by-token streaming, live log tailing, pulse/breathing animations on active elements, presence indicators (green dots, animated rings).
5. **Selective glassmorphism** — Frosted glass for overlays and floating panels. backdrop-filter: blur() over textured backgrounds.

## Bleeding Edge

1. **View Transitions API** — Shared-element transitions between states. Session card expanding smoothly into detail view.
2. **Scroll-driven animations + Container queries** — Components responsive to their own size, scroll-position-aware effects in pure CSS.
3. **WebSocket + SSE with optimistic UI** — SSE for server→client updates, WebSocket for bidirectional control. Instant UI updates reconciled with server.

## White Space (What Nobody Is Doing)

- No polished web-based real-time command centre for AI coding sessions exists
- Session health visualised as "vitals" (tokens/sec, error rate, context usage %)
- Command palette (Cmd+K) as primary navigation across sessions
- Ambient indicators (colour shifts, subtle animations) for session health without active watching
- Picture-in-picture session previews on hover

## Competitor Visual Analysis

| Tool | UI Type | Strength | Gap |
|------|---------|----------|-----|
| Claude Squad | Terminal TUI | Live output, vim-like navigation | No aggregate view, no metrics, no web UI |
| CCManager | Terminal TUI | Process lifecycle management | Minimal content visibility |
| claude-view | Web viewer | Markdown rendering, tool usage display | Retrospective, not real-time. macOS only. |
| Nimbalyst | Web dashboard | Workflow orchestration | Not specifically Claude Code monitoring |

## Key References

1. **Linear** — Gold standard dev tool UI. Keyboard-first, instant feel, smooth transitions
2. **Vercel Dashboard** — Clean monitoring: deployment status, real-time logs, streaming output
3. **Grafana 11** — Dynamic composable panels, time-series visualization, dark theme
4. **Railway** — Spatial canvas for services, service graph view with connected nodes
5. **Warp Terminal** — Terminal-meets-modern-UI. Block-based output, AI integration
6. **Datadog APM** — Real-time trace visualization, flame graphs, service maps
7. **GitHub Actions** — Workflow run visualization (steps, timing, expandable logs)
8. **Raycast** — Command palette as primary UX pattern

## Patterns for Real-Time Session Monitoring

**Status indicators:** Pulsing green (active), steady green (idle), amber (waiting), red (error), grey (done), animated ring (executing tool)

**Session cards:** Name, current task, time active, token count, last output preview. Subtle "breathing" animation when active.

**Aggregate metrics bar:** Total sessions | Tokens used | Errors | Files modified — with sparkline charts

**Layout pattern:** Top metrics bar → Left session list → Main area (grid overview or focused session) → Bottom activity feed
