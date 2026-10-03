import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import type * as SessionModule from './session'

const mocks = vi.hoisted(() => {
  // 旧 AI 配置齐全且开关为开：平台默认模式下仍不得发任何 LLM 请求
  const setting: Record<string, any> = {
    'recommend.radio': false,
    'recommend.radius': 50,
    'recommend.autoRefill': true,
    'ai.enable': true,
    'ai.apiKey': 'legacy-key',
    'ai.model': 'legacy-model',
  }
  return {
    // 旧 AI 引擎入口（平台模式下必须不被调用——无静默回退）
    explore: vi.fn(),
    // 平台召回边界（真实 platformEngine 的依赖）
    platformRecall: vi.fn(),
    // LLM 客户端间谍（平台模式全链路必须 0 调用）
    llm: vi.fn(),
    llmValidated: vi.fn(),
    addQueue: vi.fn(),
    removeQueue: vi.fn(),
    playNow: vi.fn(),
    getListMusics: vi.fn(),
    onProfileSignal: vi.fn(),
    recordSkip: vi.fn(),
    isPlay: { value: false },
    setting,
    player: { musicInfo: null as any, alternativeMusicInfos: undefined as LX.Music.MusicInfoOnline[] | undefined },
    queue: [] as any[],
  }
})
vi.mock('./engine', () => ({ exploreOnce: mocks.explore }))
vi.mock('./platformRecall', () => ({ recallPlatformSimilar: mocks.platformRecall }))
vi.mock('./llm', () => ({ llmComplete: mocks.llm, llmCompleteWithValidation: mocks.llmValidated }))
vi.mock('@renderer/store/setting', () => ({ appSetting: mocks.setting }))
vi.mock('@renderer/store/player/state', () => ({ playMusicInfo: mocks.player, tempPlayList: mocks.queue, isPlay: mocks.isPlay }))
vi.mock('@renderer/store/player/action', () => ({ addTempPlayList: mocks.addQueue, removeTempPlayList: mocks.removeQueue }))
vi.mock('@renderer/core/player', () => ({ playMusicInfoNow: mocks.playNow }))
vi.mock('@renderer/utils/data', () => ({ getRecommendMetrics: async() => null, saveRecommendMetrics: vi.fn() }))
vi.mock('./feature', () => ({ startFeatureCollection: vi.fn(), stopFeatureCollection: vi.fn() }))
vi.mock('./profile', () => ({ getProfileState: () => null, onProfileSignal: mocks.onProfileSignal, recordRecommendedSkip: mocks.recordSkip }))
vi.mock('@renderer/store/list/listManage/rendererListManage', () => ({ getListMusics: mocks.getListMusics }))
vi.mock('@renderer/store/list/listManage/state', () => ({ loveList: { id: 'love' }, userLists: [] }))

/** 平台召回结果（FusedCandidate 形状的最小构造）。 */
const fusedItem = (id: string, name: string, singer: string) => ({
  artist: singer,
  title: name,
  album: 'Album',
  musicInfo: { id, name, singer, source: 'wy', interval: '04:00', meta: {} } as any,
  fusionScore: 1,
  alternativeMusicInfos: [] as LX.Music.MusicInfoOnline[],
  sources: [{ provider: 'wy' as const, rank: 1, musicInfo: { id, name, singer, source: 'wy', meta: {} } as any }],
})
const recallOk = (items = [fusedItem('wy_1', '花海', '周杰伦')]) => ({
  state: 'ok' as const,
  items,
  providers: [{ provider: 'wy' as const, status: 'success' as const, seedId: '186016', fromCache: false }],
  error: null,
})

let session: typeof SessionModule
beforeEach(async() => {
  vi.resetModules()
  vi.useFakeTimers()
  vi.clearAllMocks()
  mocks.setting['recommend.autoRefill'] = true
  mocks.setting['recommend.radio'] = false
  mocks.isPlay.value = false
  delete mocks.setting['recommend.engine']
  mocks.player.musicInfo = {
    id: 'wy_186016',
    singer: '周杰伦',
    name: '晴天',
    source: 'wy',
    interval: '04:29',
    meta: { songId: '186016', albumName: '叶惠美' },
  }
  mocks.player.alternativeMusicInfos = undefined
  mocks.queue.splice(0)
  mocks.removeQueue.mockImplementation(index => mocks.queue.splice(index, 1))
  mocks.addQueue.mockImplementation(items => mocks.queue.push(...items))
  mocks.getListMusics.mockResolvedValue([])
  mocks.platformRecall.mockResolvedValue(recallOk())
  vi.stubGlobal('window', { lx: { isProd: true }, app_event: new EventEmitter() })
  session = await import('./session')
})

const emitEvent = (name: string, ...args: unknown[]): void => {
  ;(window.app_event as unknown as EventEmitter).emit(name, ...args)
}
const endorse = (kind: 'complete' | 'love' = 'complete'): void => {
  mocks.onProfileSignal.mock.calls[0][0]({ kind, id: 'wy_1', artist: '周杰伦', title: '花海' })
}
const changeSong = (id: string, reason: LX.Player.MusicChangeReason = 'user'): void => {
  mocks.player.musicInfo = fusedItem(id, '花海', '周杰伦').musicInfo
  emitEvent('musicToggled', reason)
}

describe('隐式续补服从设置和队列容量', () => {
  it.each(['complete', 'love'] as const)('关闭自动续补后 %s 仍更新偏好但不补队列', async(kind) => {
    mocks.setting['recommend.autoRefill'] = false
    await session.startSession()
    endorse(kind)
    await vi.advanceTimersByTimeAsync(1500)
    expect(mocks.platformRecall).toHaveBeenCalledOnce()
    // 用户显式调参仍可续补，且读取到刚更新的会话偏好。
    session.setRadius(40)
    await vi.advanceTimersByTimeAsync(1200)
    expect(mocks.platformRecall).toHaveBeenCalledTimes(2)
    expect(mocks.platformRecall.mock.calls[1][1].profileBoost('周杰伦')).toBe(10)
  })

  it('队列充足时听完不触发续补', async() => {
    mocks.platformRecall.mockResolvedValue(recallOk([
      fusedItem('wy_1', '花海', '周杰伦'),
      ...Array.from({ length: 4 }, (_, i) => fusedItem(`other-${i}`, `Song ${i}`, `Artist ${i}`)),
    ]))
    await session.startSession()
    expect(mocks.queue.length).toBeGreaterThan(3)
    endorse()
    await vi.advanceTimersByTimeAsync(1500)
    expect(mocks.platformRecall).toHaveBeenCalledOnce()
  })

  it('队列不足且允许自动续补时听完正常补歌', async() => {
    await session.startSession()
    endorse()
    await vi.advanceTimersByTimeAsync(1200)
    expect(mocks.platformRecall).toHaveBeenCalledTimes(2)
  })

  it('防抖等待期间关闭自动续补后不再发起请求', async() => {
    await session.startSession()
    endorse()
    mocks.setting['recommend.autoRefill'] = false
    await vi.advanceTimersByTimeAsync(1500)
    expect(mocks.platformRecall).toHaveBeenCalledOnce()
    expect(session.refillState.value).toBe('idle')
  })

  it('隐式事件不能把已经安排的显式续补降级', async() => {
    await session.startSession()
    session.setRadius(40)
    endorse()
    mocks.setting['recommend.autoRefill'] = false
    await vi.advanceTimersByTimeAsync(1500)
    expect(mocks.platformRecall).toHaveBeenCalledTimes(2)
  })

  it('自动续补请求途中关闭开关后丢弃结果', async() => {
    await session.startSession()
    let release!: (value: ReturnType<typeof recallOk>) => void
    mocks.platformRecall.mockImplementationOnce(async() => new Promise(resolve => { release = resolve }))
    endorse()
    await vi.advanceTimersByTimeAsync(1200)
    expect(release).toBeDefined()
    mocks.setting['recommend.autoRefill'] = false
    release(recallOk([fusedItem('wy_2', '新歌', '新艺人')]))
    await vi.advanceTimersByTimeAsync(0)
    expect(mocks.addQueue).toHaveBeenCalledOnce()
    expect(session.refillState.value).toBe('idle')
  })

  it('自动续补失败后的重试也遵守开关', async() => {
    await session.startSession()
    mocks.platformRecall.mockRejectedValueOnce(new Error('offline'))
    endorse()
    await vi.advanceTimersByTimeAsync(1200)
    expect(session.refillState.value).toBe('retrying')
    mocks.setting['recommend.autoRefill'] = false
    await vi.advanceTimersByTimeAsync(16000)
    expect(mocks.platformRecall).toHaveBeenCalledTimes(2)
    expect(session.refillState.value).toBe('idle')
  })
})

describe('推荐曲负反馈只来自实际收听后的主动切歌', () => {
  beforeEach(() => { mocks.setting['recommend.autoRefill'] = false })

  it('从未开始播放的歌曲不计负反馈，即使上一曲的 isPlay 尚未清零', async() => {
    await session.startSession()
    mocks.isPlay.value = true
    changeSong('wy_1')
    await vi.advanceTimersByTimeAsync(10000)
    changeSong('other')
    expect(mocks.recordSkip).not.toHaveBeenCalled()
  })

  it.each(['ended', 'error', 'removed'] as const)('%s 自动切换不计口味负反馈', async(reason) => {
    await session.startSession()
    changeSong('wy_1')
    emitEvent('play')
    await vi.advanceTimersByTimeAsync(10000)
    changeSong('other', reason)
    expect(mocks.recordSkip).not.toHaveBeenCalled()
  })

  it.each(['playerError', 'error', 'stop'])('%s 中断后用户切歌也不计口味负反馈', async(event) => {
    await session.startSession()
    changeSong('wy_1')
    emitEvent('play')
    await vi.advanceTimersByTimeAsync(10000)
    emitEvent(event)
    changeSong('other')
    expect(mocks.recordSkip).not.toHaveBeenCalled()
  })

  it('主动短听跳过仍记负反馈，暂停时间不计入播放时长', async() => {
    await session.startSession()
    changeSong('wy_1')
    emitEvent('play')
    await vi.advanceTimersByTimeAsync(10000)
    emitEvent('pause')
    await vi.advanceTimersByTimeAsync(40000)
    changeSong('other')
    expect(mocks.recordSkip).toHaveBeenCalledExactlyOnceWith({ id: 'wy_1', artist: '周杰伦', title: '花海', playedSeconds: 10 })
  })

  it('错误后恢复播放，后续主动切歌仍可形成负反馈', async() => {
    await session.startSession()
    changeSong('wy_1')
    emitEvent('error')
    emitEvent('play')
    await vi.advanceTimersByTimeAsync(10000)
    changeSong('other')
    expect(mocks.recordSkip).toHaveBeenCalledOnce()
  })
})
afterEach(() => { session.endSession(); vi.useRealTimers(); vi.unstubAllGlobals() })

describe('平台推荐默认路径：零 LLM 与无静默回退（AC3）', () => {
  it('平台请求中收藏的同曲不入队，也不登记到路径和推荐归属', async() => {
    let release!: (value: ReturnType<typeof recallOk>) => void
    mocks.platformRecall.mockImplementationOnce(async() => new Promise(resolve => { release = resolve }))
    const pending = session.startSession()
    await vi.waitFor(() => { expect(mocks.platformRecall).toHaveBeenCalledOnce() })
    mocks.getListMusics.mockResolvedValue([{ id: 'tx_loved', singer: '周杰伦', name: '花海' }])
    release(recallOk())
    await pending
    expect(mocks.addQueue).not.toHaveBeenCalled()
    expect(session.sessionView.value.path).toEqual([])
    expect(session.sessionView.value.recommendedIds).toEqual([])
    expect(session.lastPlatformState.value).toBe('empty-after-filter')
  })

  it('读取提交前收藏期间收台重开，旧检查完成后不影响新会话', async() => {
    let release!: (items: any[]) => void
    mocks.getListMusics.mockResolvedValueOnce([]).mockImplementationOnce(async() => new Promise(resolve => { release = resolve }))
    const pending = session.startSession()
    await vi.waitFor(() => { expect(mocks.getListMusics).toHaveBeenCalledTimes(2) })
    session.endSession()
    mocks.player.musicInfo = { ...mocks.player.musicInfo, id: 'new-anchor' }
    await session.startSession()
    release([])
    await pending
    expect(mocks.addQueue).toHaveBeenCalledOnce()
    expect(session.sessionView.value.anchor.id).toBe('new-anchor')
    expect(session.sessionView.value.recommendedIds).toEqual(['wy_1'])
    expect(mocks.queue).toHaveLength(1)
  })

  it('默认模式（含旧 ai.enable=true）：初始推荐走平台路径，0 次 LLM、不进旧引擎', async() => {
    await session.startSession()
    expect(mocks.platformRecall).toHaveBeenCalledTimes(1)
    expect(mocks.explore).not.toHaveBeenCalled()
    expect(mocks.llm).not.toHaveBeenCalled()
    expect(mocks.llmValidated).not.toHaveBeenCalled()
    // 入队为队尾追加（不打断当前播放）
    expect(mocks.addQueue).toHaveBeenCalledTimes(1)
    expect(mocks.addQueue.mock.calls[0][0][0]).toMatchObject({ isTop: false })
  })

  it('锚点携带来源与原生平台标识传给召回（不解析全局 id 猜测）', async() => {
    await session.startSession()
    const anchor = mocks.platformRecall.mock.calls[0][0]
    expect(anchor.source).toBe('wy')
    expect(anchor.seedIds).toEqual({ wy: '186016' })
    expect(anchor.intervalSec).toBe(269)
    expect(anchor.id).toBe('wy_186016')
  })

  it('续补（改距离触发）仍走平台路径且 0 次 LLM，并排除已推荐曲目', async() => {
    await session.startSession()
    session.setRadius(40)
    await vi.advanceTimersByTimeAsync(1200)
    expect(mocks.platformRecall).toHaveBeenCalledTimes(2)
    expect(mocks.explore).not.toHaveBeenCalled()
    expect(mocks.llm).not.toHaveBeenCalled()
    const refillOptions = mocks.platformRecall.mock.calls[1][1]
    expect(refillOptions.excludeIds).toContain('wy_1')
  })

  it('反馈（喜欢/不再推荐）0 次 LLM；喜欢进入平台画像加成，不再推荐进入后续召回排除', async() => {
    await session.startSession()
    session.applyFeedback('good')
    await vi.advanceTimersByTimeAsync(1200)
    const afterGood = mocks.platformRecall.mock.calls[1][1]
    expect(afterGood.profileBoost('周杰伦')).toBe(10)
    session.applyFeedback('dislike')
    await vi.advanceTimersByTimeAsync(1200)
    expect(mocks.llm).not.toHaveBeenCalled()
    expect(mocks.platformRecall).toHaveBeenCalledTimes(3)
    const afterDislike = mocks.platformRecall.mock.calls[2][1]
    expect(afterDislike.dislikedTracks).toEqual([{ artist: '周杰伦', title: '晴天' }])
  })

  it('平台全部失败：走有限重试，不静默回退旧 AI 引擎或关键词搜索', async() => {
    mocks.platformRecall.mockResolvedValue({ ...recallOk([]), state: 'all-failed', error: 'wy: down；tx: down', items: [] })
    await session.startSession().catch(() => {})
    // initial 失败不重试（重试只作用于 refill），但也不触发旧引擎
    expect(mocks.platformRecall).toHaveBeenCalledTimes(1)
    expect(mocks.explore).not.toHaveBeenCalled()
    expect(mocks.llm).not.toHaveBeenCalled()
    expect(session.refillState.value).toBe('idle')
  })

  it('候选用尽：非失败状态，不重试相同来源，会话保持可切换起点', async() => {
    mocks.platformRecall.mockResolvedValue({ ...recallOk([]), state: 'exhausted', items: [] })
    await session.startSession()
    expect(session.refillState.value).toBe('idle')
    expect(session.lastPlatformState.value).toBe('exhausted')
    // 无重试定时器：长时间推进后不再发起相同请求
    await vi.advanceTimersByTimeAsync(60_000)
    expect(mocks.platformRecall).toHaveBeenCalledTimes(1)
    // 会话仍活跃（切换起点可重新开台）
    expect(session.sessionView.value.active).toBe(true)
  })

  it('无匹配/空结果/过滤完状态可区分展示', async() => {
    for (const state of ['no-match', 'empty', 'empty-after-filter'] as const) {
      mocks.platformRecall.mockResolvedValueOnce({ ...recallOk([]), state, items: [] })
      await session.startSession()
      expect(session.lastPlatformState.value).toBe(state)
      expect(mocks.addQueue).not.toHaveBeenCalled()
      session.endSession()
    }
  })
})

describe('旧引擎值的兼容加载（显式选择才进入）', () => {
  it("显式 'ai'：走旧 AI 引擎并携带 AI 配置", async() => {
    mocks.setting['recommend.engine'] = 'ai'
    mocks.explore.mockResolvedValue({
      engine: 'ai',
      anchor: { artist: '周杰伦', title: '晴天', album: '' },
      position: '',
      featureSheet: {} as any,
      analysis: { summary: '', aiUsed: true, error: null },
      rawAnalysis: {} as any,
      candidates: [],
      meta: { sourceCounts: {}, recallError: null, aiRankError: null },
    })
    await session.startSession()
    expect(mocks.explore).toHaveBeenCalledTimes(1)
    expect(mocks.explore.mock.calls[0][0].ai).toMatchObject({ apiKey: 'legacy-key', model: 'legacy-model' })
    expect(mocks.platformRecall).not.toHaveBeenCalled()
  })

  it("显式 'local'：走旧引擎但不携带 AI 配置（0 LLM）", async() => {
    mocks.setting['recommend.engine'] = 'local'
    mocks.explore.mockResolvedValue({
      engine: 'local',
      anchor: { artist: '周杰伦', title: '晴天', album: '' },
      position: '',
      featureSheet: {} as any,
      analysis: { summary: '', aiUsed: false, error: null },
      rawAnalysis: {} as any,
      candidates: [],
      meta: { sourceCounts: {}, recallError: null, aiRankError: null },
    })
    await session.startSession()
    expect(mocks.explore).toHaveBeenCalledTimes(1)
    expect(mocks.explore.mock.calls[0][0].ai).toBeUndefined()
    expect(mocks.llm).not.toHaveBeenCalled()
  })

  it('垃圾 engine 值回落平台路径（平台推荐为默认）', async() => {
    mocks.setting['recommend.engine'] = 'garbage'
    await session.startSession()
    expect(mocks.platformRecall).toHaveBeenCalledTimes(1)
    expect(mocks.explore).not.toHaveBeenCalled()
  })
})


it('备用平台信息随推荐入队、路径跳播和已播曲重播保留', async() => {
  const item = fusedItem('wy_1', 'Song', 'Artist')
  const alternative = { ...item.musicInfo, id: 'tx_1', source: 'tx' }
  item.sources.push({ provider: 'tx' as any, rank: 1, musicInfo: alternative })
  item.alternativeMusicInfos.push(alternative)
  mocks.platformRecall.mockResolvedValue(recallOk([item]))
  await session.startSession()
  expect(mocks.queue[0].alternativeMusicInfos).toEqual([alternative])
  session.playPathItem('wy_1')
  expect(mocks.playNow).toHaveBeenLastCalledWith(item.musicInfo, null, [alternative])
  mocks.player.musicInfo = item.musicInfo
  ;(window.app_event as unknown as EventEmitter).emit('musicToggled')
  expect(session.sessionView.value.path[0].state).toBe('played')
  session.playPathItem('wy_1')
  expect(mocks.playNow).toHaveBeenLastCalledWith(item.musicInfo, null, [alternative])
})


describe('platform session retained source history', () => {
  it('anchor and dislike preserve preferred and alternative metadata, including download playback', async() => {
    const preferred = mocks.player.musicInfo
    const alternative = { ...preferred, id: 'tx_anchor', source: 'tx', singer: 'Jay Chou', meta: { id: 'tx_native' } }
    mocks.player.musicInfo = { progress: {}, metadata: { musicInfo: preferred } }
    mocks.player.alternativeMusicInfos = [alternative]
    await session.startSession()
    expect(mocks.platformRecall.mock.calls[0][0]).toMatchObject({ musicInfo: preferred, alternativeMusicInfos: [alternative] })
    expect(session.sessionView.value.anchor).toMatchObject({ musicInfo: preferred, alternativeMusicInfos: [alternative] })
    session.applyFeedback('dislike')
    await vi.advanceTimersByTimeAsync(1200)
    expect(mocks.platformRecall.mock.calls[1][1].dislikedTracks).toEqual(expect.arrayContaining([
      { artist: '周杰伦', title: '晴天' }, { artist: 'Jay Chou', title: '晴天' },
    ]))
  })

  it.each([false, true])('opening an existing anchor through retained source IDs is idempotent (current evidence=%s)', async(currentEvidence) => {
    const preferred = mocks.player.musicInfo
    const alternate = { ...preferred, id: 'tx_anchor', source: 'tx', singer: 'Jay Chou' }
    if (!currentEvidence) mocks.player.alternativeMusicInfos = [alternate]
    await session.startSession()
    mocks.player.musicInfo = alternate
    mocks.player.alternativeMusicInfos = currentEvidence ? [preferred] : undefined
    await session.startSession()
    expect(mocks.platformRecall).toHaveBeenCalledOnce()
    expect(session.sessionView.value.anchor.id).toBe(preferred.id)
    expect(mocks.removeQueue).not.toHaveBeenCalled()
  })

  it('platform refill preserves history aliases and source IDs after the queue is consumed', async() => {
    const item = fusedItem('wy_song', 'Song', 'Primary')
    const alternate = { ...item.musicInfo, id: 'tx_song', source: 'tx', singer: 'Alias' }
    item.sources.push({ provider: 'tx' as any, rank: 1, musicInfo: alternate })
    item.alternativeMusicInfos.push(alternate)
    mocks.platformRecall.mockResolvedValue(recallOk([item]))
    await session.startSession()
    mocks.queue.splice(0)
    session.setRadius(40)
    await vi.advanceTimersByTimeAsync(1200)
    const options = mocks.platformRecall.mock.calls[1][1]
    expect(options.excludeIds).toEqual(['wy_song', 'tx_song'])
    expect(options.excludeTracks).toEqual(expect.arrayContaining([
      expect.objectContaining({ artist: 'Primary', title: 'Song' }),
      expect.objectContaining({ artist: 'Alias', title: 'Song' }),
    ]))
  })
})
