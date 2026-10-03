import { beforeEach, expect, it, vi } from 'vitest'
import { addDislikeInfo, clearDislikeInfo } from '@renderer/store/dislikeList/action'
import { filterForSubmission } from './submission'
import type { SongRef } from './sameSong'

const mocks = vi.hoisted(() => ({ getList: vi.fn(), queue: [] as any[] }))
vi.mock('@renderer/store/list/listManage/rendererListManage', () => ({ getListMusics: mocks.getList }))
vi.mock('@renderer/store/list/listManage/state', () => ({ loveList: { id: 'love' } }))
vi.mock('@renderer/store/player/state', () => ({ tempPlayList: mocks.queue }))

const song = (id: string, name = 'Song', singer = 'Artist'): LX.Music.MusicInfoOnline => ({
  id,
  name,
  singer,
  source: 'wy',
  interval: null,
  meta: { songId: id, albumName: '', qualitys: [], _qualitys: {} },
})
const result = () => ({ candidates: [{ musicInfo: song('wy_1'), sources: ['wy', 'tx'], reason: '两个平台共同推荐' }] })
beforeEach(() => {
  vi.clearAllMocks()
  clearDislikeInfo()
  mocks.queue.splice(0)
  mocks.getList.mockResolvedValue([])
})

it.each([{ name: 'Song', singer: '' }, { name: '', singer: 'Artist' }, { name: 'Song', singer: 'Artist' }])('遵守全局屏蔽规则 %j', async(rule) => {
  addDislikeInfo([rule])
  expect((await filterForSubmission(result())).candidates).toEqual([])
})

it('等待读取收藏时发生的屏蔽、会话反馈和手动排队均以最新状态为准', async() => {
  let release!: (items: LX.Music.MusicInfo[]) => void
  mocks.getList.mockImplementationOnce(async() => new Promise(resolve => { release = resolve }))
  let disliked: SongRef[] = []
  const input = { candidates: ['blocked', 'disliked', 'queued', 'kept'].map(name => ({ musicInfo: song(name, name) })) }
  const pending = filterForSubmission(input, { dislikedTracks: () => disliked })
  addDislikeInfo([{ name: 'blocked', singer: '' }])
  disliked = [{ artist: 'Artist', title: 'disliked' }]
  const manual = { musicInfo: song('manual', 'queued') }
  mocks.queue.push(manual)
  release([])
  expect((await pending).candidates.map(c => c.musicInfo.name)).toEqual(['kept'])
  expect(mocks.queue).toEqual([manual])
})

it('收藏按同曲排除跨平台条目；保留未过滤条目的来源证据', async() => {
  const input = result()
  expect((await filterForSubmission(input)).candidates[0]).toBe(input.candidates[0])
  mocks.getList.mockResolvedValue([song('tx_2')])
  expect((await filterForSubmission(input)).candidates).toEqual([])
})

it.each(['favorites', 'queue', 'feedback'])('提交前按统一括号和别名口径过滤 %s，保留不同版本', async(exclusion) => {
  const excluded = song('existing', '起风了 (Live)', '买辣椒也用券')
  if (exclusion === 'favorites') mocks.getList.mockResolvedValue([excluded])
  if (exclusion === 'queue') mocks.queue.push({ musicInfo: excluded })
  const candidates = [
    { musicInfo: song('live', '起风了（Live）', '冯沁苑（买辣椒也用券）') },
    { musicInfo: song('studio', '起风了', '买辣椒也用券') },
  ]
  const filtered = await filterForSubmission({ candidates }, {
    dislikedTracks: () => exclusion === 'feedback' ? [{ artist: excluded.singer, title: excluded.name }] : [],
  })
  expect(filtered.candidates).toEqual([candidates[1]])
})

it('读取收藏期间取消，迟到结果不得提交', async() => {
  let release!: (items: LX.Music.MusicInfo[]) => void
  mocks.getList.mockImplementationOnce(async() => new Promise(resolve => { release = resolve }))
  let cancelled = false
  const pending = filterForSubmission(result(), { isCancelled: () => cancelled })
  const assertion = expect(pending).rejects.toThrow('取消')
  cancelled = true
  release([])
  await assertion
})

it('收藏读取失败不能作为空列表放行', async() => {
  mocks.getList.mockRejectedValueOnce(new Error('library unavailable'))
  await expect(filterForSubmission(result())).rejects.toThrow('library unavailable')
})


it.each(['favorites', 'feedback', 'blacklist'])('final %s exclusion checks retained alternative identities', async(channel) => {
  const alternate = song('alternate', 'Song', '冯沁苑（买辣椒也用券）')
  const candidate = { musicInfo: song('preferred', 'Song', '冯沁苑'), alternativeMusicInfos: [alternate] }
  if (channel === 'favorites') mocks.getList.mockResolvedValue([song('loved', 'Song', '买辣椒也用券')])
  if (channel === 'blacklist') addDislikeInfo([{ name: '', singer: alternate.singer }])
  const filtered = await filterForSubmission({ candidates: [candidate] }, {
    dislikedTracks: () => channel === 'feedback' ? [{ artist: '买辣椒也用券', title: 'Song' }] : [],
  })
  expect(filtered.candidates).toEqual([])
})

it.each(['Song (Live)', 'Other Song'])('alternative identity filtering preserves title/version differences: %s', async(name) => {
  const candidate = { musicInfo: song('preferred', 'Song', '冯沁苑'), alternativeMusicInfos: [song('alternate', 'Song', '冯沁苑（买辣椒也用券）')] }
  mocks.getList.mockResolvedValue([song('loved', name, '买辣椒也用券')])
  expect((await filterForSubmission({ candidates: [candidate] })).candidates).toEqual([candidate])
})

it('filtering an alias bridge cannot leave another member of the same incoming batch behind', async() => {
  const candidates = ['冯沁苑', '买辣椒也用券', '冯沁苑（买辣椒也用券）'].map((artist, index) => ({ musicInfo: song(String(index), 'Song', artist) }))
  mocks.getList.mockResolvedValue([song('loved', 'Song', '冯沁苑')])
  expect((await filterForSubmission({ candidates })).candidates).toEqual([])
})
