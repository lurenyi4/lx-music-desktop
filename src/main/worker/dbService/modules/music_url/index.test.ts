import { beforeEach, expect, it, vi } from 'vitest'

const rows = vi.hoisted(() => new Map<string, string>())
vi.mock('./dbHelper', () => ({
  queryMusicUrl: (id: string) => rows.get(id) ?? null,
  insertMusicUrl: (items: LX.Music.MusicUrlInfo[]) => {
    for (const { id, url } of items) rows.set(id, url)
  },
  clearMusicUrl: () => { rows.clear() },
}))
beforeEach(() => { rows.clear(); vi.resetModules() })

it('换源 URL 的提供方身份与 URL 一起持久化，模块重载后仍可恢复', async() => {
  const cache = await import('./index')
  const musicInfo: LX.Music.MusicInfoOnline = {
    id: 'wy_resolved',
    source: 'wy',
    name: 'Song',
    singer: 'Artist',
    interval: null,
    meta: { songId: 'resolved', albumName: '', qualitys: [], _qualitys: {} },
  }
  const entry = { id: 'kw_original_128k', url: 'https://example.test/audio', musicInfo }
  cache.musicUrlSave([entry])
  vi.resetModules()
  const reloaded = await import('./index')
  expect(reloaded.getMusicUrl(entry.id)).toEqual(entry)
  reloaded.musicUrlSave([{ id: entry.id, url: 'https://example.test/direct' }])
  expect(reloaded.getMusicUrl(entry.id)).toEqual({ id: entry.id, url: 'https://example.test/direct' })
  reloaded.musicUrlClear()
  expect(reloaded.getMusicUrl(entry.id)).toBeNull()
})

it('直接 URL 缓存和缓存未命中保持原语义', async() => {
  const cache = await import('./index')
  rows.set('wy_direct_128k', 'https://example.test/direct')
  expect(cache.getMusicUrl('wy_direct_128k')).toEqual({ id: 'wy_direct_128k', url: 'https://example.test/direct' })
  expect(cache.getMusicUrl('missing')).toBeNull()
})
