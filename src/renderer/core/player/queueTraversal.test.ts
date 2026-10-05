import { getQueueSource, resetQueueSession } from '@renderer/store/player/queueSession'
import { removePlaybackEntry, removeCurrentPlaybackEntry, clearPlaybackQueue } from '@renderer/core/player/queue'
import { getRandom } from '@renderer/utils/index'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { playMusicInfoNow, getNextPlayMusicInfo, resetRandomNextMusicInfo, playNext, playPrev, playList, stop } from '@renderer/core/player/action'
import { playInfo, playMusicInfo, tempPlayList, playedList } from '@renderer/store/player/state'
import { setPlayMusicInfo, removeTempPlayList, getList } from '@renderer/store/player/action'
import { filterList } from '@renderer/core/player/utils'
import { appSetting } from '@renderer/store/setting'

const urlCache = vi.hoisted(() => ({ entries: new Map<string, LX.Music.MusicUrlInfo>(), resolve: vi.fn() }))
vi.mock('@renderer/core/music/utils', () => ({
  getPlayQuality: () => '128k',
  handleGetOnlineMusicUrl: urlCache.resolve,
}))
vi.mock('@renderer/utils/ipc', () => ({
  getMusicUrl: async(info: LX.Music.MusicInfo, quality: LX.Quality) => urlCache.entries.get(`${info.id}_${quality}`)?.url ?? '',
  getMusicUrlInfo: async(info: LX.Music.MusicInfo, quality: LX.Quality) => urlCache.entries.get(`${info.id}_${quality}`) ?? null,
  saveMusicUrl: async(info: LX.Music.MusicInfo, quality: LX.Quality, url: string, musicInfo?: LX.Music.MusicInfoOnline) => {
    const id = `${info.id}_${quality}`
    urlCache.entries.set(id, { id, url, musicInfo })
  },
}))

vi.mock('@renderer/plugins/player', () => ({ isEmpty: vi.fn(), setPause: vi.fn(), setPlay: vi.fn(), setResource: vi.fn(), setStop: vi.fn() }))
vi.mock('@renderer/store/player/state', () => ({
  isPlay: { value: false },
  playedList: [],
  tempPlayList: [],
  musicInfo: {},
  playInfo: { playerListId: 'original', playerPlayIndex: 4 },
  playMusicInfo: { musicInfo: null, listId: 'original', isTempPlay: false },
}))
vi.mock('@renderer/store/player/action', () => ({
  getList: vi.fn(),
  getPlaybackList: (id: any) => getQueueSource(id, (getList as any)(id)),
  addTempPlayList: vi.fn((items: LX.Player.PlayMusicInfo[]) => { tempPlayList.push(...items.map(item => ({ ...item, isTempPlay: true }))) }),
  clearPlayedList: vi.fn(),
  clearTempPlayeList: vi.fn(() => { tempPlayList.splice(0) }),
  setPlayMusicInfo: vi.fn(),
  addPlayedList: vi.fn(),
  setMusicInfo: vi.fn(),
  setAllStatus: vi.fn(),
  removeTempPlayList: vi.fn(),
  setPlayListId: vi.fn(id => { playInfo.playerListId = id }),
  removePlayedList: vi.fn(),
}))
vi.mock('@renderer/store/setting', () => ({ appSetting: { 'player.togglePlayMethod': 'random' } }))
vi.mock('@renderer/core/music/index', () => ({
  getMusicUrl: vi.fn(async() => null),
  getPicPath: vi.fn(async() => null),
  getLyricInfo: vi.fn(async() => ({ rawlrcInfo: { lyric: '' } })),
}))
vi.mock('@renderer/core/music/toggleWriteback', () => ({ writebackToggleMusicInfo: vi.fn(async() => {}) }))
vi.mock('@renderer/core/player/utils', () => ({ filterList: vi.fn() }))
vi.mock('@renderer/utils/message', () => ({ requestMsg: {} }))
vi.mock('@renderer/utils/index', () => ({ getRandom: vi.fn() }))
vi.mock('@renderer/store/list/action', () => ({ addListMusics: vi.fn(), removeListMusics: vi.fn() }))
vi.mock('@renderer/store/list/state', () => ({ loveList: {} }))
vi.mock('@renderer/core/dislikeList', () => ({ addDislikeInfo: vi.fn() }))

beforeEach(() => {
  vi.clearAllMocks()
  urlCache.entries.clear()
  tempPlayList.splice(0)
  playMusicInfo.alternativeMusicInfos = undefined
  vi.stubGlobal('window', {
    lx: { isPlayedStop: false },
    i18n: { t: (value: string) => value },
    app_event: { musicToggled: vi.fn(), stop: vi.fn(), pause: vi.fn(), picUpdated: vi.fn(), lyricUpdated: vi.fn(), error: vi.fn() },
  })
  vi.mocked(setPlayMusicInfo).mockImplementation((listId, musicInfo, isTempPlay = false, alternativeMusicInfos) => {
    Object.assign(playMusicInfo, { listId, musicInfo, isTempPlay, alternativeMusicInfos })
  })
  vi.mocked(removeTempPlayList).mockImplementation(index => { tempPlayList.splice(index, 1) })
})
afterEach(async() => {
  vi.useRealTimers()
  // 排空取 URL/歌词 Promise 后再撤除播放器事件环境。
  for (let i = 0; i < 10; i++) await Promise.resolve()
  await new Promise(resolve => setTimeout(resolve, 10))
  vi.unstubAllGlobals()
})

it('removed random entry must not be resurrected by an in-flight preview', async() => {
  const song = (id: string): any => ({ id, name: id, singer: 'Artist', source: 'wy', meta: {} })
  const tracks = [song('a'), song('b'), song('c')]
  resetQueueSession(); resetRandomNextMusicInfo()
  appSetting['player.togglePlayMethod'] = 'random'
  Object.assign(playInfo, { playerListId: 'list', playerPlayIndex: 0 })
  Object.assign(playMusicInfo, { musicInfo: tracks[0], listId: 'list', isTempPlay: false })
  playedList.splice(0)
  vi.mocked(getList).mockReturnValue(tracks)
  vi.mocked(getRandom).mockReturnValue(0)
  let release!: (v: any) => void
  vi.mocked(filterList).mockImplementationOnce(async() => new Promise(resolve => { release = resolve }))
  vi.mocked(filterList).mockResolvedValue({ filteredList: [tracks[2]], playerIndex: -1 })
  const oldPreview = getNextPlayMusicInfo()
  removePlaybackEntry({ listId: 'list', musicInfo: tracks[1], isTempPlay: false })
  release({ filteredList: [tracks[1]], playerIndex: -1 })
  await oldPreview
  expect((await getNextPlayMusicInfo())?.musicInfo.id).not.toBe('b')
})

it('clear must not be undone by an in-flight ordinary next-track operation', async() => {
  const song = (id: string): any => ({ id, name: id, singer: 'Artist', source: 'wy', meta: {} })
  const tracks = [song('a'), song('b')]
  resetQueueSession(); resetRandomNextMusicInfo()
  appSetting['player.togglePlayMethod'] = 'list'
  Object.assign(playInfo, { playerListId: 'list', playerPlayIndex: 0 })
  Object.assign(playMusicInfo, { musicInfo: tracks[0], listId: 'list', isTempPlay: false })
  playedList.splice(0)
  vi.mocked(getList).mockReturnValue(tracks)
  let release!: (v: any) => void
  vi.mocked(filterList).mockImplementationOnce(async() => new Promise(resolve => { release = resolve }))
  const next = playNext(true)
  clearPlaybackQueue()
  expect(playMusicInfo.musicInfo).toBeNull()
  release({ filteredList: tracks, playerIndex: 0 })
  await next
  expect(playMusicInfo.musicInfo).toBeNull()
})

const deferred = () => {
  let resolve!: (value: any) => void
  const promise = new Promise<any>(_resolve => { resolve = _resolve })
  return { promise, resolve }
}
const prepare = (mode: any = 'random') => {
  const tracks = ['a', 'b', 'c'].map(id => ({ id, name: id, singer: 'Artist', source: 'wy', meta: {} } as any))
  resetQueueSession(); resetRandomNextMusicInfo()
  appSetting['player.togglePlayMethod'] = mode
  Object.assign(playInfo, { playerListId: 'list', playerPlayIndex: 0 })
  Object.assign(playMusicInfo, { musicInfo: tracks[0], listId: 'list', isTempPlay: false })
  playedList.splice(0)
  vi.mocked(getList).mockReturnValue(tracks)
  vi.mocked(getRandom).mockReturnValue(0)
  return tracks
}
it('queue and preloader share one in-flight random choice', async() => {
  const tracks = prepare()
  const pending = deferred()
  vi.mocked(filterList).mockReturnValueOnce(pending.promise)
  const one = getNextPlayMusicInfo()
  const two = getNextPlayMusicInfo()
  pending.resolve({ filteredList: [tracks[1], tracks[2]], playerIndex: -1 })
  expect(await one).toBe(await two)
  expect(filterList).toHaveBeenCalledTimes(1)
  expect((await getNextPlayMusicInfo())?.musicInfo.id).toBe('b')
})
it('an old random generation cannot overwrite a newer choice completed first', async() => {
  const tracks = prepare()
  const older = deferred(); const newer = deferred()
  vi.mocked(filterList).mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise)
  const oldResult = getNextPlayMusicInfo()
  resetRandomNextMusicInfo()
  const newResult = getNextPlayMusicInfo()
  newer.resolve({ filteredList: [tracks[2]], playerIndex: -1 })
  expect((await newResult)?.musicInfo.id).toBe('c')
  older.resolve({ filteredList: [tracks[1]], playerIndex: -1 })
  expect(await oldResult).toBeNull()
  expect((await getNextPlayMusicInfo())?.musicInfo.id).toBe('c')
})
it('random next playback consumes the same in-flight candidate as the visible preview', async() => {
  const tracks = prepare()
  const pending = deferred()
  vi.mocked(filterList).mockReturnValueOnce(pending.promise)
  const preview = getNextPlayMusicInfo()
  const next = playNext(true)
  pending.resolve({ filteredList: [tracks[1]], playerIndex: -1 })
  expect((await preview)?.musicInfo.id).toBe('b')
  await next
  expect(playMusicInfo.musicInfo?.id).toBe('b')
  expect(filterList).toHaveBeenCalledTimes(1)
})
it('clear also invalidates an in-flight previous-track operation', async() => {
  const tracks = prepare('list')
  const pending = deferred()
  vi.mocked(filterList).mockReturnValueOnce(pending.promise)
  const previous = playPrev()
  clearPlaybackQueue()
  pending.resolve({ filteredList: tracks, playerIndex: 0 })
  await previous
  expect(playMusicInfo.musicInfo).toBeNull()
})
it('a newly inserted pending song has priority after an automatic next worker returns', async() => {
  const tracks = prepare('list')
  const pending = deferred()
  vi.mocked(filterList).mockReturnValueOnce(pending.promise)
  const next = playNext(true)
  tempPlayList.push({ musicInfo: tracks[2], listId: null, isTempPlay: true })
  pending.resolve({ filteredList: tracks, playerIndex: 0 })
  await next
  expect(playMusicInfo.musicInfo?.id).toBe('c')
  expect(tempPlayList).toHaveLength(0)
})
it('a late stop event cannot pause newly started playback', async() => {
  vi.useFakeTimers()
  const tracks = prepare('list')
  stop()
  playMusicInfoNow(tracks[1])
  await vi.advanceTimersByTimeAsync(0)
  expect(window.app_event.stop).not.toHaveBeenCalled()
  expect(playMusicInfo.musicInfo?.id).toBe('b')
  vi.useRealTimers()
})
it('queue edits after clear do not suppress its legitimate stop event', async() => {
  vi.useFakeTimers()
  prepare('list')
  clearPlaybackQueue()
  await vi.advanceTimersByTimeAsync(0)
  expect(window.app_event.stop).toHaveBeenCalledOnce()
  vi.useRealTimers()
})
it('clear and explicit restart keep an older random preview from publishing into the new session', async() => {
  const tracks = prepare()
  const pending = deferred()
  vi.mocked(filterList).mockReturnValueOnce(pending.promise).mockResolvedValue({ filteredList: [tracks[2]], playerIndex: -1 })
  const preview = getNextPlayMusicInfo()
  clearPlaybackQueue()
  playList('list', 0)
  pending.resolve({ filteredList: [tracks[1]], playerIndex: -1 })
  expect(await preview).toBeNull()
  expect(playMusicInfo.musicInfo?.id).toBe('a')
  expect((await getNextPlayMusicInfo())?.musicInfo.id).toBe('c')
})
it('a delayed stop cleanup cannot clear a newly restarted song', async() => {
  vi.useFakeTimers()
  const tracks = prepare('list')
  playInfo.playerListId = null
  await playNext()
  playMusicInfoNow(tracks[1])
  await vi.advanceTimersByTimeAsync(0)
  expect(playMusicInfo.musicInfo?.id).toBe('b')
  expect(window.app_event.stop).not.toHaveBeenCalled()
  vi.useRealTimers()
})
it('remove-current does not override an explicit restart of the same song object while filtering', async() => {
  const tracks = prepare('list')
  const pending = deferred()
  vi.mocked(filterList).mockReturnValueOnce(pending.promise)
  const removed = removeCurrentPlaybackEntry()
  playMusicInfoNow(tracks[0])
  pending.resolve({ filteredList: tracks.slice(1), playerIndex: -1 })
  await removed
  expect(playMusicInfo.musicInfo).toBe(tracks[0])
})
