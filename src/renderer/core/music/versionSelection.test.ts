import { beforeEach, expect, it, vi } from 'vitest'
import { getMusicUrl } from './index'
import { getMusicUrl as online } from './online'
vi.mock('@renderer/utils/message', () => ({ requestMsg: { cancelRequest: 'cancelled' } }))
vi.mock('./online', () => ({ getMusicUrl: vi.fn(), getPicUrl: vi.fn(), getLyricInfo: vi.fn() }))
vi.mock('./download', () => ({ getMusicUrl: vi.fn(), getPicUrl: vi.fn(), getLyricInfo: vi.fn() }))
vi.mock('./local', () => ({ getMusicUrl: vi.fn(), getPicUrl: vi.fn(), getLyricInfo: vi.fn() }))
const song = (id: string): LX.Music.MusicInfoOnline => ({ id, name: id, singer: 'Artist', source: 'kw', interval: null, meta: { songId: id, albumName: '', qualitys: [], _qualitys: {} } })
beforeEach(() => { vi.resetAllMocks() })
it.each([true, undefined])('playback and preloading always try the selected/legacy version first (pin=%s)', async(pin) => {
  const original = song('original')
  const preferred = song('chosen')
  original.meta = { ...original.meta, toggleMusicInfo: preferred, manualVersionPinned: pin }
  vi.mocked(online).mockRejectedValueOnce(new Error('unavailable')).mockResolvedValueOnce('rescue')
  await expect(getMusicUrl({ musicInfo: original })).resolves.toBe('rescue')
  expect(online).toHaveBeenNthCalledWith(1, expect.objectContaining({ musicInfo: preferred, allowToggleSource: false }))
  expect(online).toHaveBeenNthCalledWith(2, expect.objectContaining({ musicInfo: preferred, allowToggleSource: true }))
  expect(original.meta.toggleMusicInfo).toBe(preferred)
  vi.mocked(online).mockResolvedValueOnce('preferred-restored')
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
