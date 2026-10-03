import { beforeEach, describe, expect, it, vi } from 'vitest'
import { explorePlatformOnce } from './platformEngine'
import { recallPlatformSimilar, type PlatformRecallOptions } from './platformRecall'
import { SimilarCandidateCache } from './similarCache'
import { addDislikeInfo, clearDislikeInfo } from '@renderer/store/dislikeList/action'

const mocks = vi.hoisted(() => ({
  wySearch: vi.fn(),
  txSearch: vi.fn(),
  wySimi: vi.fn(),
  txSimi: vi.fn(),
  addQueue: vi.fn(),
  getList: vi.fn(),
  queue: [] as any[],
}))
// Keep normalization, recall, fusion, submission and queue filtering real; replace only I/O boundaries.
vi.mock('@renderer/utils', async() => import('@common/utils/tools'))
vi.mock('@renderer/utils/musicSdk', () => ({
  default: {
    wy: { musicSearch: { search: mocks.wySearch }, simiSong: { getSimiSong: mocks.wySimi } },
    tx: { musicSearch: { search: mocks.txSearch }, simiSong: { getSimiSong: mocks.txSimi } },
  },
}))
vi.mock('@renderer/store/player/action', () => ({ addTempPlayList: mocks.addQueue }))
vi.mock('@renderer/store/player/state', () => ({ tempPlayList: mocks.queue }))
vi.mock('@renderer/store/list/listManage/rendererListManage', () => ({ getListMusics: mocks.getList }))
vi.mock('@renderer/store/list/listManage/state', () => ({ loveList: { id: 'love' }, userLists: [] }))

let seed = 0
const recall = async(artist: string, candidateArtist: string, title = '起风了', candidateTitle = title) => {
  // Unique native seeds prevent the production cache from reusing another case's response.
  const id = String(++seed)
  mocks.txSimi.mockResolvedValue({
    list: [{
      source: 'tx',
      songmid: `candidate-${id}`,
      songId: seed,
      singer: candidateArtist,
      name: candidateTitle,
      albumName: 'Album',
      interval: '04:00',
      types: [],
      _types: {},
    }],
  })
  return explorePlatformOnce({ anchor: { artist, title, id: `wy_${id}`, seedIds: { wy: id, tx: id } } })
}

beforeEach(() => {
  vi.clearAllMocks()
  clearDislikeInfo()
  mocks.getList.mockResolvedValue([])
  mocks.queue.splice(0)
  mocks.wySimi.mockResolvedValue({ list: [] })
})

describe('production platform chain excludes the anchor and its versions', () => {
  it.each([
    ['冯沁苑（买辣椒也用券）', '买辣椒也用券', '起风了', '起风了'],
    ['买辣椒也用券', '冯沁苑（买辣椒也用券）', '起风了', '起风了'],
    [' 冯沁苑 ( 买辣椒也用券 ) ', '\u200b买辣椒也用券 ', ' 起风了 ', '起风了'],
    ['冯沁苑（买辣椒也用券）', '买辣椒也用券', '起风了', '起风了 (Live)'],
    ['买辣椒也用券', '冯沁苑 ( 买辣椒也用券 )', '起风了（Live）', '起风了'],
    ['冯沁苑（买辣椒也用券）', '买辣椒也用券', ' 起风了 （ Live ） ', '起风了(Live)'],
  ])('does not queue %s / %s / %s / %s', async(artist, candidateArtist, title, candidateTitle) => {
    const result = await recall(artist, candidateArtist, title, candidateTitle)
    expect(result.candidates).toEqual([])
    expect(result.meta.state).toBe('empty')
    expect(mocks.addQueue).not.toHaveBeenCalled()
  })

  it('keeps a different artist’s cover and passes the real converted music info to the queue', async() => {
    const result = await recall('冯沁苑（买辣椒也用券）', '吴青峰')
    expect(result.candidates).toHaveLength(1)
    expect(mocks.addQueue).toHaveBeenCalledExactlyOnceWith([expect.objectContaining({
      musicInfo: expect.objectContaining({ source: 'tx', name: '起风了', singer: '吴青峰', meta: expect.objectContaining({ songId: expect.any(String) }) }),
    })])
  })
})


const raw = (source: string, songmid: string, singer: string, name = 'S1') => ({
  source, songmid, singer, name, songId: 1, albumName: 'Album', interval: '04:00', types: [], _types: {},
})
const retainedEvidence = () => {
  mocks.wySimi.mockResolvedValue({ list: [raw('wy', '1', '冯沁苑')] })
  mocks.txSimi.mockResolvedValue({ list: [raw('tx', '1', '冯沁苑（买辣椒也用券）')] })
  const id = String(++seed)
  return { artist: 'Other Artist', title: 'Origin', id: `anchor-${id}`, seedIds: { wy: id, tx: id } }
}
const aliasRef = { artist: '买辣椒也用券', title: 'S1' }

it.each(['lovedTracks', 'excludeTracks', 'queueTracks', 'dislikedTracks'] as const)('retained source aliases reach recall %s exclusions', async(key) => {
  const result = await recallPlatformSimilar(retainedEvidence(), { [key]: [aliasRef], cache: new SimilarCandidateCache() })
  expect(result.items).toEqual([])
})

it.each([
  { excludeIds: ['tx_1'] },
  { isExcluded: (info: LX.Music.MusicInfo) => info.singer === '冯沁苑（买辣椒也用券）' },
])('recall retains source identities for ID/blacklist exclusions', async(options: PlatformRecallOptions) => {
  expect((await recallPlatformSimilar(retainedEvidence(), { ...options, cache: new SimilarCandidateCache() })).items).toEqual([])
})

it.each(['S1', 'S1 (Live)'])('anchor exclusion uses retained candidates and keeps wider same-work semantics: %s', async(title) => {
  const anchor = { ...retainedEvidence(), ...aliasRef, title }
  expect((await recallPlatformSimilar(anchor, { cache: new SimilarCandidateCache() })).items).toEqual([])
})

it('anchor alternative evidence also excludes a plain-alias result', async() => {
  const base = retainedEvidence()
  mocks.wySimi.mockResolvedValue({ list: [raw('wy', 'other', '买辣椒也用券')] })
  mocks.txSimi.mockResolvedValue({ list: [] })
  const anchor = {
    ...base,
    artist: '冯沁苑',
    title: 'S1',
    alternativeMusicInfos: [{ id: 'alternate-anchor', singer: '冯沁苑（买辣椒也用券）', name: 'S1', source: 'tx', meta: {} } as any],
  }
  expect((await recallPlatformSimilar(anchor, { cache: new SimilarCandidateCache() })).items).toEqual([])
})

it('a favorite arriving after recall still excludes an alternate-source alias before enqueue', async() => {
  const anchor = retainedEvidence()
  mocks.getList.mockResolvedValueOnce([]).mockResolvedValue([{ id: 'loved', singer: aliasRef.artist, name: aliasRef.title }])
  expect((await explorePlatformOnce({ anchor })).candidates).toEqual([])
  expect(mocks.addQueue).not.toHaveBeenCalled()
})

it('a late exact blacklist on an alternative source blocks submission', async() => {
  const anchor = retainedEvidence()
  mocks.getList.mockResolvedValueOnce([]).mockImplementationOnce(async() => {
    addDislikeInfo([{ name: '', singer: '冯沁苑（买辣椒也用券）' }])
    return []
  })
  expect((await explorePlatformOnce({ anchor })).candidates).toEqual([])
  expect(mocks.addQueue).not.toHaveBeenCalled()
})

it('queue projection retains alternative-source aliases before recall diversity', async() => {
  const anchor = retainedEvidence()
  mocks.wySimi.mockResolvedValue({ list: [raw('wy', 'other', '买辣椒也用券')] })
  mocks.txSimi.mockResolvedValue({ list: [] })
  mocks.queue.push({
    musicInfo: { id: 'queue', singer: '冯沁苑', name: 'S1' },
    alternativeMusicInfos: [{ id: 'queue-alt', singer: '冯沁苑（买辣椒也用券）', name: 'S1' }],
  })
  expect((await explorePlatformOnce({ anchor })).candidates).toEqual([])
  expect(mocks.addQueue).not.toHaveBeenCalled()
})

it('a cross-source alias bridge produces one queued item and preserves every source ID', async() => {
  const anchor = retainedEvidence()
  mocks.wySimi.mockResolvedValue({ list: [raw('wy', 'a', '冯沁苑'), raw('wy', 'b', '买辣椒也用券')] })
  const result = await explorePlatformOnce({ anchor })
  expect(result.candidates).toHaveLength(1)
  expect(mocks.addQueue).toHaveBeenCalledOnce()
  expect(mocks.addQueue.mock.calls[0][0]).toHaveLength(1)
  const candidate = result.candidates[0]
  expect([candidate.musicInfo, ...candidate.alternativeMusicInfos!].map(info => info!.id).sort()).toEqual(['tx_1', 'wy_a', 'wy_b'])
})
