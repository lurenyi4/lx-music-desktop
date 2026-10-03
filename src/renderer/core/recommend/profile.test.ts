import { EventEmitter } from 'node:events'
import { effectScope } from 'vue'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type * as ProfileModule from './profile'
import { createProfileState } from './profile-core'

const mocks = vi.hoisted(() => {
  // 摘要流程测试按显式旧 AI 引擎配置（平台推荐默认路径零 LLM，见下方平台模式用例）
  const setting: Record<string, any> = { 'ai.enable': true, 'ai.apiKey': 'test', 'ai.model': 'test', 'recommend.engine': 'ai' }
  return {
    load: vi.fn(),
    save: vi.fn(),
    llm: vi.fn(),
    player: { musicInfo: null as any },
    progress: { maxPlayTime: 0 },
    playing: { value: true },
    setting,
  }
})
vi.mock('@renderer/store/player/state', () => ({ playMusicInfo: mocks.player, isPlay: mocks.playing }))
vi.mock('@renderer/store/player/playProgress', () => ({ playProgress: mocks.progress }))
vi.mock('@renderer/store/setting', () => ({ appSetting: mocks.setting }))
vi.mock('@renderer/utils/data', () => ({ getRecommendProfile: mocks.load, saveRecommendProfile: mocks.save }))
vi.mock('./llm', () => ({ llmComplete: mocks.llm }))

let profile: typeof ProfileModule
let events: EventEmitter
let rate: { value: number }
let scope: ReturnType<typeof effectScope>
const changeTrack = (id: string): void => {
  mocks.player.musicInfo = { id, singer: 'Artist', name: id }
  events.emit('musicToggled')
}
beforeEach(async() => {
  vi.resetModules()
  vi.resetAllMocks()
  vi.useFakeTimers()
  mocks.player.musicInfo = null
  mocks.progress.maxPlayTime = 0
  mocks.playing.value = true
  rate = (await import('@renderer/store/player/playbackRate')).playbackRate
  rate.value = 1
  scope = effectScope()
  mocks.load.mockResolvedValue(createProfileState())
  events = new EventEmitter()
  vi.stubGlobal('window', { lx: { isProd: true }, app_event: events })
  profile = await import('./profile')
})
afterEach(() => { scope.stop(); vi.useRealTimers(); vi.unstubAllGlobals() })

it('摘要只确认请求实际覆盖的信号，在途积累满阈值后继续生成', async() => {
  mocks.load.mockResolvedValue({ ...createProfileState(), loves: 19 })
  const releases: Array<(value: { content: string }) => void> = []
  mocks.llm.mockImplementation(async() => new Promise(resolve => releases.push(resolve)))
  scope.run(() => { profile.initRecommendProfile() })
  await vi.advanceTimersByTimeAsync(0)
  const love = (id: string): void => { events.emit('loveListMusicsAdded', [{ id, singer: 'Artist', name: id }]) }
  love('first')
  expect(mocks.llm).toHaveBeenCalledTimes(1)
  for (let i = 0; i < 20; i++) love(`next-${i}`)
  releases[0]({ content: '第一次摘要' })
  await vi.advanceTimersByTimeAsync(0)
  expect(profile.getProfileState()?.summary?.basedOnCount).toBe(20)
  expect(profile.getProfileState()?.loves).toBe(40)
  expect(mocks.llm).toHaveBeenCalledTimes(2)
  releases[1]({ content: '第二次摘要' })
  await vi.advanceTimersByTimeAsync(0)
  expect(profile.getProfileState()?.summary?.basedOnCount).toBe(40)
})

it.each(['before', 'after'])('短曲之后的元数据未加载曲目跳过，不能借用短曲时长（session %s profile）', async(order) => {
  scope.run(() => { profile.initRecommendProfile() })
  await vi.advanceTimersByTimeAsync(0)
  changeTrack('short')
  mocks.progress.maxPlayTime = 20
  events.emit('playerLoadeddata')
  await vi.advanceTimersByTimeAsync(20000)
  changeTrack('unknown')
  await vi.advanceTimersByTimeAsync(20000)
  const skip = (): void => { profile.recordRecommendedSkip({ id: 'unknown', artist: 'Artist', title: 'unknown', playedSeconds: 20 }) }
  if (order === 'before') skip()
  changeTrack('next')
  if (order === 'after') skip()
  expect(profile.getProfileState()?.completes).toBe(1)
  expect(profile.getProfileState()?.skips).toBe(1)
})

it.each(['before', 'after'])('短曲自然播完仍与 skip 互斥（session %s profile）', async(order) => {
  scope.run(() => { profile.initRecommendProfile() })
  await vi.advanceTimersByTimeAsync(0)
  changeTrack('short')
  mocks.progress.maxPlayTime = 20
  events.emit('playerLoadeddata')
  await vi.advanceTimersByTimeAsync(20000)
  const skip = (): void => { profile.recordRecommendedSkip({ id: 'short', artist: 'Artist', title: 'short', playedSeconds: 20 }) }
  if (order === 'before') skip()
  changeTrack('next')
  if (order === 'after') skip()
  expect(profile.getProfileState()?.completes).toBe(1)
  expect(profile.getProfileState()?.skips).toBe(0)
})

// 平台相似推荐（默认路径）零 LLM：即使旧 ai.enable=true，画像摘要阈值到达也不发请求（AC3）
it.each([
  ['平台默认（无 engine 设置）', undefined],
  ['显式 platform', 'platform'],
  ['显式 local', 'local'],
])('累计满画像摘要阈值：%s + ai.enable=true 不发 LLM 请求', async(_name, engine) => {
  mocks.setting['recommend.engine'] = engine
  mocks.load.mockResolvedValue({ ...createProfileState(), loves: 19 })
  scope.run(() => { profile.initRecommendProfile() })
  await vi.advanceTimersByTimeAsync(0)
  const love = (id: string): void => { events.emit('loveListMusicsAdded', [{ id, singer: 'Artist', name: id }]) }
  love('first')
  await vi.advanceTimersByTimeAsync(0)
  expect(profile.getProfileState()?.loves).toBe(20)
  expect(mocks.llm).not.toHaveBeenCalled()
  expect(profile.getProfileState()?.summary?.text).toBeUndefined()
})


it.each([
  [180, 2, 90, 1],
  [20, 0.5, 18, 0],
  [20, 0.5, 40, 1],
])('completion uses heard media time: duration=%s rate=%s wall=%s', async(duration, speed, wall, complete) => {
  rate.value = speed
  scope.run(() => { profile.initRecommendProfile() })
  await vi.advanceTimersByTimeAsync(0)
  changeTrack('song')
  mocks.progress.maxPlayTime = duration
  events.emit('playerLoadeddata')
  await vi.advanceTimersByTimeAsync(wall * 1000)
  changeTrack('next')
  expect(profile.getProfileState()?.completes).toBe(complete)
})

it('settles the old rate before a mid-song speed change', async() => {
  scope.run(() => { profile.initRecommendProfile() })
  await vi.advanceTimersByTimeAsync(0)
  changeTrack('song')
  mocks.progress.maxPlayTime = 180
  events.emit('playerLoadeddata')
  await vi.advanceTimersByTimeAsync(60000)
  rate.value = 2
  await vi.advanceTimersByTimeAsync(60000)
  changeTrack('next')
  expect(profile.getProfileState()?.completes).toBe(1)
})

it('a paused rate change neither counts silence nor reweights the earlier segment', async() => {
  scope.run(() => { profile.initRecommendProfile() })
  await vi.advanceTimersByTimeAsync(0)
  changeTrack('song')
  mocks.progress.maxPlayTime = 30
  events.emit('playerLoadeddata')
  await vi.advanceTimersByTimeAsync(10000)
  events.emit('pause')
  rate.value = 2
  await vi.advanceTimersByTimeAsync(90000)
  events.emit('play')
  await vi.advanceTimersByTimeAsync(10000)
  changeTrack('next')
  expect(profile.getProfileState()?.completes).toBe(1)
})

it.each(['before', 'after'])('fast short-track completion vetoes the wall-clock skip (%s profile)', async(order) => {
  rate.value = 2
  scope.run(() => { profile.initRecommendProfile() })
  await vi.advanceTimersByTimeAsync(0)
  changeTrack('fast')
  mocks.progress.maxPlayTime = 40
  events.emit('playerLoadeddata')
  await vi.advanceTimersByTimeAsync(20000)
  const skip = () => { profile.recordRecommendedSkip({ id: 'fast', artist: 'Artist', title: 'fast', playedSeconds: 20 }) }
  if (order === 'before') skip()
  changeTrack('next')
  if (order === 'after') skip()
  expect(profile.getProfileState()?.completes).toBe(1)
  expect(profile.getProfileState()?.skips).toBe(0)
})

it.each(['before', 'after'])('slow short-track partial listen remains a skip (%s profile)', async(order) => {
  rate.value = 0.5
  scope.run(() => { profile.initRecommendProfile() })
  await vi.advanceTimersByTimeAsync(0)
  changeTrack('slow')
  mocks.progress.maxPlayTime = 20
  events.emit('playerLoadeddata')
  await vi.advanceTimersByTimeAsync(18000)
  const skip = () => { profile.recordRecommendedSkip({ id: 'slow', artist: 'Artist', title: 'slow', playedSeconds: 18 }) }
  if (order === 'before') skip()
  changeTrack('next')
  if (order === 'after') skip()
  expect(profile.getProfileState()?.completes).toBe(0)
  expect(profile.getProfileState()?.skips).toBe(1)
})

it.each([
  ['stop'], ['pause', 'stop'], ['stop', 'pause'],
])('stop halts listening without terminal settlement: %j', async(...boundary) => {
  scope.run(() => { profile.initRecommendProfile() })
  await vi.advanceTimersByTimeAsync(0)
  changeTrack('stopped')
  mocks.progress.maxPlayTime = 180
  events.emit('playerLoadeddata')
  await vi.advanceTimersByTimeAsync(10000)
  mocks.playing.value = false
  for (const event of boundary) events.emit(event)
  await vi.advanceTimersByTimeAsync(170000)
  expect(profile.getProfileState()?.completes).toBe(0)
  profile.recordRecommendedSkip({ id: 'stopped', artist: 'Artist', title: 'stopped', playedSeconds: 10 })
  changeTrack('next')
  expect(profile.getProfileState()?.completes).toBe(0)
  expect(profile.getProfileState()?.skips).toBe(1)
})

it.each([[20000, 0], [80000, 1]])('same-track playback resumes after Stop without counting idle time (%s ms)', async(resumedMs, complete) => {
  scope.run(() => { profile.initRecommendProfile() })
  await vi.advanceTimersByTimeAsync(0)
  changeTrack('restarted')
  mocks.progress.maxPlayTime = 100
  events.emit('playerLoadeddata')
  await vi.advanceTimersByTimeAsync(10000)
  events.emit('stop')
  await vi.advanceTimersByTimeAsync(170000)
  events.emit('play')
  await vi.advanceTimersByTimeAsync(resumedMs)
  changeTrack('next')
  expect(profile.getProfileState()?.completes).toBe(complete)
})

it('same-track selection after Stop settles only prior listening and resets the next play', async() => {
  scope.run(() => { profile.initRecommendProfile() })
  await vi.advanceTimersByTimeAsync(0)
  changeTrack('restarted')
  mocks.progress.maxPlayTime = 100
  events.emit('playerLoadeddata')
  await vi.advanceTimersByTimeAsync(10000)
  mocks.playing.value = false
  events.emit('stop')
  await vi.advanceTimersByTimeAsync(170000)
  changeTrack('restarted')
  expect(profile.getProfileState()?.completes).toBe(0)
  mocks.progress.maxPlayTime = 100
  events.emit('playerLoadeddata')
  events.emit('play')
  await vi.advanceTimersByTimeAsync(90000)
  changeTrack('next')
  expect(profile.getProfileState()?.completes).toBe(1)
})

it.each([false, true])('new rate never reweights an already settled segment (paused=%s)', async(paused) => {
  scope.run(() => { profile.initRecommendProfile() })
  await vi.advanceTimersByTimeAsync(0)
  changeTrack('song')
  mocks.progress.maxPlayTime = 160
  events.emit('playerLoadeddata')
  await vi.advanceTimersByTimeAsync(60000)
  if (paused) events.emit('pause')
  rate.value = 2
  if (paused) {
    await vi.advanceTimersByTimeAsync(90000)
    events.emit('play')
  }
  await vi.advanceTimersByTimeAsync(15000)
  changeTrack('next')
  // Heard 90/160 seconds, not 150/160 from multiplying the whole listen by the final rate.
  expect(profile.getProfileState()?.completes).toBe(0)
})
