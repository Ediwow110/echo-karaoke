# Search-only Song Entry

## Approved direction

Remove the separate YouTube paste-link form from the normal song search panel on both host and guest screens. Search results retain their existing Add/Added controls, duplicate protection, loading/error states, guest permission checks, and queue updates. The normal search state stays free of a paste form.

The alternative of hiding the form only for hosts was rejected in favor of consistent search-only entry.

**Post-audit reliability exception (2026-10-24):** the normal panel remains search-only, but when search is not configured, resting, or unavailable, it shows a clearly labeled manual YouTube-link fallback. This is a resilience control for the global search budget, not the old always-visible paste form.

## Scope

- Remove `PasteSongForm` from `SongSearchPanel` and delete the now-unused component.
- Replace frontend and server search/suggestion messages that recommend pasting links with configuration, retry, or next-day guidance appropriate to the actual error.
- Update guest, shared-panel, and browser tests to add songs using search results instead of pasted links.
- Preserve queue APIs, video metadata handling, YouTube video parsing utilities used elsewhere, and existing search behavior.
- Preserve all earlier performance fixes and unrelated user changes. Work stays in this checkout, uncommitted; no push or deployment.

## Acceptance criteria

1. The normal host and guest search state shows no paste-link form or separate Add to queue button. A labeled manual-link fallback may appear only when search is unavailable or at its limit.
2. Searching and pressing a result's Add button still adds that song; already-queued songs and host-locked guest requests cannot be added again.
3. Search and suggestion errors do not recommend a removed control.
4. Focused tests, the full unit suite, and the build pass; the running app is visually checked through Playwright MCP.

## Design checklist

- [x] Inspect component callers, search messages, and affected tests.
- [x] Decide whether visual mockups are necessary: no layout choice or new component is involved.
- [x] Clarify scope: user chose host and guest removal.
- [x] Compare removal vs host-only hiding; choose shared removal.
- [x] Present and receive approval for the direction.
- [x] Write and self-review this specification.
- [x] Obtain written-spec approval and create the implementation plan.
