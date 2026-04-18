# Portfolio Extension — Design Research

**Domain:** Portfolio management dashboard for a personal project portfolio (39 projects)
**Context:** Extension to existing "Mission Control" dark-themed developer tool dashboard
**Date:** 2026-04-18

## Current Trends

1. **Layered dark surfaces with semantic depth** — Not flat black but graduated: base > card > elevated > overlay. Linear, Vercel, Railway all use 3-4 tiers. Existing CC already does this well.
2. **Bento grid layouts** — Variable-size cards on CSS Grid. Gate queue gets 2-col-wide cards, metrics get 1x1 tiles. 23% higher engagement than uniform grids.
3. **Command palette as primary navigation** — Cmd+K search-first interfaces (Raycast, Linear, GitHub). For 39 projects, type-to-find beats scrolling.
4. **AI-adaptive layouts** — Dashboards that reorganise based on urgency. Items needing attention float up, healthy items compress.
5. **Aurora/mesh gradient ambient status** — Animated gradients encoding health state peripherally. Cool blue = healthy, warm amber = attention needed.

## Bleeding-Edge Techniques

1. **View Transitions API** — Shared-element transitions between board and detail views. Project card morphs into full detail panel. Now mainstream in Chrome/Edge/Safari 18+.
2. **Scroll-driven animations (CSS)** — `animation-timeline: scroll()` for progressive disclosure without JS. Cards fade in, metrics compress, timeline parallax.
3. **Generative staleness encoding** — Instead of traffic lights: desaturation decay (card colours fade with inactivity), entropy blur (stale cards go slightly soft), border erosion (borders become dashed on neglected projects).

## White Space Opportunities

1. **Portfolio as a living organism** — No tool visualises project interdependencies as a spatial ecosystem with pulsing connections
2. **Governance gate queue as a physical inbox** — No developer tool surfaces approval documents inline with launch-session capability
3. **Ambient peripheral awareness** — Background itself communicating portfolio health without active monitoring
4. **Temporal depth** — Recently active projects visually "closer" (larger, brighter), dormant ones recede (smaller, dimmer)
5. **Documentation compliance as visual texture** — Projects with complete docs have clean borders; missing dictionaries show rough/dashed borders

## Key References

- **Linear** — Project insights, keyboard-first, information hierarchy
- **Vercel Dashboard (2026)** — Projects-as-filters, resizable sidebar
- **Railway** — Spatial service canvas with glowing active nodes
- **Grafana 11** — Composable panels, flame graphs, node topology
- **Horizon UI** — Dark glassmorphism (`backdrop-filter: blur(40px)`)
- **Aceternity UI** — Aurora background CSS component
- **Shadcn Admin** — Command palette, density without clutter
- **Datadog APM** — Health encoded on topology edges
- **Signal DevOps** — Terminal-inspired dark-first infrastructure dashboard
