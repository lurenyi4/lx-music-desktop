import { beforeEach, expect, it, vi } from 'vitest'
import useMusicToggle from './useMusicToggle'
import { updateListMusics } from '@renderer/store/list/action'
import { restartSelectedVersion } from '@renderer/core/player'
import { playMusicInfo } from '@renderer/store/player/state'
vi.mock('@renderer/store/list/action', () => ({ updateListMusics: vi.fn(async() => {}) }))
vi.mock('@renderer/core/player', () => ({ restartSelectedVersion: vi.fn() }))
vi.mock('@renderer/store/player/state', () => ({ playMusicInfo: { musicInfo: null, listId: 'love' } }))
const song = (id: string): LX.Music.MusicInfoOnline => ({ id, name: id, singer: 'Artist', source: 'kw', interval: null, meta: { songId: id, albumName: '', qualitys: [], _qualitys: {} } })
beforeEach(() => { vi.clearAllMocks() })
it('manual choice updates metadata in place without replacing or removing collection identities', async() => {
  const original = song('original')
  const selected = song('selected')
  selected.meta.toggleMusicInfo = song('stale')
  selected.meta.manualVersionPinned = true
  playMusicInfo.musicInfo = original
  const list = { value: [original, selected] }
  const hook = useMusicToggle({ listId: 'love' }, list)
  hook.selectedToggleMusicInfo.value = original
  await hook.toggleSource(selected)
  const update = vi.mocked(updateListMusics).mock.calls[0][0][0]
  expect(update.id).toBe('love')
  expect(update.musicInfo.id).toBe(original.id)
  expect(update.musicInfo.meta.manualVersionPinned).toBe(true)
  expect(update.musicInfo.meta.toggleMusicInfo?.id).toBe(selected.id)
  expect(update.musicInfo.meta.toggleMusicInfo?.meta.toggleMusicInfo).toBeUndefined()
  expect(list.value).toEqual([original, selected])
  expect(restartSelectedVersion).toHaveBeenCalledWith('love', update.musicInfo)
})
it('a song removed while the chooser is open is not added back', async() => {
  const hook = useMusicToggle({ listId: 'love' }, { value: [] })
  hook.selectedToggleMusicInfo.value = song('removed')
  await hook.toggleSource(song('selected'))
  expect(updateListMusics).not.toHaveBeenCalled()
})
