# Encore Frontend Redesign - Brainstorm Checklist

Date: 2026-10-22
Status: In progress (brainstorming phase)

## Goal
Replace the current Encore frontend design with a 2026 premium look that uses icons
plus words. The result must not be a copy of the current design.

## Current state (audit)
- Stack: React 19 + Vite 8 + Tailwind v4, Supabase (local at 127.0.0.1:54321, currently down).
- Screens: `/` Home, `/join/:roomCode`, `/room/:roomId` (guest), `/room/:roomId/host`.
- Current visual language: warm obsidian dark, gold `#c9a227` + amber `#f08a4b` accents,
  Playfair Display headlines, Manrope UI, DM Mono labels, hand-rolled CSS microphone art,
  488 lines of bespoke CSS in `src/styles.css`.
- No icon library, no animation library installed.

## Checklist
- [x] 1. Explore project context
- [ ] 2. Offer visual companion just-in-time (only if a visual question appears)
- [ ] 3. Ask clarifying questions (one at a time)
- [ ] 4. Propose 2-3 design approaches with trade-offs
- [ ] 5. Present design sections, get approval
- [ ] 6. Write design doc to `docs/superpowers/specs/`
- [ ] 7. Spec self-review (placeholders, consistency, scope, ambiguity)
- [ ] 8. User reviews written spec
- [ ] 9. Invoke writing-plans skill

## Open decisions
- Aesthetic direction (color, type, shape, density).
- Icon library and icon + word balance.
- Light, dark, or dual theme.
- Scope: restyle only vs structural component rework.
