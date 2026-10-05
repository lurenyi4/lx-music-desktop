import type * as SessionModule from '@renderer/core/recommend/session'
import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { effectScope, nextTick } from 'vue'

const mocks = vi.hoisted(() => ({
  explore: vi.fn(),
  updateSetting: vi.fn(),
  queue: [] as any[],
  played: [] as any[],
  player: { musicInfo: null as any, listId: null as string | null, isTempPlay: false, alternativeMusicInfos: undefined },
  playInfo: { playerListId: 'old' as string | null, playerPlayIndex: 0, isSelectionQueue: false },
  setting: { 'recommend.radio': false, 'recommend.radius': 50, 'recommend.autoRefill': true, 'ai.enable': false, 'recommend.engine': 'local', 'player.togglePlayMethod': 'list' },
}))
vi.mock('@renderer/core/recommend/engine', () => ({ exploreOnce: mocks.explore }))
vi.mock('@renderer/core/recommend/platformEngine', () => ({ explorePlatformOnce: mocks.explore }))
vi.mock('@renderer/store/list/listManage/rendererListManage', () => ({ getListMusics: async() => [] }))
vi.mock('@renderer/store/list/listManage/state', () => ({ loveList: { id: 'love' }, userLists: [] }))
vi.mock('@renderer/core/recommend/feature', () => ({ startFeatureCollection: vi.fn(), stopFeatureCollection: vi.fn() }))
vi.mock('@renderer/core/recommend/profile', () => ({ getProfileState: () => null, onProfileSignal: vi.fn(), recordRecommendedSkip: vi.fn() }))
vi.mock('@renderer/utils/data', () => ({ getRecommendMetrics: async() => null, saveRecommendMetrics: vi.fn() }))
vi.mock('@renderer/store/setting', async() => ({ appSetting: (await import('vue')).reactive(mocks.setting), updateSetting: mocks.updateSetting }))
vi.mock('@renderer/store/player/state', () => ({ playMusicInfo: mocks.player, playInfo: mocks.playInfo, tempPlayList: mocks.queue, playedList: mocks.played, isPlay: { value: false }, musicInfo: {} }))
vi.mock('@renderer/store/player/action', () => ({
  addTempPlayList: (items: any[]) => mocks.queue.push(...items.map(item => ({ ...item, isTempPlay: true }))),
  removeTempPlayList: (index: number) => mocks.queue.splice(index, 1),
  clearTempPlayeList: () => mocks.queue.splice(0),
  clearPlayedList: () => mocks.played.splice(0),
  getList: () => [song('normal')],
  getPlaybackList: () => [song('normal')],
  setPlayListId: (id: string | null) => { mocks.playInfo.playerListId = id },
  setPlayMusicInfo: (listId: string | null, musicInfo: any, isTempPlay = false, alternativeMusicInfos?: any, reason = 'user') => {
    Object.assign(mocks.player, { listId, musicInfo, isTempPlay, alternativeMusicInfos })
    if (musicInfo) window.app_event.musicToggled(reason as LX.Player.MusicChangeReason)
  },
  addPlayedList: vi.fn(),
  removePlayedList: vi.fn(),
  setMusicInfo: vi.fn(),
  setAllStatus: vi.fn(),
}))
vi.mock('@renderer/core/player', () => ({ playMusicInfoNow: vi.fn() }))
vi.mock('@renderer/plugins/player', () => ({ isEmpty: () => true, setPause: vi.fn(), setPlay: vi.fn(), setResource: vi.fn(), setStop: vi.fn() }))
vi.mock('@renderer/core/music/index', () => ({ getMusicUrl: async() => '', getPicPath: async() => null, getLyricInfo: async() => ({ rawlrcInfo: { lyric: '' } }) }))
vi.mock('@renderer/core/player/utils', () => ({ filterList: async() => ({ filteredList: [], playerIndex: -1 }) }))
vi.mock('@renderer/utils/message', () => ({ requestMsg: {} }))
vi.mock('@renderer/utils/index', () => ({ getRandom: () => 0 }))
vi.mock('@renderer/store/list/action', () => ({ addListMusics: vi.fn(), removeListMusics: vi.fn() }))
vi.mock('@renderer/store/list/state', () => ({ loveList: { id: 'love' } }))
vi.mock('@renderer/core/dislikeList', () => ({ addDislikeInfo: vi.fn() }))
const song = (id: string): LX.Music.MusicInfoOnline => ({ id, name: id, singer: 'Artist', source: 'kw', interval: null, meta: { songId: id, albumName: '', qualitys: [], _qualitys: {} } })
const result = (id: string): any => ({ engine: 'local', anchor: { artist: 'Artist', title: 'anchor', album: '' }, position: '00:00', featureSheet: {}, analysis: { summary: '', aiUsed: false, error: null }, rawAnalysis: {}, candidates: [{ id, artist: 'Artist', title: id, album: '', source: 'kw', reason: '', journeyRole: 'hold', distance: 20, musicInfo: song(id) }], meta: { sourceCounts: {}, recallError: null, aiRankError: null } })
let scope: ReturnType<typeof effectScope>
let session: typeof SessionModule
let setting: any
beforeEach(async() => {
  vi.resetModules(); vi.clearAllMocks(); vi.useFakeTimers()
  Object.assign(mocks.setting, { 'recommend.radio': false, 'recommend.autoRefill': true })
  mocks.playInfo.isSelectionQueue = false
  mocks.queue.splice(0); mocks.played.splice(0)
  Object.assign(mocks.player, { musicInfo: song('anchor'), listId: 'original', isTempPlay: false })
  const events = new EventEmitter()
  Object.assign(events, { musicToggled: (reason: string) => events.emit('musicToggled', reason), pause: () => events.emit('pause'), stop: () => events.emit('stop'), picUpdated: vi.fn(), lyricUpdated: vi.fn(), error: vi.fn() })
  vi.stubGlobal('window', { lx: { isProd: true, isPlayedStop: false }, i18n: { t: (key: string) => key }, app_event: events })
  setting = (await import('@renderer/store/setting')).appSetting
  session = await import('@renderer/core/recommend/session')
  scope = effectScope(); scope.run(() => { session.initRecommendRadio() })
})
afterEach(async() => {
  scope?.stop(); setting['recommend.radio'] = false; session?.endSession()
  await vi.runOnlyPendingTimersAsync(); vi.useRealTimers(); vi.unstubAllGlobals()
})

it('clear queue must discard in-flight recommendations', async() => {
  let release!: (result: any) => void
  mocks.explore.mockImplementationOnce(async() => new Promise(resolve => { release = resolve }))
  void session.startSession()
  for (let i = 0; i < 30; i++) await Promise.resolve()
  expect(release).toBeDefined()
  const queue = await import('@renderer/core/player/queue')
  queue.clearPlaybackQueue()
  expect(mocks.queue).toHaveLength(0)
  release(result('late-radio'))
  await vi.advanceTimersByTimeAsync(5000)
  expect(mocks.queue).toHaveLength(0)
})
it('Play Next must retain ownership of an existing recommendation occurrence', async() => {
  mocks.explore.mockResolvedValueOnce(result('recommended'))
  await session.startSession()
  const original = mocks.queue[0]
  expect(original.recommendationSessionId).toBeDefined()
  const queue = await import('@renderer/core/player/queue')
  queue.enqueuePlaybackEntry({ ...original, pendingEntry: original }, true)
  expect(mocks.queue[0].recommendationSessionId).toBe(original.recommendationSessionId)
  session.endSession()
  expect(mocks.queue).toHaveLength(0)
})
it('clear cancels a scheduled refill debounce before it starts', async() => {
  mocks.explore.mockResolvedValueOnce(result('first'))
  await session.startSession()
  session.setRadius(20)
  const queue = await import('@renderer/core/player/queue')
  queue.clearPlaybackQueue()
  await vi.advanceTimersByTimeAsync(60000)
  expect(mocks.explore).toHaveBeenCalledTimes(1)
  expect(mocks.queue).toHaveLength(0)
  expect(session.sessionView.value.active).toBe(false)
})
it('clear cancels the existing refill retry timer', async() => {
  mocks.explore.mockResolvedValueOnce(result('first'))
  await session.startSession()
  mocks.explore.mockRejectedValueOnce(new Error('offline'))
  session.setRadius(20)
  await vi.advanceTimersByTimeAsync(1200)
  expect(session.refillState.value).toBe('retrying')
  const queue = await import('@renderer/core/player/queue')
  queue.clearPlaybackQueue()
  await vi.advanceTimersByTimeAsync(60000)
  expect(mocks.explore).toHaveBeenCalledTimes(2)
  expect(mocks.queue).toHaveLength(0)
})
it('clear invalidates an in-flight automatic refill, but explicit restart can create a new session', async() => {
  mocks.explore.mockResolvedValueOnce(result('first'))
  await session.startSession()
  let release!: (value: any) => void
  mocks.explore.mockImplementationOnce(async() => new Promise(resolve => { release = resolve }))
  mocks.queue.splice(0)
  mocks.player.musicInfo = song('first')
  window.app_event.musicToggled('ended')
  await vi.advanceTimersByTimeAsync(1200)
  expect(release).toBeDefined()
  const queue = await import('@renderer/core/player/queue')
  queue.clearPlaybackQueue()
  release(result('late-refill'))
  await vi.advanceTimersByTimeAsync(5000)
  expect(mocks.queue).toHaveLength(0)
  mocks.player.musicInfo = song('fresh-anchor')
  mocks.explore.mockResolvedValueOnce(result('fresh-recommendation'))
  await session.startSession()
  expect(mocks.queue.map(item => item.musicInfo.id)).toEqual(['fresh-recommendation'])
  expect(mocks.playInfo.isSelectionQueue).toBe(false)
})
it('a moved recommendation remains counted and is consumed by its path action', async() => {
  mocks.explore.mockResolvedValueOnce(result('recommended'))
  await session.startSession()
  const original = mocks.queue[0]
  const queue = await import('@renderer/core/player/queue')
  queue.enqueuePlaybackEntry({ ...original, pendingEntry: original }, true)
  expect(mocks.queue[0]).toBe(original)
  expect(session.sessionView.value.remaining).toBe(1)
  session.playPathItem('recommended')
  expect(mocks.queue).toHaveLength(0)
})
it('clear cancels a debounced radio reanchor without rewriting the radio preference', async() => {
  mocks.explore.mockResolvedValueOnce(result('first'))
  await session.startSession()
  setting['recommend.radio'] = true
  await nextTick()
  mocks.player.musicInfo = song('new-anchor')
  window.app_event.musicToggled('user')
  const queue = await import('@renderer/core/player/queue')
  queue.clearPlaybackQueue()
  await vi.advanceTimersByTimeAsync(60000)
  expect(mocks.explore).toHaveBeenCalledTimes(1)
  expect(mocks.queue).toHaveLength(0)
  expect(setting['recommend.radio']).toBe(true)
})
