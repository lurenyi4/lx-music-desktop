import { EventEmitter } from 'node:events'
import { effectScope } from 'vue'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createProfileState } from './profile-core'
import type * as ProfileModule from './profile'
import type * as SessionModule from './session'

const mocks = vi.hoisted(() => ({
  player: { musicInfo: null as any },
  playing: { value: false },
  progress: { maxPlayTime: 0 },
  queue: [] as any[],
  saveProfile: vi.fn(),
  saveMetrics: vi.fn(),
  setting: { 'recommend.radio': false, 'recommend.autoRefill': false, 'recommend.engine': 'local', 'recommend.radius': 50, 'ai.enable': false },
}))
vi.mock('@renderer/store/player/state', () => ({ playMusicInfo: mocks.player, isPlay: mocks.playing, tempPlayList: mocks.queue }))
vi.mock('@renderer/store/player/playProgress', () => ({ playProgress: mocks.progress }))
vi.mock('@renderer/store/setting', async() => ({ appSetting: (await import('vue')).reactive(mocks.setting) }))
vi.mock('@renderer/utils/data', () => ({
  getRecommendProfile: async() => createProfileState(),
  saveRecommendProfile: mocks.saveProfile,
  getRecommendMetrics: async() => null,
  saveRecommendMetrics: mocks.saveMetrics,
}))
vi.mock('@renderer/store/player/action', () => ({
  addTempPlayList: (items: any[]) => mocks.queue.push(...items),
  removeTempPlayList: (index: number) => mocks.queue.splice(index, 1),
}))
vi.mock('@renderer/core/player', () => ({ playMusicInfoNow: vi.fn() }))
vi.mock('@renderer/store/list/listManage/rendererListManage', () => ({ getListMusics: async() => [] }))
vi.mock('@renderer/store/list/listManage/state', () => ({ loveList: { id: 'love' }, userLists: [] }))
vi.mock('./feature', () => ({ startFeatureCollection: vi.fn(), stopFeatureCollection: vi.fn() }))
vi.mock('./platformEngine', () => ({ explorePlatformOnce: vi.fn() }))
vi.mock('./llm', () => ({ llmComplete: vi.fn() }))
vi.mock('./engine', () => ({
  exploreOnce: async() => ({
    candidates: [{ id: 'recommended', artist: 'Artist', title: 'Song', musicInfo: { id: 'recommended', singer: 'Artist', name: 'Song', source: 'wy', meta: {} } }],
    analysis: { aiUsed: false, error: null },
    meta: {},
  }),
}))

let events: EventEmitter
let scope: ReturnType<typeof effectScope>
let profile: typeof ProfileModule
let session: typeof SessionModule
let rate: { value: number }
beforeEach(async() => {
  vi.resetModules()
  vi.clearAllMocks()
  vi.useFakeTimers()
  mocks.queue.splice(0)
  mocks.player.musicInfo = { id: 'anchor', singer: 'Anchor', name: 'Origin', meta: {} }
  mocks.playing.value = false
  mocks.progress.maxPlayTime = 0
  events = new EventEmitter()
  scope = effectScope()
  vi.stubGlobal('window', { lx: { isProd: true }, app_event: events })
  rate = (await import('@renderer/store/player/playbackRate')).playbackRate
  rate.value = 1
  profile = await import('./profile')
  session = await import('./session')
})
afterEach(() => {
  session.endSession()
  scope.stop()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const start = async(order: string, duration: number, speed = 1): Promise<void> => {
  rate.value = speed
  if (order === 'profile-first') scope.run(() => { profile.initRecommendProfile() })
  scope.run(() => { session.initRecommendRadio() })
  await session.startSession()
  if (order === 'session-first') scope.run(() => { profile.initRecommendProfile() })
  await vi.advanceTimersByTimeAsync(0)
  mocks.player.musicInfo = mocks.queue[0].musicInfo
  events.emit('musicToggled')
  mocks.progress.maxPlayTime = duration
  events.emit('playerLoadeddata')
  mocks.playing.value = true
  events.emit('play')
}
const next = (): void => {
  mocks.player.musicInfo = { id: 'next', singer: 'Next Artist', name: 'Next Song', meta: {} }
  events.emit('musicToggled')
}

it.each(['profile-first', 'session-first'])('real session and profile use media completion with wall-clock skip metrics (%s)', async(order) => {
  await start(order, 40, 2)
  await vi.advanceTimersByTimeAsync(20000)
  next()
  expect(profile.getProfileState()).toMatchObject({ completes: 1, skips: 0 })
  expect(mocks.saveMetrics.mock.lastCall?.[0]).toMatchObject({ recommendedEnded: 1, skippedUnder30s: 1 })
})

it.each(['profile-first', 'session-first'])('real session Stop freezes both timers through idle time (%s)', async(order) => {
  await start(order, 180)
  await vi.advanceTimersByTimeAsync(10000)
  mocks.playing.value = false
  events.emit('stop')
  await vi.advanceTimersByTimeAsync(170000)
  expect(profile.getProfileState()).toMatchObject({ completes: 0, skips: 0 })
  next()
  // stop 中断仍冻结两个时钟；未恢复播放的切歌不形成口味负反馈。
  expect(profile.getProfileState()).toMatchObject({ completes: 0, skips: 0 })
  expect(mocks.saveMetrics.mock.lastCall?.[0]).toMatchObject({ recommendedEnded: 1, skippedUnder30s: 1 })
})

it.each(['profile-first', 'session-first'])('same-id replay uses its own completion evidence in either subscription order (%s)', async(order) => {
  await start(order, 40, 2)
  await vi.advanceTimersByTimeAsync(20000)
  // Selecting the same item starts a fresh play instance and settles the completed instance.
  events.emit('musicToggled')
  events.emit('play')
  expect(profile.getProfileState()).toMatchObject({ completes: 1, skips: 0 })
  await vi.advanceTimersByTimeAsync(10000)
  // No loadeddata for this replay: it cannot borrow the prior instance's duration/completion.
  next()
  expect(profile.getProfileState()).toMatchObject({ completes: 1, skips: 1 })
})
