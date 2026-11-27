import { describe, expect, it, vi } from 'vitest'
import txSinger from '@renderer/utils/musicSdk/tx/singer'
import wySinger from '@renderer/utils/musicSdk/wy/singer'
const mocks = vi.hoisted(() => ({ httpFetch: vi.fn(), eapiRequest: vi.fn() }))
vi.mock('@renderer/utils/request', () => ({ httpFetch: mocks.httpFetch }))
vi.mock('@renderer/utils/index', () => ({ formatPlayTime: (seconds: number) => String(seconds), sizeFormate: () => '1M', decodeName: (name: string) => name }))
vi.mock('@renderer/utils/musicSdk/wy/utils/index', () => ({ eapiRequest: mocks.eapiRequest }))

describe('provider singer pagination contracts', () => {
  it('QQ returns converted songs and contiguous one-based page offsets', async() => {
    const songInfo = {
      id: 1,
      mid: 'song-mid',
      title: 'Song',
      singer: [{ id: 10, mid: 'artist-mid', name: 'Artist' }],
      album: { id: 2, mid: 'album-mid', name: 'Album' },
      interval: 120,
      file: { media_mid: 'media', size_128mp3: 0, size_320mp3: 0, size_flac: 0, size_hires: 0 },
    }
    mocks.httpFetch.mockReturnValue({ promise: Promise.resolve({ statusCode: 200, body: { code: 0, req: { code: 0, data: { totalNum: 300, songList: [{ songInfo }] } } } }) })
    for (const page of [1, 2, 3]) {
      const result = await txSinger.getSongList('artist-mid', page, 100)
      expect(mocks.httpFetch.mock.lastCall![1].body.req.param.begin).toBe((page - 1) * 100)
      expect(result.page).toBe(page)
      expect(result.list[0]).toMatchObject({ songmid: 'song-mid', artists: [{ id: 'artist-mid', name: 'Artist' }] })
    }
  })
  it('NetEase preserves metadata without privileges and converts duration to seconds', async() => {
    mocks.eapiRequest.mockReturnValue({ promise: Promise.resolve({ body: { code: 200, total: 300, songs: [{ id: 1, name: 'Song', ar: [{ id: 7, name: 'Artist' }], al: { id: 8, name: 'Album' }, dt: 120000 }] } }) })
    for (const page of [1, 2, 3]) {
      const result = await wySinger.getSongList(7, page, 100)
      expect(mocks.eapiRequest.mock.lastCall![1].offset).toBe((page - 1) * 100)
      expect(result.page).toBe(page)
      expect(result.list[0]).toMatchObject({ albumId: 8, interval: '120', artists: [{ id: 7, name: 'Artist' }] })
    }
  })
})
