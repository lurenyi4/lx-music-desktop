import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCatalogAdapter } from './adapter'
import { createCatalogController, createCatalogState } from './controller'
import { createI18n } from '../../../lang'
import wyAlbum from '@renderer/utils/musicSdk/wy/album'
import txAlbum from '@renderer/utils/musicSdk/tx/album'
const mocks = vi.hoisted(() => ({ httpFetch: vi.fn(), eapiRequest: vi.fn() }))
vi.mock('@renderer/utils/request', () => ({ httpFetch: mocks.httpFetch }))
vi.mock('@renderer/utils/index', () => ({ formatPlayTime: (seconds: number) => String(seconds), sizeFormate: () => '1M', decodeName: (name: string) => name }))
vi.mock('@renderer/utils/musicSdk/wy/utils/index', () => ({ eapiRequest: mocks.eapiRequest }))
beforeEach(() => {
  vi.clearAllMocks()
  const i18n = createI18n(); i18n.setLanguage('en-us')
  vi.stubGlobal('window', { i18n })
})
afterEach(() => { vi.unstubAllGlobals() })
const albumSong = (source: 'tx' | 'wy'): LX.Music.MusicInfoOnline => {
  const base = { id: `${source}_song`, name: 'Song', singer: 'Artist', interval: null, meta: { songId: 'song', strMediaMid: 'media', albumId: 8, albumName: 'Album', qualitys: [], _qualitys: {} } }
  return source === 'tx' ? { ...base, source } : { ...base, source }
}

describe('album adapters use provider IDs and real transport contracts', () => {
  it('NetEase slices a complete album response without repeatedly appending page one', async() => {
    const songs = [1, 2, 3].map(id => ({ id, name: `${id}`, ar: [{ id: 7, name: 'Artist' }], al: { id: 8, name: 'Album' }, dt: 120000 }))
    mocks.eapiRequest.mockReturnValue({ promise: Promise.resolve({ body: { code: 200, songs } }) })
    expect(await wyAlbum.getAlbumDetail(8, 2, 2)).toMatchObject({ total: 3, limit: 2, page: 2, list: [{ songmid: 3 }] })
    expect(mocks.eapiRequest).toHaveBeenCalledWith('/api/v1/album/8', {})
    expect(await wyAlbum.getAlbumDetail(8, 3, 2)).toMatchObject({ list: [], total: 3 })
  })
  it('NetEase distinguishes an empty album from malformed/failed responses', async() => {
    mocks.eapiRequest.mockReturnValueOnce({ promise: Promise.resolve({ body: { code: 200, songs: [] } }) })
    expect(await wyAlbum.getAlbumDetail(8)).toMatchObject({ list: [], total: 0 })
    mocks.eapiRequest.mockReturnValueOnce({ promise: Promise.resolve({ body: { code: 500 } }) })
    await expect(wyAlbum.getAlbumDetail(8)).rejects.toThrow()
  })
  it('QQ uses numeric album IDs and one-based contiguous offsets', async() => {
    const songInfo = { id: 1, mid: 'song', title: 'Song', singer: [{ mid: 'artist', name: 'Artist' }], album: { id: 8, mid: 'album', name: 'Album' }, interval: 120, file: { media_mid: 'media', size_128mp3: 0, size_320mp3: 0, size_flac: 0, size_hires: 0 } }
    mocks.httpFetch.mockReturnValue({ promise: Promise.resolve({ statusCode: 200, body: { code: 0, req: { code: 0, data: { totalNum: 3, songList: [{ songInfo }] } } } }) })
    expect(await txAlbum.getAlbumDetail(8, 2, 2)).toMatchObject({ total: 3, limit: 2, page: 2, list: [{ songmid: 'song', albumId: 8 }] })
    expect(mocks.httpFetch.mock.lastCall![1].body.req).toEqual({ module: 'music.musichallAlbum.AlbumSongList', method: 'GetAlbumSongList', param: { albumID: 8, begin: 2, num: 2 } })
  })
  it('QQ rejects malformed rows instead of silently showing an empty catalog', async() => {
    mocks.httpFetch.mockReturnValue({ promise: Promise.resolve({ statusCode: 200, body: { code: 0, req: { code: 0, data: {} } } }) })
    await expect(txAlbum.getAlbumDetail(8)).rejects.toThrow()
  })
})

it.each(['tx', 'wy'] as const)('%s malformed success reaches the real controller as a response-format error', async(source) => {
  mocks.httpFetch.mockReturnValue({ promise: Promise.resolve({ statusCode: 200, body: { code: 0, req: { code: 0, data: {} } } }) })
  mocks.eapiRequest.mockReturnValue({ promise: Promise.resolve({ body: { code: 200, songs: null } }) })
  const sdk = source === 'tx' ? txAlbum : wyAlbum
  const adapter = createCatalogAdapter({ [source]: { album: (id: string | number, page: number, limit: number) => sdk.getAlbumDetail(id, page, limit) } })
  const state = createCatalogState()
  const controller = createCatalogController(state, adapter)
  await controller.open('album', albumSong(source))
  expect(state.error).toBe(window.i18n.t('catalog__invalid_response'))
  expect(state.error).not.toBe(window.i18n.t('catalog__load_error'))
})
it.each(['tx', 'wy'] as const)('%s network failure remains a request error in the real controller', async(source) => {
  mocks.httpFetch.mockImplementation(() => { throw new Error('offline') })
  mocks.eapiRequest.mockImplementation(() => { throw new Error('offline') })
  const sdk = source === 'tx' ? txAlbum : wyAlbum
  const adapter = createCatalogAdapter({ [source]: { album: (id: string | number, page: number, limit: number) => sdk.getAlbumDetail(id, page, limit) } })
  const state = createCatalogState()
  await createCatalogController(state, adapter).open('album', albumSong(source))
  expect(state.error).toBe(window.i18n.t('catalog__load_error'))
})
it.each(['tx', 'wy'] as const)('%s business refusal stays a request error rather than a schema error', async(source) => {
  mocks.httpFetch.mockReturnValue({ promise: Promise.resolve({ statusCode: 200, body: { code: 0, req: { code: 1 } } }) })
  mocks.eapiRequest.mockReturnValue({ promise: Promise.resolve({ body: { code: 500 } }) })
  const sdk = source === 'tx' ? txAlbum : wyAlbum
  const state = createCatalogState()
  const adapter = createCatalogAdapter({ [source]: { album: (id: string | number, page: number, limit: number) => sdk.getAlbumDetail(id, page, limit) } })
  await createCatalogController(state, adapter).open('album', albumSong(source))
  expect(state.error).toBe(window.i18n.t('catalog__load_error'))
})
it.each(['tx', 'wy'] as const)('%s successful empty album has no controller error', async(source) => {
  mocks.httpFetch.mockReturnValue({ promise: Promise.resolve({ statusCode: 200, body: { code: 0, req: { code: 0, data: { songList: [], totalNum: 0 } } } }) })
  mocks.eapiRequest.mockReturnValue({ promise: Promise.resolve({ body: { code: 200, songs: [] } }) })
  const sdk = source === 'tx' ? txAlbum : wyAlbum
  const state = createCatalogState()
  const adapter = createCatalogAdapter({ [source]: { album: (id: string | number, page: number, limit: number) => sdk.getAlbumDetail(id, page, limit) } })
  await createCatalogController(state, adapter).open('album', albumSong(source))
  expect(state.error).toBe('')
  expect(state.list).toEqual([])
  expect(state.total).toBe(0)
})
it.each([{}, null, { id: 0 }, { id: '' }, { id: -1 }, { id: 'not-a-song-id' }])('NetEase invalid row %j is a real controller format error, not an empty album', async(row) => {
  mocks.eapiRequest.mockReturnValue({ promise: Promise.resolve({ body: { code: 200, songs: [row] } }) })
  const state = createCatalogState()
  const adapter = createCatalogAdapter({ wy: { album: (id, page, limit) => wyAlbum.getAlbumDetail(id, page, limit) } })
  await createCatalogController(state, adapter).open('album', albumSong('wy'))
  expect(state.error).toBe(window.i18n.t('catalog__invalid_response'))
  expect(state.list).toEqual([])
})
it.each([123, '123'])('NetEase valid provider identity %j retains the real song', async(id) => {
  mocks.eapiRequest.mockReturnValue({ promise: Promise.resolve({ body: { code: 200, songs: [{ id, name: 'Real song', ar: [{ id: 7, name: 'Artist' }], al: { id: 8, name: 'Album' }, dt: 120000 }] } }) })
  const state = createCatalogState()
  const adapter = createCatalogAdapter({ wy: { album: (id, page, limit) => wyAlbum.getAlbumDetail(id, page, limit) } })
  await createCatalogController(state, adapter).open('album', albumSong('wy'))
  expect(state.error).toBe('')
  expect(state.list).toHaveLength(1)
  expect(state.list[0].name).toBe('Real song')
})
it('NetEase rejects an unidentifiable row even when the same page also contains a valid song', async() => {
  const valid = { id: 123, name: 'Real song', ar: [{ id: 7, name: 'Artist' }], al: { id: 8, name: 'Album' }, dt: 120000 }
  mocks.eapiRequest.mockReturnValue({ promise: Promise.resolve({ body: { code: 200, songs: [valid, {}] } }) })
  const state = createCatalogState()
  const adapter = createCatalogAdapter({ wy: { album: (id, page, limit) => wyAlbum.getAlbumDetail(id, page, limit) } })
  await createCatalogController(state, adapter).open('album', albumSong('wy'))
  expect(state.error).toBe(window.i18n.t('catalog__invalid_response'))
  expect(state.list).toEqual([])
})
it('a malformed later NetEase page keeps the already loaded valid song and a retryable page', async() => {
  const valid = { id: 123, name: 'Real song', ar: [{ id: 7, name: 'Artist' }], al: { id: 8, name: 'Album' }, dt: 120000 }
  mocks.eapiRequest.mockReturnValue({ promise: Promise.resolve({ body: { code: 200, songs: [valid, {}] } }) })
  const state = createCatalogState()
  const adapter = createCatalogAdapter({ wy: { album: (id, page) => wyAlbum.getAlbumDetail(id, page, 1) } })
  const controller = createCatalogController(state, adapter)
  await controller.open('album', albumSong('wy'))
  expect(state.error).toBe('')
  await controller.loadMore()
  expect(state.error).toBe(window.i18n.t('catalog__invalid_response'))
  expect(state.list.map(song => song.name)).toEqual(['Real song'])
  expect(state.page).toBe(1)
  expect(state.hasMore).toBe(true)
})

const qqSong = (mid: unknown) => ({ id: 1, mid, title: 'Song', singer: [{ mid: 'artist', name: 'Artist' }], album: { id: 8, mid: 'album', name: 'Album' }, interval: 120, file: { media_mid: 'media', size_128mp3: 0, size_320mp3: 0, size_flac: 0, size_hires: 0 } })
const qqResponse = (songs: unknown[], total = songs.length) => ({ promise: Promise.resolve({ statusCode: 200, body: { code: 0, req: { code: 0, data: { totalNum: total, songList: songs.map(songInfo => ({ songInfo })) } } } }) })
it.each([undefined, null, '', '   ', 123])('QQ rejects an invalid required MID %s before conversion', async(mid) => {
  mocks.httpFetch.mockReturnValue(qqResponse([qqSong(mid)]))
  const state = createCatalogState()
  const adapter = createCatalogAdapter({ tx: { album: (id, page, limit) => txAlbum.getAlbumDetail(id, page, limit) } })
  await createCatalogController(state, adapter).open('album', albumSong('tx'))
  expect(state.list).toEqual([])
  expect(state.error).toBe(window.i18n.t('catalog__invalid_response'))
})
it('QQ rejects a mixed valid and missing-MID page instead of partially accepting fabricated identities', async() => {
  mocks.httpFetch.mockReturnValue(qqResponse([qqSong('valid'), qqSong(undefined)]))
  const state = createCatalogState()
  const adapter = createCatalogAdapter({ tx: { album: (id, page, limit) => txAlbum.getAlbumDetail(id, page, limit) } })
  await createCatalogController(state, adapter).open('album', albumSong('tx'))
  expect(state.list).toEqual([])
  expect(state.error).toBe(window.i18n.t('catalog__invalid_response'))
})
it('QQ retains an earlier valid page and retry cursor after a later missing-MID page', async() => {
  mocks.httpFetch.mockReturnValueOnce(qqResponse([qqSong('valid')], 2)).mockReturnValueOnce(qqResponse([qqSong(undefined)], 2))
  const state = createCatalogState()
  const adapter = createCatalogAdapter({ tx: { album: (id, page) => txAlbum.getAlbumDetail(id, page, 1) } })
  const controller = createCatalogController(state, adapter)
  await controller.open('album', albumSong('tx'))
  expect(state.error).toBe('')
  await controller.loadMore()
  expect(state.list.map(song => song.id)).toEqual(['tx_valid'])
  expect(state.error).toBe(window.i18n.t('catalog__invalid_response'))
  expect(state.page).toBe(1)
  expect(state.hasMore).toBe(true)
})
