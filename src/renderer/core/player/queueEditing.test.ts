import { reactive } from 'vue'
import { beforeEach, expect, it, vi } from 'vitest'
import { clearPlaybackQueue, enqueuePlaybackEntry, getPlaybackQueue, movePlaybackEntry, playPlaybackEntry, removePlaybackEntry, removeCurrentPlaybackEntry } from './queue'
import { playInfo, playMusicInfo, tempPlayList } from '@renderer/store/player/state'
import { queueSession, getQueueSource } from '@renderer/store/player/queueSession'
import { appSetting } from '@renderer/store/setting'
const mocks = vi.hoisted(() => ({ source: [] as any[], play: vi.fn(), stop: vi.fn(), reset: vi.fn() }))
vi.mock('@renderer/store/player/state', () => ({ playInfo: { playerListId: 'list', playerPlayIndex: 0 }, playMusicInfo: { musicInfo: null, isTempPlay: false, listId: 'list' }, tempPlayList: [], playedList: [] }))
vi.mock('@renderer/store/setting', () => ({ appSetting: { 'player.togglePlayMethod': 'list' } }))
vi.mock('@renderer/store/player/action', async() => {
  const { getQueueSource } = await import('@renderer/store/player/queueSession')
  return {
    getPlaybackList: (id: string) => getQueueSource(id, mocks.source),
    getList: () => mocks.source,
    setPlayListId: (id: string | null) => { playInfo.playerListId = id },
    setPlayMusicInfo: (_id: string | null, music: any) => { playMusicInfo.musicInfo = music },
    clearTempPlayeList: () => tempPlayList.splice(0),
    clearPlayedList: vi.fn(),
  }
})
vi.mock('./action', () => ({
  capturePlaybackContext: () => () => true,
  getCachedRandomNextMusicInfo: () => null,
  capturePlaybackOwner: () => () => true,
  playQueueMusic: mocks.play,
  stop: mocks.stop,
  resetRandomNextMusicInfo: mocks.reset,
  getNextPlayMusicInfo: async(options: { advanceFromRemovedSource?: boolean } = {}) => {
    if (tempPlayList.length) return tempPlayList[0]
    const list = getQueueSource(playInfo.playerListId, mocks.source)
    const mode = appSetting['player.togglePlayMethod']
    let index = mode === 'singleLoop' && !options.advanceFromRemovedSource ? Math.max(0, playInfo.playerPlayIndex) : playInfo.playerPlayIndex + 1
    if (mode === 'listLoop' && index >= list.length) index = 0
    return list[index] ? { listId: playInfo.playerListId, musicInfo: list[index], isTempPlay: false } : null
  },
}))
vi.mock('./utils', () => ({ filterList: async({ list, playerMusicInfo }: any) => ({ filteredList: list, playerIndex: list.indexOf(playerMusicInfo) }) }))
const song = (id: string): LX.Music.MusicInfoOnline => ({ id, name: id, singer: 'Artist', source: 'kw', interval: null, meta: { songId: id, albumName: '', qualitys: [], _qualitys: {} } })
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('window', { app_event: { musicToggled: vi.fn() } })
  mocks.source = ['a', 'b', 'c'].map(song)
  playInfo.playerListId = 'list'; playInfo.playerPlayIndex = 0
  playMusicInfo.musicInfo = mocks.source[0]; playMusicInfo.isTempPlay = false; playMusicInfo.listId = 'list'
  queueSession.list = null; queueSession.listId = null
  tempPlayList.splice(0)
  appSetting['player.togglePlayMethod'] = 'list'
})
it('source removal only changes session queue and keeps the current identity', async() => {
  const { entries } = await getPlaybackQueue()
  removePlaybackEntry(entries[0])
  expect(queueSession.list?.map(x => x.id)).toEqual(['a', 'c'])
  expect(mocks.source.map(x => x.id)).toEqual(['a', 'b', 'c'])
  expect(playMusicInfo.musicInfo?.id).toBe('a')
  expect((await getPlaybackQueue()).entries.map(x => x.musicInfo.id)).toEqual(['c'])
})
it('move preserves current cursor, source list and playback mode', async() => {
  const { entries } = await getPlaybackQueue()
  movePlaybackEntry(entries[1], entries[0])
  expect((await getPlaybackQueue()).entries.map(x => x.musicInfo.id)).toEqual(['c', 'b'])
  expect(playInfo.playerPlayIndex).toBe(0)
  expect(appSetting['player.togglePlayMethod']).toBe('list')
  expect(mocks.source.map(x => x.id)).toEqual(['a', 'b', 'c'])
})
it('pending entries support duplicates, exact removal and immediate playback without clearing siblings', async() => {
  const one = { musicInfo: song('p'), listId: null, isTempPlay: true }
  tempPlayList.push(one, { ...one }, { musicInfo: song('q'), listId: null, isTempPlay: true })
  const { entries } = await getPlaybackQueue()
  playPlaybackEntry(entries[1])
  expect(tempPlayList).toHaveLength(2)
  expect(tempPlayList[0]).toBe(one)
  expect(mocks.play).toHaveBeenCalledWith(expect.objectContaining({ musicInfo: one.musicInfo, isTempPlay: true }))
  removePlaybackEntry(entries[1]) // stale row must not remove its equal-ID sibling
  expect(tempPlayList).toHaveLength(2)
})
it('next insertion and end enqueue remain explicit ahead of automatic list traversal', async() => {
  const { entries } = await getPlaybackQueue()
  enqueuePlaybackEntry(entries[0], false)
  enqueuePlaybackEntry(entries[1], true)
  expect(tempPlayList.map(x => x.musicInfo.id)).toEqual(['c', 'b'])
  expect(mocks.source).toHaveLength(3)
})
it('moving across pending/source boundary keeps the displayed order without editing saved music', async() => {
  tempPlayList.push({ musicInfo: song('p'), listId: null, isTempPlay: true })
  const { entries } = await getPlaybackQueue()
  movePlaybackEntry(entries[1], entries[0])
  expect((await getPlaybackQueue()).entries.map(x => x.musicInfo.id)).toEqual(['b', 'p', 'c'])
})
it('removing current plays its successor and removing the last stops and clears current', async() => {
  await removeCurrentPlaybackEntry()
  expect(mocks.play).toHaveBeenCalledWith(expect.objectContaining({ musicInfo: expect.objectContaining({ id: 'b' }) }), 'removed')
  expect(queueSession.list?.map(x => x.id)).toEqual(['b', 'c'])
  mocks.source = [song('a')]; queueSession.list = null; queueSession.listId = null
  playMusicInfo.musicInfo = mocks.source[0]; playInfo.playerPlayIndex = 0
  await removeCurrentPlaybackEntry()
  expect(mocks.stop).toHaveBeenCalled()
  expect(playMusicInfo.musicInfo).toBe(null)
})
it('clear stops playback, removes pending and detaches the source, never deletes saved songs', () => {
  tempPlayList.push({ musicInfo: song('p'), listId: null, isTempPlay: true })
  clearPlaybackQueue()
  expect(tempPlayList).toHaveLength(0)
  expect(playInfo.playerListId).toBe(null)
  expect(playMusicInfo.musicInfo).toBe(null)
  expect(mocks.source).toHaveLength(3)
  expect(mocks.stop).toHaveBeenCalled()
})
it('list loop preserves its current anchor while ordering one future cycle', async() => {
  appSetting['player.togglePlayMethod'] = 'listLoop'
  const { entries } = await getPlaybackQueue()
  movePlaybackEntry(entries[1], entries[0])
  expect((await getPlaybackQueue()).entries.map(x => x.musicInfo.id)).toEqual(['c', 'b', 'a'])
  expect(playInfo.playerPlayIndex).toBe(0)
  expect(appSetting['player.togglePlayMethod']).toBe('listLoop')
})
it('removing current in single repeat chooses the successor instead of replaying removed music', async() => {
  appSetting['player.togglePlayMethod'] = 'singleLoop'
  await removeCurrentPlaybackEntry()
  expect(mocks.play).toHaveBeenCalledWith(expect.objectContaining({ musicInfo: expect.objectContaining({ id: 'b' }) }), 'removed')
  expect(appSetting['player.togglePlayMethod']).toBe('singleLoop')
})
it('removal from a random session invalidates its cached next choice', async() => {
  appSetting['player.togglePlayMethod'] = 'random'
  removePlaybackEntry({ listId: 'list', musicInfo: mocks.source[1], isTempPlay: false })
  expect(mocks.reset).toHaveBeenCalled()
  expect(queueSession.list?.map(x => x.id)).toEqual(['a', 'c'])
  expect(appSetting['player.togglePlayMethod']).toBe('random')
})
it('clear marks finite-selection ownership for subsequent radio events', () => {
  playInfo.isSelectionQueue = false
  clearPlaybackQueue()
  expect(playInfo.isSelectionQueue).toBe(true)
})
it('Play Next moves an existing pending occurrence instead of duplicating it', async() => {
  tempPlayList.push({ musicInfo: song('p'), listId: null, isTempPlay: true }, { musicInfo: song('q'), listId: null, isTempPlay: true })
  const { entries } = await getPlaybackQueue()
  enqueuePlaybackEntry(entries[1], true)
  expect(tempPlayList.map(x => x.musicInfo.id)).toEqual(['q', 'p'])
})
it('Play Next distinguishes a future source occurrence from a same-ID temporary current song', async() => {
  playMusicInfo.musicInfo = mocks.source[1]; playMusicInfo.isTempPlay = true
  const { entries } = await getPlaybackQueue()
  enqueuePlaybackEntry(entries[0], true)
  expect(queueSession.list?.map(x => x.id)).toEqual(['a', 'c'])
  expect(tempPlayList.map(x => x.musicInfo.id)).toEqual(['b'])
})
it('moving a Vue-proxied pending row retains the original occurrence and all ownership metadata', () => {
  const first = { musicInfo: song('p'), listId: null, isTempPlay: true }
  const owned = { musicInfo: song('q'), listId: null, isTempPlay: true, recommendationSessionId: 42 }
  tempPlayList.push(first, owned)
  enqueuePlaybackEntry(reactive({ ...owned, pendingEntry: owned }), true)
  expect(tempPlayList).toHaveLength(2)
  expect(tempPlayList[0]).toBe(owned)
  expect(tempPlayList[0].recommendationSessionId).toBe(42)
})
