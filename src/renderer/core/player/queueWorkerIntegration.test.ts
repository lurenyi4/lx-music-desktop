import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { filterMusicList } from '@renderer/worker/main/list'
import { filterList } from './utils'
import { getNextPlayMusicInfo, playList, playNext, playPrev } from './action'
import { clearPlaybackQueue, removeCurrentPlaybackEntry } from './queue'
import { addTempPlayList } from '@renderer/store/player/action'
import { playedList, playMusicInfo, tempPlayList } from '@renderer/store/player/state'

const mocks = vi.hoisted(() => ({
  saved: [] as any[],
  jobs: [] as Array<{ args: any, resolve: (result: any) => void }>,
  explore: vi.fn(),
  setting: { 'player.togglePlayMethod': 'list', 'recommend.radio': false, 'recommend.autoRefill': true, 'recommend.radius': 50, 'recommend.engine': 'local', 'ai.enable': false },
  state: { isPlay: { value: false }, playedList: [], tempPlayList: [], musicInfo: {}, playInfo: {}, playMusicInfo: {}, status: {}, statusText: {} },
}))
vi.mock('@renderer/store/player/state', () => mocks.state)
vi.mock('@renderer/store/setting', () => ({ appSetting: mocks.setting, updateSetting: vi.fn() }))
vi.mock('@renderer/store/list/action', () => ({ getListMusicsFromCache: () => mocks.saved, addListMusics: vi.fn(), removeListMusics: vi.fn() }))
vi.mock('@renderer/store/list/state', () => ({ loveList: { id: 'love' } }))
vi.mock('@renderer/store/download/state', () => ({ downloadList: [] }))
vi.mock('@renderer/store/player/playProgress', () => ({ setProgress: vi.fn() }))
vi.mock('@renderer/plugins/player', () => ({ isEmpty: () => true, setPause: vi.fn(), setPlay: vi.fn(), setResource: vi.fn(), setStop: vi.fn() }))
vi.mock('@renderer/core/music/index', () => ({ getMusicUrl: async() => null, getPicPath: async() => null, getLyricInfo: async() => ({ rawlrcInfo: { lyric: '' } }) }))
vi.mock('@renderer/core/music/toggleWriteback', () => ({ writebackToggleMusicInfo: async() => {} }))
vi.mock('@renderer/utils/message', () => ({ requestMsg: {} }))
vi.mock('@renderer/utils/index', () => ({ getRandom: () => 0 }))
vi.mock('@renderer/core/dislikeList', () => ({ addDislikeInfo: vi.fn() }))
vi.mock('@renderer/store/dislikeList', () => ({ dislikeInfo: { names: new Set(), musicNames: new Set(), singerNames: new Set() } }))
vi.mock('@renderer/utils/ipc', () => ({ setPowerSaveBlocker: vi.fn() }))
vi.mock('@renderer/utils/music', () => ({ createLocalMusicInfo: vi.fn() }))
vi.mock('@common/utils/nodejs', () => ({ joinPath: vi.fn(), saveStrToFile: vi.fn() }))
vi.mock('@renderer/core/recommend/engine', () => ({ exploreOnce: mocks.explore }))
vi.mock('@renderer/core/recommend/platformEngine', () => ({ explorePlatformOnce: mocks.explore }))
vi.mock('@renderer/store/list/listManage/rendererListManage', () => ({ getListMusics: async() => [] }))
vi.mock('@renderer/store/list/listManage/state', () => ({ loveList: { id: 'love' }, userLists: [] }))
vi.mock('@renderer/core/recommend/feature', () => ({ startFeatureCollection: vi.fn(), stopFeatureCollection: vi.fn() }))
vi.mock('@renderer/core/recommend/profile', () => ({ getProfileState: () => null, onProfileSignal: vi.fn(), recordRecommendedSkip: vi.fn() }))
vi.mock('@renderer/utils/data', () => ({ getRecommendMetrics: async() => null, saveRecommendMetrics: vi.fn() }))

const song = (id: string): LX.Music.MusicInfoOnline => ({ id, name: id, singer: 'Artist', source: 'wy', interval: null, meta: { songId: id, albumName: '', qualitys: [], _qualitys: {} } })
const prepare = (mode: 'list' | 'random', ids: string[]) => {
  playedList.splice(0); tempPlayList.splice(0)
  mocks.saved = ids.map(song)
  mocks.setting['player.togglePlayMethod'] = mode
  playList('list', 0)
}
const release = async() => {
  const job = mocks.jobs.shift()!
  expect(job).toBeDefined()
  job.resolve(await filterMusicList(job.args))
}
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers(); mocks.jobs.splice(0)
  const events = new EventEmitter()
  Object.assign(events, { musicToggled: (reason: string) => events.emit('musicToggled', reason), pause: () => events.emit('pause'), stop: () => events.emit('stop'), picUpdated: vi.fn(), lyricUpdated: vi.fn(), error: vi.fn() })
  vi.stubGlobal('window', {
    app_event: events,
    i18n: { t: (key: string) => key },
    lx: { isProd: true, isPlayedStop: false, worker: { main: { filterMusicList: async(args: any) => new Promise(resolve => { mocks.jobs.push({ args: structuredClone(args), resolve }) }) } } },
  })
})
afterEach(async() => {
  const { endSession } = await import('@renderer/core/recommend/session')
  endSession()
  await vi.advanceTimersByTimeAsync(0)
  vi.useRealTimers(); vi.unstubAllGlobals()
})
it.each([{ label: 'an automatic successor', ids: ['a', 'b', 'c'] }, { label: 'the last song', ids: ['a'] }])('remove-current preserves late real-store pending with $label', async({ ids }) => {
  prepare('list', ids)
  const removed = removeCurrentPlaybackEntry()
  addTempPlayList([{ listId: null, musicInfo: song('pending') }, { listId: null, musicInfo: song('pending-two') }])
  await release(); await removed
  expect(playMusicInfo.musicInfo?.id).toBe('pending')
  expect(tempPlayList.map(item => item.musicInfo.id)).toEqual(['pending-two'])
})
it('an old real filter response cannot clear restarted random playback history or repeat its current song', async() => {
  prepare('random', ['old'])
  const oldPreview = getNextPlayMusicInfo()
  clearPlaybackQueue()
  prepare('random', ['new', 'new-next'])
  expect(playedList.map(item => item.musicInfo.id)).toEqual(['new'])
  await release()
  expect(await oldPreview).toBeNull()
  expect(playedList.map(item => item.musicInfo.id)).toEqual(['new'])
  const next = getNextPlayMusicInfo()
  await release()
  expect((await next)?.musicInfo.id).toBe('new-next')
})
it('filtering an exhausted round is pure until a valid playback owner commits the history reset', async() => {
  prepare('random', ['a', 'b'])
  playList('list', 1)
  const filtered = filterList({ listId: 'list', list: mocks.saved, playedList, playerMusicInfo: mocks.saved[1], isNext: true })
  await release()
  expect((await filtered).filteredList.map(item => item.id)).toEqual(['a', 'b'])
  expect(playedList.map(item => item.musicInfo.id)).toEqual(['a', 'b'])
  const preview = getNextPlayMusicInfo()
  await release()
  expect((await preview)?.musicInfo.id).toBe('a')
  expect(playedList).toHaveLength(0)
})
it.each(['next', 'previous'] as const)('stale real %s filtering cannot mutate the new random history', async(direction) => {
  prepare('random', ['old'])
  const traversal = direction === 'next' ? playNext(true) : playPrev(true)
  clearPlaybackQueue()
  prepare('random', ['new', 'new-next'])
  await release(); await traversal
  expect(playMusicInfo.musicInfo?.id).toBe('new')
  expect(playedList.map(item => item.musicInfo.id)).toEqual(['new'])
})
it('real recommendation refill/store append retains pending priority during current removal', async() => {
  prepare('list', ['a', 'b'])
  const removed = removeCurrentPlaybackEntry()
  const { startSession } = await import('@renderer/core/recommend/session')
  mocks.explore.mockResolvedValueOnce({ engine: 'local', anchor: { artist: 'Artist', title: 'a', album: '' }, position: '00:00', featureSheet: {}, analysis: { summary: '', aiUsed: false, error: null }, rawAnalysis: {}, candidates: [{ id: 'recommended', artist: 'Artist', title: 'recommended', album: '', source: 'wy', reason: '', journeyRole: 'hold', distance: 20, musicInfo: song('recommended') }], meta: { sourceCounts: {}, recallError: null, aiRankError: null } })
  await startSession()
  expect(tempPlayList[0].recommendationSessionId).toBeDefined()
  await release(); await removed
  expect(playMusicInfo.musicInfo?.id).toBe('recommended')
  expect(tempPlayList).toHaveLength(0)
})
it('stale current-removal completion cannot consume pending or history from a restarted session', async() => {
  prepare('list', ['old', 'old-next'])
  const removed = removeCurrentPlaybackEntry()
  clearPlaybackQueue()
  prepare('random', ['new', 'new-next'])
  addTempPlayList([{ listId: null, musicInfo: song('new-pending') }])
  await release(); await removed
  expect(playMusicInfo.musicInfo?.id).toBe('new')
  expect(playedList.map(item => item.musicInfo.id)).toEqual(['new'])
  expect(tempPlayList.map(item => item.musicInfo.id)).toEqual(['new-pending'])
})
it('pending added during an exhausted random preview takes priority without resetting history', async() => {
  prepare('random', ['a'])
  const preview = getNextPlayMusicInfo()
  addTempPlayList([{ listId: null, musicInfo: song('pending') }])
  await release()
  expect((await preview)?.musicInfo.id).toBe('pending')
  expect(playedList.map(item => item.musicInfo.id)).toEqual(['a'])
})
