import { describe, expect, it, vi } from 'vitest'
import { createCatalogController, createCatalogState } from './controller'
import { type CatalogPage, type CatalogTarget } from './types'
const song = (id: string): LX.Music.MusicInfoOnline => ({ id, source: 'wy', name: id, singer: 'Artist', interval: null, meta: { songId: id, albumName: 'Album', qualitys: [], _qualitys: {} } })
const target: CatalogTarget = { kind: 'artist', source: 'wy', id: 7, name: 'Artist' }
const page = (id: string, num = 1, more = false): CatalogPage => ({ list: [song(id)], page: num, limit: 1, total: 2, hasMore: more })
const deferred = <T>() => {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((_resolve, _reject) => { resolve = _resolve; reject = _reject })
  return { promise, resolve, reject }
}
describe('catalog request lifecycle', () => {
  it('keeps songs on a failed next page and retries that exact page', async() => {
    const load = vi.fn().mockResolvedValueOnce(page('a', 1, true)).mockRejectedValueOnce(Error('offline')).mockResolvedValueOnce(page('b', 2))
    const state = createCatalogState()
    const controller = createCatalogController(state, { resolve: async() => [target], load })
    await controller.open('artist', song('origin'))
    await controller.loadMore()
    expect(state.error).toContain('重试')
    expect(state.list.map(s => s.id)).toEqual(['a'])
    expect(state.page).toBe(1)
    await controller.retry()
    expect(load.mock.calls[2]).toEqual([target, 2, 1])
    expect(state.list.map(s => s.id)).toEqual(['a', 'b'])
    expect(state.hasMore).toBe(false)
  })
  it('ignores a response after close', async() => {
    const pending = deferred<CatalogPage>()
    const state = createCatalogState()
    const controller = createCatalogController(state, { resolve: async() => [target], load: async() => pending.promise })
    const opened = controller.open('artist', song('origin'))
    await Promise.resolve()
    controller.close()
    pending.resolve(page('late'))
    await opened
    expect(state.show).toBe(false)
    expect(state.list).toEqual([])
  })
  it('ignores an older detail response after a newer catalog is opened', async() => {
    const pending = deferred<CatalogTarget[]>()
    const resolve = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValueOnce([{ ...target, id: 8, name: 'New artist' }])
    const state = createCatalogState()
    const controller = createCatalogController(state, { resolve, load: async() => page('new') })
    const old = controller.open('artist', song('old'))
    await controller.open('artist', song('new'))
    pending.resolve([target])
    await old
    expect(state.target?.id).toBe(8)
    expect(state.list[0].id).toBe('new')
  })
  it('requires a choice for collaborations and suppresses duplicate load-more clicks', async() => {
    const pending = deferred<CatalogPage>()
    const load = vi.fn(async() => pending.promise)
    const state = createCatalogState()
    const controller = createCatalogController(state, { resolve: async() => [target, { ...target, id: 8 }], load })
    await controller.open('artist', song('origin'))
    expect(load).not.toHaveBeenCalled()
    const chosen = controller.select(target)
    await controller.loadMore()
    expect(load).toHaveBeenCalledTimes(1)
    pending.resolve(page('a'))
    await chosen
  })
  it('surfaces repeated provider pages rather than claiming a complete catalog', async() => {
    const state = createCatalogState()
    const controller = createCatalogController(state, { resolve: async() => [target], load: async() => page('a', 1, true) })
    await controller.open('artist', song('origin'))
    await controller.loadMore()
    expect(state.error).toContain('未返回新的')
    expect(state.hasMore).toBe(true)
    expect(state.page).toBe(1)
  })
})
