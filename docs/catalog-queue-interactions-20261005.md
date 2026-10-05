# Catalog menus, provider audit and editable playback queue

Baseline: `c2eb80e8a691aa6afae63c67e5aa21da153bd194` on `feat/playback-version-queue-catalog`.
Implementation branch: `feat/catalog-queue-interactions-20261005`.

## Root causes and fixes

1. `base/Menu.vue` teleported into `#root` at z-index 10, below the modal container at 99. It now uses 1000, clamps page coordinates to its actual teleport container, scrolls if taller than the viewport, and dismisses on Escape, outside click/scroll and resize. Enter/Space activate enabled menu items; hidden/disabled items are excluded from keyboard tab stops.
2. Catalog close previously retained the OnlineList during the modal exit transition, allowing its teleported menu to survive temporarily. The list now unmounts immediately on close. A late modal exit callback cannot hide a reopened modal.
3. NetEase artist SDK called `.then` on the request object returned by `eapiRequest`. The real API is `.promise.then`. The old test incorrectly mocked a Promise; the regression now mocks the actual request object and reproduced the TypeError before the fix.
4. Several catalog combinations were never integrated, yet their messages blamed the provider. Missing integrations now use `not-integrated` and explicitly say that this app has not integrated that endpoint. Local tracks remain a separate unsupported case; missing IDs, adapter/marked SDK format errors, request failures, and successful empty results remain distinct.
5. The queue was read-only except for clearing pending songs. It now exposes per-row immediate playback, Play Next, add-to-pending, remove, adjacent up/down moves, current-track removal and confirmed clear/stop.

## Source support matrix

“Integrated” means an implementation exists, not that every record, region, account or request is guaranteed to succeed. No name-search results are substituted for artist or album catalogs.

| Source | Artist songs | Album songs | Audit / verification |
| --- | --- | --- | --- |
| Kuwo `kw` | Not integrated | Existing `album.getAlbumListDetail`, ID-based | No existing artist SDK was found. A candidate artist2music request timed out in 12 seconds; this does not prove provider inability. Existing album adapter reused unchanged; live album not verified |
| Kugou `kg` | Existing `singer.getSongList` | Existing `album.getAlbumDetail` | Both fetch real provider lists and enrich exact song hashes; no live provider run in this change. Album info enrichment remains an additional network dependency |
| QQ `tx` | Existing `singer.getSongList` | Added `album.getAlbumDetail` | Shared musicu transport and song converter reused. Numeric album ID or the legacy/search album MID, contiguous `begin=(page-1)*limit`. Live public album 8220 returned HTTP 200, code 0, req.code 0, total 11, two requested songInfo rows on 2026-10-05. A second live MID request (`003DFRzD192KKD`) returned the matching MID, two rows and total 10 |
| NetEase `wy` | Existing implementation repaired | Added `album.getAlbumDetail` | Shared eapi transport and singer song converter reused. Whole-album response sliced locally into stable one-based pages. Request-shape/pagination/empty/error fixtures pass. A separate public album API probe returned business -462, requesting phone binding; no attempt to bypass it. This probe is not a live success/failure test of the eapi integration |
| Migu `mg` | Not integrated | Existing `album.getAlbumDetail` | No artist SDK found. A candidate artist route returned business 299996 “route request unsupported”; no guessed route was shipped. Existing album page-stride fix retained. Album metadata request remains a dependency; no live album verification |
| Local | No provider catalog | No provider catalog | Dedicated message |

Unknown provider/network failures display a retryable request-error message, never “provider does not support catalogs.” Empty successful arrays display the existing empty-result state. Missing IDs still require exact-song metadata; when unavailable, the ID error is explicit.

## Queue semantics

- Queue edits do not delete, reorder or write saved playlists. The first automatic-list edit creates a playback-session copy. Both preview and next/previous playback use that same copy. Explicitly starting a saved playlist or a new selection resets it.
- Current source-song identity and saved-list index are kept separate from the playback-session cursor. Removing an entry before the cursor preserves the anchor, including the valid before-first cursor `-1` while a temporary song is playing.
- Immediate playback consumes just the selected pending occurrence and preserves its siblings. Duplicate pending entries are tracked by object identity; a stale row cannot delete a different equal-ID occurrence.
- Play Next moves the selected future occurrence to the front of pending playback. A current looping anchor is retained. Add to pending explicitly adds another occurrence at the pending tail, ahead of automatic traversal.
- Up/down swaps adjacent displayed entries. Crossing the pending/automatic boundary promotes the automatic entry into pending playback, preserving the resulting visible order. The currently playing loop anchor cannot be moved using a future-repeat row.
- Removing current skips to its successor; with no successor it stops and clears current state. Pending songs retain priority. Single-repeat does not replay a removed current song. Random removal clears the cached next choice.
- Clear requires an inline confirmation and stops playback, clears pending/history, detaches the source and pauses radio refill. Cancel changes nothing. Explicit playlist/radio start can resume ordinary behavior.
- Playback-mode settings are never rewritten. Sequential and list-loop traversal honor the edited session list; random preview still promises only the already-resolved next candidate, so automatic random rows cannot be reordered. Pending rows remain ordered and editable in random mode.
- Queue controls use native buttons with keyboard focus, labels and pointer hit targets. The panel scrolls within its modal instead of clipping the confirmation controls.

## Verification and limitations

Final automated checks on 2026-10-05:

- Full Vitest suite: **78 files, 1061 tests passed** (one worker)
- Menu/modal source-contract regressions: **4 passed**
- Full renderer TypeScript: passed, zero diagnostics
- Full main-process TypeScript: passed, zero diagnostics
- Actual inline Vue template TypeScript check: passed
- Original ESLint rules against all changed/new production and unit-test files: passed; no rules weakened
- Actual component harness webpack compilation: passed
- Actual Modal/OnlineList/Menu event chain in jsdom: five DOM propagation/selection/lifecycle cases passed (included by the full Vitest driver; not browser layout/native gesture evidence)
- `git diff --check`: passed
- Production Electron packaging/audio playback and actual UI execution: not verified, as detailed below

Regression logs are retained in the implementation workspace: menu source checks first failed 3/3, then passed; artist transport and missing-album tests failed before implementation; queue mutation tests began with missing implementation; radio-clear test reproduced unintended refill eligibility before the fix. Additional cursor, playback-mode, duplicate and stale-row assertions extend those regressions.

A reproducible component browser harness lives in `e2e/catalogQueue/`. It compiles the actual Menu, Modal, MusicCatalogModal, OnlineList (including its real menu and double-click playback hooks), PlaybackQueue and queue mutation module. Data, audio/network/IPC, virtualized layout, selection side effects and download/dialog boundaries are fixture substitutes; the Modal click.stop boundary and OnlineList row/menu handlers are not replaced. It is **not** a full Electron integration test.

```sh
node node_modules/webpack-cli/bin/cli.js --config e2e/catalogQueue/webpack.config.cjs
node e2e/catalogQueue/check.cjs
# DOM event regression without a browser (also invoked by the Vitest suite):
npm run test:catalog-dom
```

The bundle compiled successfully. Browser execution was blocked in this environment: Chromium cannot create its process-singleton socket (`Operation not permitted`), including a tool-approved isolated retry. The cloud browser rejected `file://` by URL policy. No actual UI screenshot, hit-testing pass, native Windows right-click or macOS two-finger gesture pass is claimed. The harness remains executable in an environment that permits Chromium; full Electron/audio and native touch/gesture validation are outstanding.

## Independent-review remediation

The first independent reviews rejected the initial implementation. Their five converter/lifecycle/race counterexamples were added as production-boundary regressions and reproduced as five failures before these fixes. Additional original-source checks reproduced the saved-list watcher skip and the delayed stop event. The prior unit-only boolean check is not the evidence for radio cancellation.

- QQ album transport now distinguishes numeric IDs from MID strings and validates numeric IDs. The same provider endpoint was live-verified with `albumMid`; real search conversion, persisted MID-only songs and exact-song detail conversion are covered end-to-end. This preserves legacy saved metadata without rewriting every ingestion path or coercing MIDs to NaN.
- Clear uses the existing finite-selection music-change cancellation barrier, which synchronously calls the recommendation lifecycle's `endSession`. It invalidates the recommendation epoch, in-flight plans, debounce/reanchor and retry timers while preserving the radio setting. Real recommendation-session tests cover initial work, automatic in-flight refill, scheduled refill/reanchor, retry, explicit restart, remaining count, path consumption and session cleanup.
- A moved pending occurrence retains its complete object and `recommendationSessionId`, including when Vue presents a proxied row. Explicit manual duplication remains separate.
- Preview, next, previous and current removal share a narrow playback-context validity check. Random preview consumers share one in-flight worker choice per valid context; old completions cannot publish into a new context. Tests cover reverse generation completion, remove/clear/restart during filtering, concurrent preview/playback, pending priority and restarting the same music object.
- Delayed stop notification and delayed empty-current cleanup are guarded by a playback-start epoch. Traversal invalidation uses a separate epoch so clear's own queue update does not suppress its legitimate stop notification.
- Saved-list watcher highlighting still updates, but removal/clear of the original list cannot auto-skip a current song retained in the session snapshot. Real store index calculation is exercised with the actual watcher; ordinary non-snapshot removal still advances playback.

The second review-round logs are the `*-review2.log` files alongside the checkout; original failures remain in `review-regressions-red.log`, `watch-list-red.log`, `stop-race-red.log` and `queue-proxy-red.log`. Browser restrictions and the lack of native UI/audio proof are unchanged. These fixes require fresh independent review.

## Third review-round remediation

The second independent reviews found a late-pending gap in current removal and a state mutation inside the real filter helper that the upper cancellation guard could not protect. These were reproduced before fixing them with a new production-boundary test suite that imports the actual player actions, queue actions, store actions, filter helper and worker filter. Only the worker RPC completion is delayed (with structuredClone at its boundary); the filter and history-reset implementations are not mocked.

- `filterList` now snapshots the input history and returns `shouldResetPlayedList` with its filtered data. It never clears shared playback history. Preview, next and previous commit a round reset only after their existing context check; forward traversal also gives any newly pending song priority before committing. Tests cover stale completions after clear/restart for preview/next/previous, preserved new history and exclusion of the new current track, a pure direct helper call, and normal exhausted-round rollover.
- Current removal uses the same pending-consumption helper before filtering and again after validating the awaited result. A pending song appended through the real store, including a real recommendation session result, wins over an automatic successor and is not cleared when the removed song was the source's last entry. An invalidated removal cannot consume a restarted session's pending songs.
- QQ/NetEase album SDKs mark successful but uninterpretable payloads with a small `MusicSdkResponseError`; the catalog adapter maps it to the existing response-format error. Real SDK → adapter → controller tests separate format failure, transport failure, provider business refusal and valid empty results. This classification is not asserted for arbitrary unmarked errors from legacy SDKs.

Red evidence: `review3-worker-red.log` (seven failing production-boundary cases) and `review3-schema-red.log` (two wrong controller classifications). Final checks are in `all-tests-review3.log`, `lint-review3.log`, `renderer-typecheck-review3.log`, `main-typecheck-review3.log`, `vue-typecheck-review3.log`, `ui-build-review3.log` and `menu-green-review3.log`. Actual browser/native gesture/audio limitations remain unchanged. A fresh pair of independent reviews is required before publication.

## Fourth review-round remediation

- Outside-menu click handling is now registered and removed in document capture phase. This reaches the handler before the real Modal's `click.stop` bubble boundary. The existing menu containment check still lets a menu item execute once before dismissal.
- The browser fixture now mounts the actual production OnlineList, Menu, Modal, catalog modal, menu hook and playback-click hook. Five jsdom event-contract tests first reproduced outside title/footer/row dismissal failures and then passed after the capture fix. They assert the actual Modal still stops bubbling, the real right-click selection sentinel resets, subsequent row double-click reaches playback, an inside menu action fires exactly once, and close/reopen unregisters/reinstalls one capture listener. A Vitest driver automatically builds and runs these checks in an isolated generated output directory. `jsdom@26.1.0` is a pinned development-only dependency compatible with the repository's Node 22 minimum; it is not added to production playback.
- The NetEase album adapter validates necessary provider song IDs in the requested page before the permissive legacy singer converter can silently discard rows. Real SDK → adapter → controller regressions cover missing/null/zero/negative/non-numeric IDs, valid numeric/string IDs, a mixed valid/invalid page, unchanged valid-empty behavior, and retaining earlier loaded songs after a malformed subsequent page.

Evidence: `review4-menu-red.log` shows four DOM failures before capture (three outside targets plus capture lifecycle); `review4-schema-red.log` shows five previously swallowed row failures. Green DOM evidence is `review4-menu-green.log`; the normal full-suite driver and final checks are in the `*-review4.log` files. DOM simulation establishes event propagation and handler behavior only. Browser layout/hit-testing, native gestures and audio remain unverified under the previously documented environment limits.

## Fifth review-round remediation

The fourth full review found three normal-flow counterexamples despite the passing suite. The reviewer fixture was incorporated as `queueNormalFlows.test.ts`; all three assertions failed against the previous production code before fixing it. The suite now has 21 production-boundary cases using the real list reducer, manual-version helpers, playback actions/store and worker filter.

- Session isolation retains membership/order, while authoritative saved-song metadata updates replace matching session objects by list ID and stable song ID. Explicit manual-version confirmation also refreshes matching pending/history occurrences without dropping their ownership metadata or restarting an unrelated current song. Tests cover current/future versions, single/list loop, saved-list deletion, unrelated lists and in-flight future metadata updates with/without a snapshot.
- Current removal uses the central next-candidate resolver. A temporary overlay leaves its source anchor intact, including first/last single-loop anchors; only actual source-anchor removal applies the single-loop successor offset. Pending priority and random played-history exclusion remain shared with ordinary traversal.
- Playback ownership is distinct from traversal context. Next/previous/current-removal requests abandon results when a newer playback start/stop/clear owns the player, but iteratively recalculate when the same owner has a revised queue/mode/metadata. Each retry waits for one worker request, with no recursive retry or independent framework. Natural ended advancement therefore survives enqueue, removal, reordering and mode changes without requiring another ended event. Source-current deletion claims ownership through the existing stop epoch before removing its anchor, preventing an older ended request from racing it; both worker completion orders are covered.

Red evidence is `review5-normal-red.log` (the original three real-flow failures). Expanded green coverage is `review5-normal-green.log`; final full-suite/lint/main/renderer/inline-template checks are retained in the `*-review5.log` files. The full suite recompiles the actual component harness and runs all five DOM contracts. Browser/native gesture/audio limitations remain unchanged. These fixes still require two fresh independent reviews before publication.

## Sixth review-round remediation

The fifth full review found that stopping source-current removal invalidated playback traversal but left an in-flight URL operation authorized while the removed song remained visible awaiting its successor. Both independent production-action and actual audio-plugin probes reproduced the removed URL being restored after stop.

The existing `stop()` boundary now increments `musicUrlRequestId`, clears `gettingUrlId` and cancels the two existing load/error-skip timers. This reuses the existing request guards for success, failure and source-progress callbacks; old `finally` cleanup cannot touch a newer request. Clearing the loading identity permits explicit same-song resume to issue a new request. The playback-epoch guard on delayed stop notifications remains in place. No new cancellation state or engine was introduced.

Eleven tests mount the actual player plugin with a minimal Audio object and delay only transport/worker boundaries. They cover removed-source URL success/failure, stale source-progress notifications, successor loading, stop/resume of the same song, old completion preserving the new loading timer, delayed stop notification protection, clear/empty-queue stop followed by restart, an already scheduled error skip and a transport that never settles. This proves actual `setResource`/autoplay configuration and timer ownership, not audible playback or browser rendering.

Evidence: `review6-url-red.log` retains the two independent old-code failures; `review6-expanded-red.log` retains seven expanded old-code failures; `review6-original-green.log` reruns both original probes after the fix. The final suite and lint/type/source-contract results are in the `*-review6.log` files; the suite also recompiles the real component harness and runs its five DOM cases. Publication remains gated on two fresh independent reviews.

## Seventh review-round remediation

The sixth full review reproduced the same URL cancellation gap for temporary current songs: the source-only stop condition left an online/pending overlay authorized to restore its audio while waiting for the source successor. Every current removal now stops through the existing cancellation boundary. Temporary removal retains the source membership/cursor; an already resolved, still-valid random preview is captured synchronously and consumed after stop (pending entries still win), while unresolved old work is invalidated. No removed audio request remains active to preserve a preview. Tests exercise temporary URL success/failure/never-settling transport, normal successor loading, explicit same-song new ownership, pending priority and preserving an already resolved random choice. Existing temporary single-repeat first/last-anchor tests still pass.

QQ album rows now require the converter's actual song MID to be a nonempty string before conversion. Missing/null/empty/whitespace/non-string MID and mixed valid/invalid pages become the existing response-format error. Valid empty albums remain successful; earlier valid pages and retry cursors remain intact if a later page is malformed. No numeric-ID substitution or silent row dropping was added.

Evidence: `review7-original-red.log` and `review7-original-green.log` retain the two independent production-boundary probes before/after repair. Expanded focused tests are in `review7-expanded-green.log`; final full-suite, lint, main/renderer/inline-template and menu source checks are the `*-review7.log` files. The full suite compiles the actual component harness and runs its five DOM cases. Native UI/gesture and audible hardware playback remain unverified, and publication still requires fresh independent review.

## Eighth review-round remediation

The seventh full review found an integration gap in the existing `usePlayEvent` consumer: its media-error callback deferred registration of a five-second skip without retaining the originating playback owner. Queue clear/restart or remove-to-pending could finish before registration, letting obsolete work acquire the new owner's authority at `playNext`. This consumer race predates the queue edits; it is not attributed to the seventh-round repair.

The consumer now captures the existing playback owner when scheduling error work and validates it at both deferred registration and execution. Both phases share the existing cancellable timer handle, so repeated errors retain one skip. Healthy playing, replacement-resource emptied, music changes, stop and unmount clean up scheduled work. The failed resource's own `setStop` can also emit emptied while its source is empty; that notification preserves the legitimate error skip, while the owner guard still rejects a stopped/replaced playback. Its existing loading timeout also retains the originating owner before refreshing or skipping.

The actual Audio/consumer fixture now has 30 cases, including the two original failures, healthy new-resource cleanup before/after registration, repeated errors, clear without restart, same-object replay, normal media-error skipping (including the failed resource's own emptied notification), and normal versus stale loading refresh. The fixture uses real handlers with fresh EventEmitters and controlled transport/timers; invoking the hook without a mounted component emits a Vue lifecycle warning. This does not establish native browser scheduling or hardware sound behavior.

Evidence: `review8-original-red.log` shows the two actual consumer failures with 18 controls passing, and `review8-original-green.log` shows all 20 passing after repair. Expanded coverage is `review8-expanded-green.log`; final aggregate/lint/type/menu results are in the `*-review8.log` files, including actual component harness compilation and DOM contracts. Native UI/audio limitations and independent publication gates remain unchanged.

## Ninth stage: requested search failure recovery

The user additionally reported QQ `musicSearch` uncaught runtime errors. The reproducible SDK → store → view rejection chain, request races, visible retry behavior and live-provider uncertainty are documented in [Search failure recovery](search-error-recovery-20261005.md). This stage also handles the separate playlist-search view and QQ playlist endpoint; local saved-list filtering does not use that endpoint. Cycle-eight's frozen patch remains available separately; this combined candidate requires fresh focused and full independent reviews.

Final ninth-stage checks are the `*-review9.log` files. They include 78 files / 1061 tests, original lint rules, renderer/main types, existing inline catalog/queue templates, and both new search view inline templates via `e2e/search-template.check.cjs`. The full suite recompiles the real component harness and runs five DOM contracts. Native UI/audio and live-provider limits remain unchanged.

No ADR was changed. Publication requires independent review; this document is not self-approval.
