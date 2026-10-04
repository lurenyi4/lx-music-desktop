import type * as SessionModule from './session'
import type * as PlayerModule from '../player/action'
import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { effectScope, nextTick } from 'vue'

const mocks = vi.hoisted(() => ({
  explore: vi.fn(),
  updateSetting: vi.fn(),
  queue: [] as any[],
  played: [] as any[],
  player: { musicInfo: null as any, listId: null as string | null, isTempPlay: false, alternativeMusicInfos: undefined },
  playInfo: { playerListId: 'old' as string | null, playerPlayIndex: 0 },
  setting: { 'recommend.radio': false, 'recommend.radius': 50, 'recommend.autoRefill': true, 'ai.enable': false, 'recommend.engine': 'local', 'player.togglePlayMethod': 'list' },
}))
vi.mock('./engine', () => ({ exploreOnce: mocks.explore }))
vi.mock('./platformEngine', () => ({ explorePlatformOnce: mocks.explore }))
vi.mock('@renderer/store/list/listManage/rendererListManage', () => ({ getListMusics: async() => [] }))
vi.mock('@renderer/store/list/listManage/state', () => ({ loveList: { id: 'love' }, userLists: [] }))
vi.mock('./feature', () => ({ startFeatureCollection: vi.fn(), stopFeatureCollection: vi.fn() }))
vi.mock('./profile', () => ({ getProfileState: () => null, onProfileSignal: vi.fn(), recordRecommendedSkip: vi.fn() }))
vi.mock('@renderer/utils/data', () => ({ getRecommendMetrics: async() => null, saveRecommendMetrics: vi.fn() }))
vi.mock('@renderer/store/setting', async() => ({ appSetting: (await import('vue')).reactive(mocks.setting), updateSetting: mocks.updateSetting }))
vi.mock('@renderer/store/player/state', () => ({ playMusicInfo: mocks.player, playInfo: mocks.playInfo, tempPlayList: mocks.queue, playedList: mocks.played, isPlay: { value: false }, musicInfo: {} }))
vi.mock('@renderer/store/player/action', () => ({
  addTempPlayList: (items: any[]) => mocks.queue.push(...items.map(item => ({ ...item, isTempPlay: true }))),
  removeTempPlayList: (index: number) => mocks.queue.splice(index, 1),
  clearTempPlayeList: () => mocks.queue.splice(0),
  clearPlayedList: () => mocks.played.splice(0),
  getList: () => [],
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
vi.mock('../music/index', () => ({ getMusicUrl: async() => '', getPicPath: async() => null, getLyricInfo: async() => ({ rawlrcInfo: { lyric: '' } }) }))
vi.mock('../player/utils', () => ({ filterList: async() => ({ filteredList: [], playerIndex: -1 }) }))
vi.mock('@renderer/utils/message', () => ({ requestMsg: {} }))
vi.mock('@renderer/utils/index', () => ({ getRandom: () => 0 }))
vi.mock('@renderer/store/list/action', () => ({ addListMusics: vi.fn(), removeListMusics: vi.fn() }))
vi.mock('@renderer/store/list/state', () => ({ loveList: { id: 'love' } }))
vi.mock('@renderer/core/dislikeList', () => ({ addDislikeInfo: vi.fn() }))
const song = (id: string): LX.Music.MusicInfoOnline => ({ id, name: id, singer: 'Artist', source: 'kw', interval: null, meta: { songId: id, albumName: '', qualitys: [], _qualitys: {} } })
const result = (id: string): any => ({ engine: 'local', anchor: { artist: 'Artist', title: 'anchor', album: '' }, position: '00:00', featureSheet: {}, analysis: { summary: '', aiUsed: false, error: null }, rawAnalysis: {}, candidates: [{ id, artist: 'Artist', title: id, album: '', source: 'kw', reason: '', journeyRole: 'hold', distance: 20, musicInfo: song(id) }], meta: { sourceCounts: {}, recallError: null, aiRankError: null } })
let scope: ReturnType<typeof effectScope>
let session: typeof SessionModule
let player: typeof PlayerModule
let setting: any
beforeEach(async() => {
  vi.resetModules(); vi.clearAllMocks(); vi.useFakeTimers()
  Object.assign(mocks.setting, { 'recommend.radio': false, 'recommend.autoRefill': true })
  mocks.queue.splice(0); mocks.played.splice(0)
  Object.assign(mocks.player, { musicInfo: song('anchor'), listId: 'original', isTempPlay: false })
  const events = new EventEmitter()
  Object.assign(events, { musicToggled: (reason: string) => events.emit('musicToggled', reason), pause: () => events.emit('pause'), stop: () => events.emit('stop'), picUpdated: vi.fn(), lyricUpdated: vi.fn(), error: vi.fn() })
  vi.stubGlobal('window', { lx: { isProd: true, isPlayedStop: false }, i18n: { t: (key: string) => key }, app_event: events })
  setting = (await import('@renderer/store/setting')).appSetting
  session = await import('./session')
  player = await import('../player/action')
  scope = effectScope(); scope.run(() => { session.initRecommendRadio() })
})
afterEach(async() => {
  scope?.stop(); setting['recommend.radio'] = false; session?.endSession()
  await vi.runOnlyPendingTimersAsync(); vi.useRealTimers(); vi.unstubAllGlobals()
})
it.each([false, true])('explicit selection invalidates old inflight recommendations and ends after only the selected tracks (radio=%s)', async(radio) => {
  let release!: (result: any) => void
  mocks.explore.mockImplementationOnce(async() => new Promise(resolve => { release = resolve }))
  setting['recommend.radio'] = radio
  if (radio) await nextTick()
  else void session.startSession()
  for (let i = 0; i < 20; i++) await Promise.resolve()
  expect(release).toBeDefined()
  player.playMusicSelection([song('one'), song('two')], 'selected')
  expect(setting['recommend.radio']).toBe(false)
  expect(mocks.queue.map(item => item.musicInfo.id)).toEqual(['two'])
  release(result('late-radio'))
  await vi.advanceTimersByTimeAsync(5000)
  expect(mocks.queue.map(item => item.musicInfo.id)).toEqual(['two'])
  await player.playNext(true)
  expect(mocks.player.musicInfo.id).toBe('two')
  await vi.advanceTimersByTimeAsync(5000)
  expect(mocks.queue).toHaveLength(0)
  await player.playNext(true); await vi.runOnlyPendingTimersAsync()
  expect(mocks.player.musicInfo).toBeNull()
  expect(mocks.explore).toHaveBeenCalledOnce()
})
it('an explicit radio start after selection can resume recommendation production', async() => {
  mocks.explore.mockResolvedValue(result('fresh-radio'))
  player.playMusicSelection([song('selected')], 'user')
  setting['recommend.radio'] = true
  await nextTick(); for (let i = 0; i < 30; i++) await Promise.resolve()
  expect(mocks.queue.map(item => item.musicInfo.id)).toContain('fresh-radio')
})
