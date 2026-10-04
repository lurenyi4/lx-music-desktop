import { beforeEach, expect, it, vi } from 'vitest'
import { getPicPath } from './index'
import { handleGetOnlinePicUrl } from './utils'
import { updateListMusics } from '@renderer/store/list/action'
const state = vi.hoisted(() => ({ list: [] as LX.Music.MusicInfo[] }))
vi.mock('@renderer/store/list/action', () => ({
  getListMusicsFromCache: () => state.list,
  updateListMusics: vi.fn(async(items: any[]) => { for (const item of items) { const index = state.list.findIndex(info => info.id === item.musicInfo.id); if (index >= 0) state.list[index] = item.musicInfo } }),
}))
vi.mock('@renderer/utils/message', () => ({ requestMsg: {} }))
vi.mock('@renderer/store/setting', () => ({ appSetting: {} }))
vi.mock('@renderer/utils/ipc', () => ({ saveLyric: vi.fn(), saveMusicUrl: vi.fn(), getMusicUrlInfo: vi.fn() }))
vi.mock('./utils', () => ({ handleGetOnlinePicUrl: vi.fn() }))
vi.mock('./download', () => ({ getMusicUrl: vi.fn(), getPicUrl: vi.fn(), getLyricInfo: vi.fn() }))
vi.mock('./local', () => ({ getMusicUrl: vi.fn(), getPicUrl: vi.fn(), getLyricInfo: vi.fn() }))
const song = (id: string): LX.Music.MusicInfoOnline => ({ id, source: 'kw', name: id, singer: 'Artist', interval: null, meta: { songId: id, albumName: '', qualitys: [], _qualitys: {} } })
beforeEach(() => { vi.clearAllMocks(); state.list.splice(0) })
it('A preferred as B cannot overwrite independently saved B preferred as C through cover fetching', async() => {
  const a = song('a'); const b = song('b'); const c = song('c')
  a.meta.toggleMusicInfo = { ...b, meta: { ...b.meta } }; a.meta.manualVersionPinned = true
  b.meta.toggleMusicInfo = c; b.meta.manualVersionPinned = true
  state.list.push(a, b)
  const before = JSON.stringify(state.list)
  vi.mocked(handleGetOnlinePicUrl).mockResolvedValue({ url: 'picture-b', musicInfo: a.meta.toggleMusicInfo, isFromCache: false })
  await expect(getPicPath({ musicInfo: a, listId: 'love' })).resolves.toBe('picture-b')
  expect(updateListMusics).not.toHaveBeenCalled()
  expect(JSON.stringify(state.list)).toBe(before)
})
it('a late original cover must not erase a newer manual preference for the same owner', async() => {
  const old = song('a')
  state.list.push(old)
  let release!: (value: any) => void
  vi.mocked(handleGetOnlinePicUrl).mockImplementationOnce(async() => new Promise(resolve => { release = resolve }))
  const pending = getPicPath({ musicInfo: old, listId: 'love' })
  const current = { ...old, meta: { ...old.meta, toggleMusicInfo: song('c'), manualVersionPinned: true } }
  state.list[0] = current
  release({ url: 'old-picture', musicInfo: old, isFromCache: false })
  await pending
  expect(state.list[0].meta.toggleMusicInfo?.id).toBe('c')
  expect(state.list[0].meta.manualVersionPinned).toBe(true)
  expect(updateListMusics).not.toHaveBeenCalled()
})
