import { beforeEach, expect, it, vi } from 'vitest'
import { getMusicUrl } from './index'
import { handleGetOnlineMusicUrl as online } from './utils'
import { getDownloadFilePath } from '@renderer/utils/music'
vi.mock('@renderer/utils/message', () => ({ requestMsg: { cancelRequest: 'cancelled' } }))
vi.mock('@renderer/utils/ipc', () => ({ getMusicUrlInfo: vi.fn(async() => null), saveMusicUrl: vi.fn(async() => {}) }))
vi.mock('@renderer/store/list/action', () => ({ updateListMusics: vi.fn() }))
vi.mock('@renderer/store/setting', () => ({ appSetting: { 'player.playQuality': '128k' } }))
vi.mock('@renderer/utils/music', () => ({ getDownloadFilePath: vi.fn() }))
vi.mock('@renderer/store/download/utils', () => ({ buildSavePath: () => '/saved.mp3' }))
vi.mock('./utils', () => ({ handleGetOnlineMusicUrl: vi.fn(), getPlayQuality: () => '128k', buildLyricInfo: vi.fn(), getCachedLyricInfo: vi.fn() }))
vi.mock('./local', () => ({ getMusicUrl: vi.fn(), getPicUrl: vi.fn(), getLyricInfo: vi.fn() }))
const song = (id: string): LX.Music.MusicInfoOnline => ({ id, name: id, singer: 'Artist', source: 'kw', interval: null, meta: { songId: id, albumName: '', qualitys: [], _qualitys: {} } })
const result = (url: string, musicInfo = song('rescued')) => ({ url, musicInfo, quality: '128k' as const, isFromCache: false })
beforeEach(() => { vi.clearAllMocks(); vi.mocked(online).mockReset() })
it.each([true, undefined])('playback and preloading always try the selected/legacy version first (pin=%s)', async(pin) => {
  const original = song('original')
  const preferred = song('chosen')
  original.meta = { ...original.meta, toggleMusicInfo: preferred, manualVersionPinned: pin }
  vi.mocked(online).mockRejectedValueOnce(new Error('unavailable')).mockResolvedValueOnce(result('rescue'))
  await expect(getMusicUrl({ musicInfo: original })).resolves.toBe('rescue')
  expect(online).toHaveBeenNthCalledWith(1, expect.objectContaining({ musicInfo: preferred, allowToggleSource: false }))
  expect(online).toHaveBeenNthCalledWith(2, expect.objectContaining({ musicInfo: preferred, allowToggleSource: true }))
  expect(original.meta.toggleMusicInfo).toBe(preferred)
  vi.mocked(online).mockResolvedValueOnce(result('preferred-restored', preferred))
  await expect(getMusicUrl({ musicInfo: original })).resolves.toBe('preferred-restored')
  expect(online).toHaveBeenLastCalledWith(expect.objectContaining({ musicInfo: preferred, allowToggleSource: false }))
})
it('respects callers disabling fallback', async() => {
  const original = song('original')
  original.meta.toggleMusicInfo = song('chosen')
  vi.mocked(online).mockRejectedValue(new Error('unavailable'))
  await expect(getMusicUrl({ musicInfo: original, allowToggleSource: false })).rejects.toThrow('unavailable')
  expect(online).toHaveBeenCalledOnce()
})
it('does not rescue a cancelled version request', async() => {
  const original = song('original')
  original.meta.toggleMusicInfo = song('chosen')
  vi.mocked(online).mockRejectedValue(new Error('cancelled'))
  await expect(getMusicUrl({ musicInfo: original })).rejects.toThrow('cancelled')
  expect(online).toHaveBeenCalledOnce()
})
it('completed downloaded files retain offline priority even with a manual online version', async() => {
  const original = song('a')
  original.meta.toggleMusicInfo = song('b')
  const download = { id: 'download-a', progress: {}, metadata: { musicInfo: original }, isComplate: true } as unknown as LX.Download.ListItem
  vi.mocked(getDownloadFilePath).mockResolvedValue('/saved.mp3')
  vi.mocked(online).mockRejectedValue(new Error('offline'))
  await expect(getMusicUrl({ musicInfo: download })).resolves.toBe('/saved.mp3')
  expect(getDownloadFilePath).toHaveBeenCalledOnce()
  expect(online).not.toHaveBeenCalled()
})
it('a missing downloaded file falls back through the same preferred version policy', async() => {
  const original = song('a')
  const preferred = song('b')
  original.meta.toggleMusicInfo = preferred
  const download = { id: 'download-a', progress: {}, metadata: { musicInfo: original } } as unknown as LX.Download.ListItem
  vi.mocked(getDownloadFilePath).mockResolvedValue(null as any)
  vi.mocked(online).mockRejectedValueOnce(new Error('unavailable')).mockResolvedValueOnce(result('rescue'))
  await expect(getMusicUrl({ musicInfo: download })).resolves.toBe('rescue')
  expect(online).toHaveBeenNthCalledWith(1, expect.objectContaining({ musicInfo: preferred, allowToggleSource: false }))
  expect(online).toHaveBeenNthCalledWith(2, expect.objectContaining({ musicInfo: preferred, allowToggleSource: true }))
})
