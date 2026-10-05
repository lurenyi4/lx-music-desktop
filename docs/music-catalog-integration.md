# Artist and album catalogs

## Behavior

Artist and album labels in online results, saved music lists and playback detail open a provider-scoped catalog modal. Labels use the selected version's metadata (`meta.toggleMusicInfo`) without rewriting the saved song identity. The modal uses the existing OnlineList, including play, play-later, add-to-list and download actions.

- Artist catalogs: Kugou (`kg`), QQ Music (`tx`), NetEase (`wy`)
- Album catalogs: Kuwo (`kw`), Kugou (`kg`), Migu (`mg`), QQ Music (`tx`), NetEase (`wy`)
- Missing provider/kind integrations explicitly say “not integrated”; local tracks have a dedicated message
- Collaborations expose each provider-identified artist as a choice
- Missing artist IDs are resolved from the exact song detail by original song ID/hash, never a name search
- Missing IDs after detail lookup show an explicit metadata error
- Pages load on demand. Earlier songs remain usable after an error; retry requests the same failed page
- Unknown totals are displayed as unknown: even a short nonempty page offers another page, and an empty response ends traversal
- Repeated/empty pages before a known total are reported as incomplete rather than repeatedly appended
- Closing or opening another catalog invalidates stale detail/page responses

“Complete” refers only to traversal of the provider's catalog endpoint, not a promise that the provider has all releases. Provider totals and loaded counts remain separately visible; missing final records produce an explicit partial-results label. Songs are never fabricated from search results.

## Portable contracts

`LX.Music.CatalogArtist = { id: string | number, name: string }`

`MusicInfo.meta.artists?: CatalogArtist[]` is preserved by old/new music conversion. IDs are provider-scoped. QQ IDs must be singer `mid`, not numeric singer ID. Existing SDK search/detail/list transforms preserve returned IDs.

The pure `core/catalog/adapter.ts` accepts injected `CatalogProviders`:

- `artist(id, page, limit)` / `album(id, page, limit)` return raw SDK songs and optional total/page size
- `detail(music)` returns exact-song artists and/or album metadata
- `resolve(kind, music)` returns one or more CatalogTarget values
- `load(target, page, limit)` returns `{ list, page, limit, total: number | null, hasMore }`
- All public pages are one-based
- `albumPageSize: 'response-length'` handles Migu's SDK reporting album total as page size; the first response determines page stride

`controller.ts` is UI-independent. State is injected and can be made reactive by any UI. It owns request revisions, artist choice, load-more state and failed-page retry.

Desktop entry point: `openMusicCatalog('artist' | 'album', musicInfo)` from `core/catalog`. `CatalogLink.vue` provides a keyboard-accessible, row-click-safe entry point.

## Existing SDK repairs

- QQ singer mapping now returns its mapped array
- QQ/NetEase song and album offsets use `(page - 1) * limit`, preserving page 2
- NetEase singer songs support both old and current artist/album fields, optional privileges, and millisecond durations
- Kugou exact-song detail requests author IDs along with author names

## Verification

For the 2026-10-05 provider audit, queue semantics and current verification boundaries, see [catalog and queue interactions](catalog-queue-interactions-20261005.md). The results below describe the original catalog delivery.

- 17 focused Vitest assertions (single fork, 512 MB): conversion, exact-ID resolution, provider support, collaborators, pagination, partial/empty/unknown totals, Migu stride, close/new-open races, failed-page retry, repeated-page detection, QQ/NetEase response mapping
- Isolated pure adapter/controller TypeScript check passed
- SDK/store boundary check: zero diagnostics in catalog code; transitive existing/environment diagnostics prevent claiming a full renderer typecheck
- Five affected Vue script/template compiles passed; new CatalogLink and modal CSS compiles passed
- Default whole-project ESLint exceeded the 512 MB heap limit. A focused TypeScript project then passed the original ESLint rules for all catalog, SDK and modified entry-point files; no rules were weakened. No production build was attempted
- Live provider/network behavior and a packaged desktop smoke test remain unverified

Run focused tests:

```sh
NODE_OPTIONS=--max-old-space-size=512 node node_modules/vitest/vitest.mjs run src/renderer/core/catalog --maxWorkers=1 --minWorkers=1 --pool=forks
```
