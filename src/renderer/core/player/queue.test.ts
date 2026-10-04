import { beforeEach, expect, it, vi } from 'vitest'
import { getPlaybackQueue } from './queue'
import { getNextPlayMusicInfo } from './action'
import { filterList } from './utils'
import { appSetting } from '@renderer/store/setting'
import { playInfo, tempPlayList } from '@renderer/store/player/state'
vi.mock('./action', () => ({ getNextPlayMusicInfo: vi.fn() }))
vi.mock('./utils', () => ({ filterList: vi.fn() }))
vi.mock('@renderer/store/player/action', () => ({ getList: () => [] }))
vi.mock('@renderer/store/player/state', () => ({ playedList: [], playInfo: { playerListId: 'list', playerPlayIndex: 0 }, tempPlayList: [] }))
vi.mock('@renderer/store/setting', () => ({ appSetting: { 'player.togglePlayMethod': 'list' } }))
const song = (id: string): LX.Music.MusicInfoOnline => ({ id, name: id, singer: 'Artist', source: 'kw', interval: null, meta: { songId: id, albumName: '', qualitys: [], _qualitys: {} } })
const tracks = [song('a'), song('b'), song('c')]
beforeEach(() => {
  vi.resetAllMocks()
  playInfo.playerListId = 'list'
  tempPlayList.splice(0)
  appSetting['player.togglePlayMethod'] = 'list'
  vi.mocked(getNextPlayMusicInfo).mockResolvedValue({ listId: 'list', musicInfo: tracks[1], isTempPlay: false })
  vi.mocked(filterList).mockResolvedValue({ filteredList: tracks, playerIndex: 0 })
})
it('sequential preview includes queued songs before the true list tail without changing either', async() => {
  tempPlayList.push({ listId: 'later', musicInfo: song('queued'), isTempPlay: true })
  const result = await getPlaybackQueue()
  expect(result.entries.map(item => item.musicInfo.id)).toEqual(['queued', 'b', 'c'])
  expect(tempPlayList).toHaveLength(1)
  expect(tracks.map(item => item.id)).toEqual(['a', 'b', 'c'])
})
it('list loop shows one cycle in true order', async() => {
  appSetting['player.togglePlayMethod'] = 'listLoop'
  expect((await getPlaybackQueue()).entries.map(item => item.musicInfo.id)).toEqual(['b', 'c', 'a'])
})
it('a detached selected queue has no old playlist appended', async() => {
  playInfo.playerListId = null
  tempPlayList.push({ listId: 'user', musicInfo: tracks[2], isTempPlay: true })
  expect((await getPlaybackQueue()).entries.map(item => item.musicInfo.id)).toEqual(['c'])
  expect(filterList).not.toHaveBeenCalled()
})
it('random mode only promises the next already-resolved song', async() => {
  appSetting['player.togglePlayMethod'] = 'random'
  const result = await getPlaybackQueue()
  expect(result.random).toBe(true)
  expect(result.entries.map(item => item.musicInfo.id)).toEqual(['b'])
})
it('removed current song starts the remaining list from the first item', async() => {
  vi.mocked(filterList).mockResolvedValue({ filteredList: tracks, playerIndex: -1 })
  expect((await getPlaybackQueue()).entries.map(item => item.musicInfo.id)).toEqual(['a', 'b', 'c'])
})
