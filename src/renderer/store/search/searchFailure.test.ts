import { beforeEach, expect, it, vi } from 'vitest'
import { search as searchMusic } from './music/action'
import { listInfos as musicLists, sources as musicSources } from './music/state'
import { search as searchPlaylists } from './songlist/action'
import { listInfos as playlistLists, sources as playlistSources } from './songlist/state'
const mocks = vi.hoisted(() => ({ search: vi.fn(), second: vi.fn() }))
vi.mock('@renderer/utils/musicSdk', () => ({ default: { sources: [{ id: 'tx' }], tx: { musicSearch: { search: mocks.search }, songList: { search: mocks.search } }, wy: { musicSearch: { search: mocks.second }, songList: { search: mocks.second } } } }))
vi.mock('@renderer/utils', () => ({ deduplicationList: (list: unknown[]) => list, toNewMusicInfo: (song: unknown) => song }))
const result = (id: string) => ({ source: 'tx', list: [{ id, name: id, singer: '' }], total: 1, limit: 30, allPage: 1 })
const deferred = () => {
  let resolve!: (value: any) => void
  let reject!: (error: Error) => void
  const promise = new Promise((_resolve, _reject) => { resolve = _resolve; reject = _reject })
  return { promise, resolve, reject }
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('window', { i18n: { t: (key: string) => key } })
})
for (const [name, search, lists] of [['music', searchMusic, musicLists], ['playlists', searchPlaylists, playlistLists]] as const) {
  it(`${name} exposes a recoverable failure without rejecting the UI fire-and-forget call`, async() => {
    await search('', 1, 'tx')
    mocks.search.mockRejectedValueOnce(new Error('搜索失败'))
    await expect(search('failed', 1, 'tx')).resolves.toEqual([])
    expect(lists.tx?.noItemLabel).toBe('list__load_failed')
  })
  it(`${name} retains successful results on failure and allows same-query retry`, async() => {
    mocks.search.mockResolvedValueOnce(result('good'))
    await search('good', 1, 'tx')
    mocks.search.mockRejectedValueOnce(new Error('offline'))
    await expect(search('retry', 1, 'tx')).resolves.toEqual([])
    expect(lists.tx?.list[0].id).toBe('good')
    mocks.search.mockResolvedValueOnce(result('retried'))
    await search('retry', 1, 'tx')
    expect(lists.tx?.list[0].id).toBe('retried')
  })
  it(`${name} ignores old failure after a newer success`, async() => {
    const old = deferred()
    mocks.search.mockReturnValueOnce(old.promise).mockResolvedValueOnce(result('latest'))
    const pending = search('old', 1, 'tx')
    await search('latest', 1, 'tx')
    old.reject(new Error('old failure'))
    await expect(pending).resolves.toEqual([])
    expect(lists.tx?.list[0].id).toBe('latest')
  })
  it(`${name} invalidates an in-flight success when query is cleared`, async() => {
    const old = deferred()
    mocks.search.mockReturnValueOnce(old.promise)
    const pending = search('clear me', 1, 'tx')
    await search('', 1, 'tx')
    old.resolve(result('obsolete'))
    await pending
    expect(lists.tx?.list).toEqual([])
  })
  it(`${name} shows all-provider failure instead of a successful empty result`, async() => {
    mocks.search.mockRejectedValueOnce(new Error('offline'))
    await search('aggregate fail', 1, 'all')
    expect(lists.all.noItemLabel).toBe('list__load_failed')
  })
}

for (const [name, search, lists] of [['music', searchMusic, musicLists], ['playlists', searchPlaylists, playlistLists]] as const) {
  it(`${name} catches synchronous SDK throws and malformed successful results`, async() => {
    mocks.search.mockImplementationOnce(() => { throw new Error('sync transport') })
    await expect(search('sync', 1, 'tx')).resolves.toEqual([])
    mocks.search.mockResolvedValueOnce({ source: 'tx', list: null, total: 1, limit: 30 })
    await expect(search('malformed', 1, 'tx')).resolves.toEqual([])
    expect(lists.tx?.noItemLabel || lists.tx?.error).toBe('list__load_failed')
  })
  it(`${name} resolves cancellation without showing a provider failure`, async() => {
    await search('', 1, 'tx')
    mocks.search.mockRejectedValueOnce(new Error('request cancelled'))
    await expect(search('cancel', 1, 'tx')).resolves.toEqual([])
    expect(lists.tx?.error).toBe('')
    expect(lists.tx?.noItemLabel).toBe('')
  })
  it(`${name} gives repeated identical query attempts separate ownership`, async() => {
    await search('', 1, 'tx')
    const old = deferred()
    mocks.search.mockReturnValueOnce(old.promise).mockResolvedValueOnce(result('new same query'))
    const pending = search('same', 1, 'tx')
    await search('same', 1, 'tx')
    old.reject(new Error('old same-query failure'))
    await pending
    expect(lists.tx?.list[0].id).toBe('new same query')
  })
}

for (const [name, search, lists, sources] of [['music', searchMusic, musicLists, musicSources], ['playlists', searchPlaylists, playlistLists, playlistSources]] as const) {
  it(`${name} retains successful aggregate providers and exposes failed providers for retry`, async() => {
    sources.push('wy')
    try {
      mocks.search.mockResolvedValueOnce(result('qq-good'))
      mocks.second.mockRejectedValueOnce(new Error('wy unavailable'))
      await search('partial', 1, 'all')
      expect(lists.all.list.map(item => item.id)).toEqual(['qq-good'])
      expect(lists.all.error).toContain('wy')
      mocks.search.mockResolvedValueOnce(result('qq-good'))
      mocks.second.mockResolvedValueOnce({ ...result('wy-good'), source: 'wy' })
      await search('partial', 1, 'all')
      expect(lists.all.list).toHaveLength(2)
      expect(lists.all.error).toBe('')
    } finally { sources.pop() }
  })
}
