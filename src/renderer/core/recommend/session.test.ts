import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import type * as SessionModule from './session'
import type { ExploreResult } from './engine'
import { effectScope, nextTick } from 'vue'

const mocks = vi.hoisted(() => ({
  explore: vi.fn(),
  addQueue: vi.fn(),
  removeQueue: vi.fn(),
  playNow: vi.fn(),
  recordSkip: vi.fn(),
  onProfileSignal: vi.fn(),
  saveMetrics: vi.fn(),
  playing: { value: false },
  // 本文件覆盖旧引擎（ai/local）的会话语义；平台默认路径见 platformSession.test.ts
  setting: { 'recommend.radio': false, 'recommend.radius': 50, 'recommend.autoRefill': true, 'ai.enable': false, 'recommend.engine': 'local' },
  player: { musicInfo: { id: 'anchor', singer: 'Anchor', name: 'Origin', meta: {} } as any, alternativeMusicInfos: undefined as LX.Music.MusicInfoOnline[] | undefined },
  queue: [] as any[],
}))
vi.mock('./engine', () => ({ exploreOnce: mocks.explore }))
vi.mock('./platformEngine', () => ({ explorePlatformOnce: vi.fn() }))
vi.mock('@renderer/store/setting', async() => {
  const { reactive } = await import('vue')
  return { appSetting: reactive(mocks.setting) }
})
vi.mock('@renderer/store/player/state', () => ({ playMusicInfo: mocks.player, tempPlayList: mocks.queue, isPlay: mocks.playing }))
vi.mock('@renderer/store/player/action', () => ({ addTempPlayList: mocks.addQueue, removeTempPlayList: mocks.removeQueue }))
vi.mock('@renderer/core/player', () => ({ playMusicInfoNow: mocks.playNow }))
vi.mock('@renderer/utils/data', () => ({ getRecommendMetrics: async() => null, saveRecommendMetrics: mocks.saveMetrics }))
vi.mock('./feature', () => ({ startFeatureCollection: vi.fn(), stopFeatureCollection: vi.fn() }))
vi.mock('./profile', () => ({ getProfileState: () => null, onProfileSignal: mocks.onProfileSignal, recordRecommendedSkip: mocks.recordSkip }))
// platformEngine（session 直接引入）的列表仓库依赖：mock 掉避免拉起真实 store 链（document 等）
vi.mock('@renderer/store/list/listManage/rendererListManage', () => ({ getListMusics: async() => [] }))
vi.mock('@renderer/store/list/listManage/state', () => ({ loveList: { id: 'love' }, userLists: [] }))

const result = (id: string): ExploreResult => ({
  engine: 'ai',
  anchor: { artist: 'Anchor', title: 'Origin', album: '' },
  position: '00:00',
  featureSheet: {} as any,
  analysis: { summary: '', aiUsed: true, error: null },
  rawAnalysis: {} as any,
  candidates: [{
    id,
    artist: 'Artist',
    title: id,
    album: '',
    source: 'wy',
    reason: '',
    journeyRole: 'hold',
    distance: 20,
    musicInfo: { id, singer: 'Artist', name: id, source: 'wy', meta: {} } as any,
  }],
  meta: { sourceCounts: {}, recallError: null, aiRankError: null },
})
let session: typeof SessionModule
let events: EventEmitter
let scope: ReturnType<typeof effectScope>
let setting: typeof mocks.setting
beforeEach(async() => {
  vi.resetModules()
  vi.useFakeTimers()
  vi.clearAllMocks()
  mocks.setting['recommend.radio'] = false
  mocks.setting['recommend.autoRefill'] = true
  mocks.playing.value = false
  scope = effectScope()
  mocks.player.musicInfo = { id: 'anchor', singer: 'Anchor', name: 'Origin', meta: {} }
  mocks.player.alternativeMusicInfos = undefined
  mocks.queue.splice(0)
  mocks.removeQueue.mockImplementation(index => mocks.queue.splice(index, 1))
  mocks.addQueue.mockImplementation(items => mocks.queue.push(...items))
  events = new EventEmitter()
  vi.stubGlobal('window', { lx: { isProd: true }, app_event: events })
  setting = (await import('@renderer/store/setting')).appSetting
  session = await import('./session')
})
afterEach(() => {
  scope.stop()
  mocks.setting['recommend.radio'] = false
  session.endSession()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('会话与播放队列竞态', () => {
  it.each([false, true])('停止冻结指标计时，只有恢复后主动切歌才记口味负反馈（restart=%s）', async(restart) => {
    mocks.explore.mockResolvedValue(result('song'))
    setting['recommend.autoRefill'] = false
    scope.run(() => { session.initRecommendRadio() })
    await session.startSession()
    mocks.player.musicInfo = mocks.queue[0].musicInfo
    events.emit('musicToggled')
    events.emit('play')
    await vi.advanceTimersByTimeAsync(10000)
    events.emit('stop')
    await vi.advanceTimersByTimeAsync(170000)
    if (restart) {
      events.emit('play')
      await vi.advanceTimersByTimeAsync(5000)
      events.emit('pause')
    }
    mocks.player.musicInfo = { id: 'outside', singer: 'Other', name: 'Outside', meta: {} }
    events.emit('musicToggled')
    if (restart) expect(mocks.recordSkip).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 'song', playedSeconds: 15 }))
    else expect(mocks.recordSkip).not.toHaveBeenCalled()
    expect(mocks.saveMetrics.mock.lastCall?.[0]).toMatchObject({ recommendedEnded: 1, skippedUnder30s: 1 })
    expect(events.listenerCount('stop')).toBe(1)
    session.endSession()
    expect(events.listenerCount('stop')).toBe(0)
  })

  it('关台期间听完、切歌后重开，不把旧推荐曲误记为短播跳过', async() => {
    mocks.explore.mockResolvedValue(result('song'))
    setting['recommend.autoRefill'] = false
    scope.run(() => { session.initRecommendRadio() })
    setting['recommend.radio'] = true
    await nextTick()
    await vi.waitFor(() => { expect(mocks.queue).toHaveLength(1) })
    mocks.player.musicInfo = mocks.queue[0].musicInfo
    events.emit('musicToggled')
    events.emit('play')
    await vi.advanceTimersByTimeAsync(5000)
    events.emit('pause')

    setting['recommend.radio'] = false
    await nextTick()
    expect(events.listenerCount('musicToggled')).toBe(0)
    events.emit('play')
    await vi.advanceTimersByTimeAsync(180000)
    events.emit('pause')
    mocks.player.musicInfo = { id: 'outside', singer: 'Other', name: 'Outside', meta: {} }
    events.emit('musicToggled')

    setting['recommend.radio'] = true
    await nextTick()
    await vi.waitFor(() => { expect(mocks.queue).toHaveLength(1) })
    events.emit('musicToggled')
    expect(mocks.recordSkip).not.toHaveBeenCalled()
    expect(mocks.saveMetrics.mock.lastCall?.[0]).toMatchObject({ recommendedEnded: 0, skippedUnder30s: 0, runCount: 2 })
  })

  it('同 run 重锚保留切歌订阅和新曲计时，旧推荐曲只结算一次', async() => {
    mocks.explore.mockResolvedValue(result('song'))
    setting['recommend.radio'] = true
    setting['recommend.autoRefill'] = false
    scope.run(() => { session.initRecommendRadio() })
    await session.startSession()
    const core = await import('./session-core')
    const metrics = vi.spyOn(core, 'reduceMetrics')
    mocks.player.musicInfo = mocks.queue[0].musicInfo
    mocks.playing.value = true
    events.emit('musicToggled')
    events.emit('play')
    await vi.advanceTimersByTimeAsync(5000)
    mocks.player.musicInfo = { id: 'outside', singer: 'Other', name: 'Outside', meta: {} }
    events.emit('musicToggled')
    expect(session.sessionView.value.anchor.id).toBe('outside')
    expect(events.listenerCount('musicToggled')).toBe(1)
    await vi.advanceTimersByTimeAsync(7000)
    mocks.player.musicInfo = { id: 'next-outside', singer: 'Other', name: 'Next', meta: {} }
    events.emit('musicToggled')
    expect(mocks.recordSkip).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 'song', playedSeconds: 5 }))
    expect(metrics).toHaveBeenCalledWith(expect.anything(), { type: 'trackEnded', recommendedId: null, playedSeconds: 7 })
    expect(mocks.saveMetrics.mock.lastCall?.[0]).toMatchObject({ recommendedEnded: 1, skippedUnder30s: 1, runCount: 1 })
    metrics.mockRestore()
  })

  it('收台只删除推荐入队实例，保留用户手动加入的同 ID 项', async() => {
    mocks.explore.mockResolvedValueOnce(result('song'))
    await session.startSession()
    const manual = { listId: 'manual-list', musicInfo: mocks.queue[0].musicInfo }
    mocks.queue.push(manual)
    expect(session.sessionView.value.remaining).toBe(1)
    session.endSession()
    expect(mocks.queue).toEqual([manual])
  })

  it('重锚只清旧会话的推荐实例，保留手动项', async() => {
    mocks.explore.mockResolvedValueOnce(result('song'))
    await session.startSession()
    const manual = { listId: 'manual-list', musicInfo: mocks.queue[0].musicInfo }
    mocks.queue.push(manual)
    mocks.player.musicInfo = { id: 'new-anchor', singer: 'New Artist', name: 'New Anchor', meta: {} }
    mocks.explore.mockResolvedValueOnce(result('new-song'))
    await session.startSession()
    expect(mocks.queue).toContain(manual)
    expect(mocks.queue.map(item => item.musicInfo.id)).toEqual(['song', 'new-song'])
  })

  it('路径跳播优先消费推荐实例，不消费先到的手动同 ID 项', async() => {
    mocks.explore.mockResolvedValueOnce(result('song'))
    await session.startSession()
    const manual = { listId: 'manual-list', musicInfo: mocks.queue[0].musicInfo }
    mocks.queue.unshift(manual)
    session.playPathItem('song')
    expect(mocks.queue).toEqual([manual])
  })

  it('请求期间新增的手动同曲项在提交前去重，不登记为推荐归属', async() => {
    let resolvePlan!: (value: ExploreResult) => void
    mocks.explore.mockImplementationOnce(async() => new Promise(resolve => { resolvePlan = resolve }))
    const pending = session.startSession()
    const manual = { listId: 'manual-list', musicInfo: { id: 'tx_song', singer: 'Artist', name: 'song', source: 'tx', meta: {} } }
    mocks.queue.push(manual)
    resolvePlan(result('song'))
    await pending
    expect(mocks.queue).toEqual([manual])
    expect(session.sessionView.value.path).toEqual([])
    expect(session.sessionView.value.recommendedIds).toEqual([])
    expect(mocks.addQueue).not.toHaveBeenCalled()
  })

  it('旧计划返回后不入队，也不删除新会话同 id 的歌曲', async() => {
    let resolveOld!: (value: ExploreResult) => void
    mocks.explore.mockImplementationOnce(async() => new Promise(resolve => { resolveOld = resolve }))
    const oldPlan = session.startSession()
    const oldOptions = mocks.explore.mock.calls[0][0]
    expect(oldOptions.enqueue).toBe(false)
    session.endSession()
    mocks.player.musicInfo = { id: 'new-anchor', singer: 'New', name: 'New', meta: {} }
    mocks.explore.mockResolvedValueOnce(result('shared-song'))
    await session.startSession()
    expect(oldOptions.isCancelled()).toBe(true)
    resolveOld(result('shared-song'))
    await oldPlan
    expect(mocks.addQueue).toHaveBeenCalledTimes(1)
    expect(mocks.queue.map(item => item.musicInfo.id)).toEqual(['shared-song'])
    expect(mocks.removeQueue).not.toHaveBeenCalled()
  })

  it('请求途中多次修改约束，完成后仅补一次并采用最新约束', async() => {
    let resolveInitial!: (value: ExploreResult) => void
    mocks.explore.mockImplementationOnce(async() => new Promise(resolve => { resolveInitial = resolve }))
    const pending = session.startSession()
    session.setInstruction('不要华语')
    await vi.advanceTimersByTimeAsync(1200)
    session.setInstruction('不要电子')
    await vi.advanceTimersByTimeAsync(1200)
    expect(mocks.explore).toHaveBeenCalledTimes(1)
    mocks.explore.mockResolvedValueOnce(result('new-song'))
    resolveInitial(result('first-song'))
    await pending
    await vi.advanceTimersByTimeAsync(1200)
    expect(mocks.explore).toHaveBeenCalledTimes(2)
    expect(mocks.explore.mock.calls[1][0].instruction).toContain('不要电子')
    expect(mocks.explore.mock.calls[1][0].reuseAnalysis).toBeUndefined()
  })

  it('手动操作触发的新计划成功后，旧失败重试定时器不会再补一批', async() => {
    mocks.explore.mockResolvedValueOnce(result('first-song'))
    await session.startSession()
    mocks.explore.mockRejectedValueOnce(new Error('unavailable'))
    session.setRadius(40)
    await vi.advanceTimersByTimeAsync(1200)
    expect(session.refillState.value).toBe('retrying')
    mocks.explore.mockResolvedValueOnce(result('next-song'))
    session.setRadius(45)
    await vi.advanceTimersByTimeAsync(1200)
    expect(session.refillState.value).toBe('idle')
    await vi.advanceTimersByTimeAsync(60000)
    expect(mocks.explore).toHaveBeenCalledTimes(3)
  })

  it('路径跳播先移除目标，保留其他待播项，已播曲可重播', async() => {
    mocks.explore.mockResolvedValueOnce(result('song'))
    await session.startSession()
    mocks.queue.push({ musicInfo: { id: 'manual' } })
    session.playPathItem('song')
    expect(mocks.playNow).toHaveBeenCalledWith(expect.objectContaining({ id: 'song' }), null, undefined)
    expect(mocks.queue.map(item => item.musicInfo.id)).toEqual(['manual'])
    session.playPathItem('song')
    expect(mocks.playNow).toHaveBeenCalledTimes(2)
    expect(mocks.queue).toHaveLength(1)
  })
})


describe('session source identity projections', () => {
  const sourceResult = (): ExploreResult => {
    const value = result('wy_song')
    value.candidates[0] = {
      ...value.candidates[0],
      artist: 'Primary',
      title: 'Song',
      musicInfo: { id: 'wy_song', singer: 'Primary', name: 'Song', source: 'wy', meta: {} } as any,
      alternativeMusicInfos: [{ id: 'tx_song', singer: 'Alias', name: 'Song', source: 'tx', meta: {} } as any],
    }
    return value
  }

  it('refill history includes each retained source artist and ID', async() => {
    mocks.explore.mockResolvedValue(sourceResult())
    await session.startSession()
    expect(session.sessionView.value.recommendedIds).toEqual(['wy_song', 'tx_song'])
    mocks.queue.splice(0)
    session.setRadius(40)
    await vi.advanceTimersByTimeAsync(1200)
    const options = mocks.explore.mock.calls[1][0]
    expect(options.excludeIds).toEqual(['wy_song', 'tx_song'])
    expect(options.excludeTracks).toEqual(expect.arrayContaining([
      expect.objectContaining({ artist: 'Primary', title: 'Song' }),
      expect.objectContaining({ artist: 'Alias', title: 'Song' }),
    ]))
  })

  it('playing an alternative source stays on path and preserves the original reason and all sources', async() => {
    setting['recommend.radio'] = true
    setting['recommend.autoRefill'] = false
    const recommendation = sourceResult()
    recommendation.candidates[0].reason = 'retained reason'
    mocks.explore.mockResolvedValue(recommendation)
    scope.run(() => { session.initRecommendRadio() })
    await session.startSession()
    mocks.player.musicInfo = recommendation.candidates[0].alternativeMusicInfos?.[0]
    mocks.player.alternativeMusicInfos = [recommendation.candidates[0].musicInfo!]
    events.emit('musicToggled')
    expect(session.sessionView.value.anchor.id).toBe('anchor')
    expect(session.sessionView.value.path).toHaveLength(1)
    expect(session.sessionView.value.path[0]).toMatchObject({ id: 'tx_song', state: 'played', reason: 'retained reason', isCurrent: true })
    expect(session.sessionView.value.path[0].alternativeMusicInfos).toEqual(expect.arrayContaining([recommendation.candidates[0].musicInfo]))
    expect(mocks.saveMetrics.mock.lastCall?.[0]).toMatchObject({ recommendedStarted: 1, plannedBatches: 1, consumedBatches: 1 })
    session.playPathItem('tx_song')
    expect(mocks.queue).toHaveLength(0)
    expect(mocks.playNow).toHaveBeenLastCalledWith(recommendation.candidates[0].musicInfo, null, recommendation.candidates[0].alternativeMusicInfos)
  })

  it('dislike keeps recommendation source evidence when playback only exposes one source', async() => {
    const recommendation = sourceResult()
    mocks.explore.mockResolvedValue(recommendation)
    await session.startSession()
    mocks.player.musicInfo = recommendation.candidates[0].alternativeMusicInfos?.[0]
    session.applyFeedback('dislike')
    expect(session.sessionView.value.dislikedTracks).toEqual(expect.arrayContaining([
      { artist: 'Primary', title: 'Song' }, { artist: 'Alias', title: 'Song' },
    ]))
  })

  it.each(['love', 'complete'])('retained source artist supports %s endorsement without a matching ID', async(kind) => {
    mocks.explore.mockResolvedValue(sourceResult())
    await session.startSession()
    mocks.onProfileSignal.mock.calls[0][0]({ kind, id: 'fresh-id', artist: 'Alias', title: 'Song (Live)' })
    expect(session.sessionView.value.positiveArtists).toEqual([])
    mocks.onProfileSignal.mock.calls[0][0]({ kind, id: 'fresh-id', artist: 'Alias', title: 'Song' })
    expect(session.sessionView.value.positiveArtists).toContain('Alias')
    await vi.advanceTimersByTimeAsync(1200)
    expect(mocks.explore).toHaveBeenCalledTimes(2)
  })
})
