import { expect, it, vi } from 'vitest'
import { getMusicUrl } from './local'
import { getOnlineOtherSourceMusicUrl, getOtherSource } from './utils'
vi.mock('@renderer/store/list/action', () => ({ updateListMusics: vi.fn() }))
vi.mock('@renderer/utils/ipc', () => ({ saveLyric: vi.fn(), saveMusicUrl: vi.fn() }))
vi.mock('@renderer/utils/music', () => ({ getLocalFilePath: vi.fn(async() => null) }))
vi.mock('./utils', () => ({
  buildLyricInfo: vi.fn(),
  getCachedLyricInfo: vi.fn(),
  getOnlineOtherSourceLyricByLocal: vi.fn(),
  getOnlineOtherSourceLyricInfo: vi.fn(),
  getOnlineOtherSourcePicByLocal: vi.fn(),
  getOnlineOtherSourcePicUrl: vi.fn(),
  getOtherSource: vi.fn(),
  getOnlineOtherSourceMusicUrl: vi.fn(),
  getOnlineOtherSourceMusicUrlByLocal: vi.fn(async() => { throw new Error('file missing') }),
}))
it('a local file rescued by an online candidate reports the actual candidate', async() => {
  const local: LX.Music.MusicInfoLocal = { id: 'local', source: 'local', name: 'Song', singer: 'Artist', interval: null, meta: { songId: '/missing.mp3', filePath: '/missing.mp3', ext: 'mp3', albumName: '' } }
  const candidate: LX.Music.MusicInfoOnline = { id: 'kw_candidate', source: 'kw', name: 'Song', singer: 'Artist', interval: null, meta: { songId: 'candidate', albumName: '', qualitys: [], _qualitys: {} } }
  vi.mocked(getOtherSource).mockResolvedValue([candidate])
  vi.mocked(getOnlineOtherSourceMusicUrl).mockResolvedValue({ url: 'rescue', musicInfo: candidate, quality: '128k', isFromCache: false })
  const resolved = vi.fn()
  await expect(getMusicUrl({ musicInfo: local, isRefresh: false, onResolvedMusicInfo: resolved })).resolves.toBe('rescue')
  expect(resolved).toHaveBeenCalledExactlyOnceWith(candidate)
  expect(local.meta.toggleMusicInfo).toBeUndefined()
})
