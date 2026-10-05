# Search failure recovery

The reported stack (`tx/musicSearch.js`, `搜索失败`) points to QQ's song-search SDK. The global Songs tab calls that SDK through `store/search/music`; the Playlists tab calls QQ's separate `songList.search` through `store/search/songlist`. Search within a saved playlist calls the local `worker.main.searchListMusic`, not either QQ endpoint.

## Reproduced cause

QQ song search treated every unsuccessful/missing response as retryable, making six identical requests before rejecting with `搜索失败`. Single-provider stores caught the rejection, erased results, assigned the load-failed label, then rethrew it. Both search view hooks used a fire-and-forget `.then` without a rejection handler, allowing that failure to reach the renderer's uncaught-runtime overlay. Their old failure handlers also lacked the current-query check used for success: an older failure could erase a newer successful search. Clearing a song query did not invalidate its old search key.

This chain is reproduced deterministically at the real SDK/store/view boundary. It does not establish which QQ business response or network condition caused the user's intermittent live failure. No fresh live provider reproduction is claimed.

## Behavior after repair

- QQ song and playlist search issue one request per explicit search. Provider refusal, transport failure and malformed successful response are not blindly retried. Successful empty results remain valid. No documented transient business code was available to justify automatic retries; the user can retry explicitly.
- Expected failures are resolved into recoverable store state instead of being rethrown into the view. Both views show a visible error and a keyboard-accessible Retry button, even while retaining earlier successful rows. Failed page/query attempts remain retryable.
- Each store assigns per-source request generations; stale success/failure and completions after query clearing cannot overwrite the current result. Identical queries issued again also receive distinct ownership while pending. Only completed, error-free results are cacheable.
- Aggregate search keeps successful providers and displays the failed providers. An entirely failed aggregate is a failure, not a successful empty search. Cancellation does not appear as provider failure. QQ's existing cancel method still cancels transport and rejects late results; obsolete UI queries also lose state-commit authority.
- Source switching cannot run an old view's deferred scroll against the newly selected result. History persistence failure is contained separately from the search itself.

The previous rows are retained on failure; their pagination metadata remains the metadata of those rows. Retry uses the current query/page supplied by the route, not the retained rows' previous page.

## Evidence and limits

`review9-search-red.log` records 11 failures among 15 initial regressions; `review9-playlist-red.log` records the analogous excessive retry in the separate playlist endpoint. Added tests cover provider refusal, synchronous and asynchronous transport failure, successful malformed response, cancellation, clearing, same-query races, preserving prior rows, aggregate partial/all failures and explicit successful retry. The actual QQ SDK → search store → MusicList hook test establishes the uncaught rejection is contained at its UI boundary.

Run `node e2e/search-template.check.cjs` to compile and typecheck the two actual search views' inline Vue templates. Full main/renderer checks and the existing component harness remain applicable. These tests do not establish native Electron rendering, audible playback or the unknown server-side cause of the user's intermittent response. No new dependency, ADR or persistent setting was introduced.
