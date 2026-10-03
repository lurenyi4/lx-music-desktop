import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toNewMusicInfo } from '@common/utils/tools'
import { addDislikeInfo, clearDislikeInfo } from '@renderer/store/dislikeList/action'
import { exploreOnce, type ExploreOptions } from './engine'
import { normalizeAnalysis } from './prompts'

const mocks = vi.hoisted(() => ({
  search: vi.fn(),
  getList: vi.fn(),
  addQueue: vi.fn(),
  invoke: vi.fn(),
  queue: [] as any[],
  lists: [] as Array<{ id: string }>,
}))
// Exercise real conversion, recall, grouping, ranking and submission in both modes.
vi.mock('@renderer/utils', async() => import('@common/utils/tools'))
vi.mock('@renderer/utils/musicSdk', () => ({ default: { searchMusic: mocks.search } }))
vi.mock('@renderer/store/player/action', () => ({ addTempPlayList: mocks.addQueue }))
vi.mock('@renderer/store/player/state', () => ({ tempPlayList: mocks.queue, playedList: [], playMusicInfo: { musicInfo: null } }))
vi.mock('@renderer/store/list/listManage/rendererListManage', () => ({ getListMusics: mocks.getList }))
vi.mock('@renderer/store/list/listManage/state', () => ({ loveList: { id: 'love' }, userLists: mocks.lists }))
vi.mock('@renderer/store/player/playProgress', () => ({ playProgress: { nowPlayTimeStr: '0:00' } }))
vi.mock('@renderer/store/setting', () => ({ appSetting: { 'ai.maxConcurrentRequests': 3 } }))
vi.mock('@common/rendererIpc', () => ({ rendererInvoke: mocks.invoke }))
vi.mock('./feature', () => ({ summarizeBuckets: () => ({ valid: false, text: '' }) }))

const raw = (source: string, songmid: string, singer: string, name = 'S1') => ({
  source, songmid, singer, name, songId: 1, albumName: 'Album', interval: '03:00', types: [], _types: {},
})
const preferred = raw('wy', 'one', '冯沁苑')
const alias = raw('tx', 'two', '冯沁苑（买辣椒也用券）')
const safe = raw('wy', 'safe', 'Unrelated Artist', 'Different Song')
const favorite = () => toNewMusicInfo(raw('tx', 'favorite', '买辣椒也用券'))
const anchor = { artist: 'Anchor Artist', title: 'Origin', id: 'anchor' }
const sourceIds = (item: { musicInfo?: LX.Music.MusicInfo, alternativeMusicInfos?: LX.Music.MusicInfo[] }) =>
  [item.musicInfo, ...(item.alternativeMusicInfos ?? [])].map(info => info?.id)

beforeEach(() => {
  vi.clearAllMocks()
  clearDislikeInfo()
  mocks.queue.splice(0)
  mocks.lists.splice(0)
  mocks.getList.mockResolvedValue([])
  mocks.search.mockResolvedValue([{ source: 'all', list: [preferred, alias, safe] }])
  mocks.invoke.mockImplementation(async(_event, params) => {
    const input = params.messages[1].content.split('下面是音乐平台返回的真实候选：\n')[1]
    const candidates = JSON.parse(input) as unknown[]
    const ranking = candidates.map((_, candidateId) => ({
      candidate_id: candidateId,
      score: 0.9,
      confidence: 'high',
      perceptual_distance: 20,
      next_song_worthiness: 0.9,
      meaningful_difference: 0.8,
      surprise_value: 0.7,
      obviousness: 0.1,
      cliche_risk: 0.1,
      journey_role: 'hold',
    }))
    return { content: JSON.stringify({ ranking }) }
  })
})

describe.each(['local', 'ai'] as const)('legacy %s source identity', mode => {
  const explore = async(options: ExploreOptions = {}) => exploreOnce({
    anchor,
    radius: 90,
    reuseAnalysis: normalizeAnalysis({ summary: 'test' }, anchor),
    ai: mode === 'ai' ? { apiKey: 'test', model: 'test' } : undefined,
    ...options,
  })
  const expectExcluded = async(options: ExploreOptions = {}) => {
    const result = await explore(options)
    expect(result.engine).toBe(mode)
    expect(result.candidates.map(item => item.id)).toEqual(['wy_safe'])
    expect(mocks.addQueue).toHaveBeenCalledExactlyOnceWith([expect.objectContaining({ musicInfo: expect.objectContaining({ id: 'wy_safe' }) })])
  }

  it('merges the alias evidence before excluding an existing favorite', async() => {
    mocks.getList.mockResolvedValue([favorite()])
    await expectExcluded()
  })

  it('keeps alternative identities until a favorite arrives before submission', async() => {
    mocks.getList.mockResolvedValueOnce([]).mockResolvedValue([favorite()])
    await expectExcluded()
  })

  it('excludes an existing queued alias', async() => {
    mocks.queue.push({ musicInfo: favorite() })
    await expectExcluded()
  })

  it.each([
    { excludeIds: ['tx_two'] },
    { excludeTracks: [{ artist: '买辣椒也用券', title: 'S1' }] },
  ])('checks retained candidate evidence against history: %j', async(options) => {
    await expectExcluded(options)
  })

  it('checks an exact alternate-source blacklist before ranking', async() => {
    addDislikeInfo([{ name: '', singer: alias.singer }])
    const result = await explore({ enqueue: false })
    expect(result.engine).toBe(mode)
    expect(result.candidates.map(item => item.id)).toEqual(['wy_safe'])
  })

  it('merges evidence before excluding an alias anchor', async() => {
    await expectExcluded({ anchor: { id: 'other-anchor', artist: '买辣椒也用券', title: 'S1' } })
  })

  it('merges a late alias bridge and retains every source with the first source preferred', async() => {
    mocks.search.mockResolvedValue([{ source: 'all', list: [preferred, raw('wy', 'other', '买辣椒也用券'), alias] }])
    const result = await explore()
    expect(result.engine).toBe(mode)
    expect(result.candidates.map(item => item.id)).toEqual(['wy_one'])
    expect(sourceIds(result.candidates[0])).toEqual(['wy_one', 'wy_other', 'tx_two'])
    expect(mocks.addQueue.mock.calls[0][0]).toHaveLength(1)
    expect(sourceIds(mocks.addQueue.mock.calls[0][0][0])).toEqual(['wy_one', 'wy_other', 'tx_two'])
  })

  it('retains a local playlist alias behind the preferred search result', async() => {
    mocks.search.mockResolvedValue([{ source: 'wy', list: [preferred, safe] }])
    mocks.lists.push({ id: 'playlist' })
    mocks.getList.mockImplementation(async(id) => id === 'playlist' ? [toNewMusicInfo(alias)] : [favorite()])
    await expectExcluded()
  })

  it.each(['queue', 'blacklist'] as const)('checks a late %s change against retained sources', async(kind) => {
    mocks.getList.mockResolvedValueOnce([]).mockImplementationOnce(async() => {
      if (kind === 'queue') mocks.queue.push({ musicInfo: favorite() })
      else addDislikeInfo([{ name: '', singer: alias.singer }])
      return []
    })
    await expectExcluded()
  })

  it.each([
    { singer: '买辣椒也用券', name: 'S1 (Live)' },
    { singer: 'Unrelated Cover Artist', name: 'S1' },
  ])('keeps ordinary versions and unrelated covers distinct: %j', async(metadata) => {
    mocks.getList.mockResolvedValue([{ ...favorite(), ...metadata }])
    const result = await explore({ enqueue: false })
    expect(result.engine).toBe(mode)
    const candidate = result.candidates.find(item => item.id === 'wy_one')!
    expect(candidate).toBeDefined()
    expect(sourceIds(candidate)).toEqual(['wy_one', 'tx_two'])
  })
})
