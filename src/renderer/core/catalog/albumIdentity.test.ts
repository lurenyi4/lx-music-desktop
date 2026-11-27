import { it, expect, vi } from 'vitest'
import search from '@renderer/utils/musicSdk/tx/musicSearch'
import detail from '@renderer/utils/musicSdk/tx/musicInfo'
import album from '@renderer/utils/musicSdk/tx/album'
import { createCatalogAdapter } from '@renderer/core/catalog/adapter'
import { toNewMusicInfo } from '@common/utils/tools'
const mocks = vi.hoisted(() => ({ fetch: vi.fn() }))
vi.mock('@renderer/utils/request', () => ({ httpFetch: mocks.fetch }))
vi.mock('@renderer/utils/index', () => ({ formatPlayTime: () => '02:00', sizeFormate: () => '1M', decodeName: (n: string) => n }))
vi.mock('@renderer/utils/musicSdk/tx/utils', () => ({ signRequest: vi.fn() }))
it('QQ search result album identity must produce a valid album request', async() => {
  vi.stubGlobal('window', { i18n: { t: (s: string) => s } })
  const raw = { id: 1, mid: 'song-mid', title: 'Song', singer: [{ mid: 'artist-mid', name: 'Artist' }], album: { id: 8220, mid: '003DFRzD192KKD', name: 'Album' }, interval: 120, file: { media_mid: 'media', size_128mp3: 0, size_320mp3: 0, size_flac: 0, size_hires: 0 } }
  const song = toNewMusicInfo(search.handleResult([raw])[0])
  const adapter = createCatalogAdapter({ tx: { album: (id, page, limit) => album.getAlbumDetail(id, page, limit) } })
  const [target] = await adapter.resolve('album', song)
  mocks.fetch.mockReturnValue({ promise: Promise.resolve({ statusCode: 200, body: { code: 0, req: { code: 0, data: { totalNum: 0, songList: [] } } } }) })
  await adapter.load(target)
  expect(mocks.fetch.mock.lastCall![1].body.req.param).toEqual({ albumMid: raw.album.mid, begin: 0, num: 50 })
  vi.unstubAllGlobals()
})
it('legacy saved MID-only metadata remains usable without numeric coercion', async() => {
  vi.stubGlobal('window', { i18n: { t: (s: string) => s } })
  const saved: any = { id: 'tx_saved', source: 'tx', name: 'Song', singer: 'Artist', meta: { songId: 'song-mid', albumId: '003DFRzD192KKD', albumName: 'Album', qualitys: [], _qualitys: {} } }
  const adapter = createCatalogAdapter({ tx: { album: (id, page, limit) => album.getAlbumDetail(id, page, limit) } })
  const [target] = await adapter.resolve('album', saved)
  mocks.fetch.mockReturnValue({ promise: Promise.resolve({ statusCode: 200, body: { code: 0, req: { code: 0, data: { totalNum: 0, songList: [] } } } }) })
  await adapter.load(target)
  expect(mocks.fetch.mock.lastCall![1].body.req.param.albumMid).toBe(saved.meta.albumId)
  expect(mocks.fetch.mock.lastCall![1].body.req.param).not.toHaveProperty('albumID')
  vi.unstubAllGlobals()
})
it('missing album identity resolved by actual exact-song detail uses its returned MID', async() => {
  vi.stubGlobal('window', { i18n: { t: (s: string) => s } })
  const raw = { id: 1, mid: 'song-mid', title: 'Song', singer: [{ mid: 'artist-mid', name: 'Artist' }], album: { id: 8220, mid: '003DFRzD192KKD', name: 'Album' }, interval: 120, file: { media_mid: 'media', size_128mp3: 0, size_320mp3: 0, size_flac: 0, size_hires: 0 } }
  const saved = toNewMusicInfo(search.handleResult([raw])[0]) as LX.Music.MusicInfoOnline
  saved.meta.albumId = ''
  mocks.fetch.mockReturnValueOnce({ promise: Promise.resolve({ body: { code: 0, req: { code: 0, data: { track_info: raw } } } }) })
  const adapter = createCatalogAdapter({ tx: { album: (id, page, limit) => album.getAlbumDetail(id, page, limit), detail: async(music) => detail(music.meta.songId) } })
  const [target] = await adapter.resolve('album', saved)
  mocks.fetch.mockReturnValueOnce({ promise: Promise.resolve({ statusCode: 200, body: { code: 0, req: { code: 0, data: { totalNum: 0, songList: [] } } } }) })
  await adapter.load(target)
  expect(mocks.fetch.mock.lastCall![1].body.req.param).toEqual({ albumMid: raw.album.mid, begin: 0, num: 50 })
  vi.unstubAllGlobals()
})
