import { expect, it } from 'vitest'
import { filterQueuedResult } from './queue'

const info = (id: string, singer: string, name = 'Song'): LX.Music.MusicInfoOnline => ({
  id, singer, name, source: 'wy', interval: null, meta: { songId: id, albumName: '', qualitys: [], _qualitys: {} },
})
const plain = () => ({ musicInfo: info('plain', '买辣椒也用券') })
const fused = () => ({ musicInfo: info('preferred', '冯沁苑'), alternativeMusicInfos: [info('alternate', '冯沁苑（买辣椒也用券）')] })

it.each([false, true])('queue exclusion uses alternatives on either side (fused queued=%s)', queued => {
  const candidate = queued ? plain() : fused()
  const queue = [queued ? fused() : plain()]
  expect(filterQueuedResult({ candidates: [candidate] }, queue).candidates).toEqual([])
})

it('queue ID matching includes every retained source ID', () => {
  expect(filterQueuedResult({ candidates: [fused()] }, [{ musicInfo: info('alternate', 'Other Artist', 'Other title') }]).candidates).toEqual([])
})

it('batch uniqueness uses alternatives on previously retained and incoming candidates', () => {
  for (const candidates of [[fused(), plain()], [plain(), fused()]]) {
    const kept = filterQueuedResult({ candidates }, []).candidates
    expect(kept).toHaveLength(1)
    expect(kept[0].musicInfo).toBe(candidates[0].musicInfo)
  }
})

it('a late alias bridge collapses the batch and retains evidence for the next submission', () => {
  const first = { musicInfo: info('a', '冯沁苑') }
  const second = { musicInfo: info('b', '买辣椒也用券') }
  const bridge = { musicInfo: info('c', '冯沁苑（买辣椒也用券）') }
  const kept = filterQueuedResult({ candidates: [first, second, bridge] }, []).candidates
  expect(kept).toHaveLength(1)
  expect(kept[0].musicInfo).toBe(first.musicInfo)
  expect(filterQueuedResult({ candidates: [plain()] }, kept).candidates).toEqual([])
})

it('ordinary queue matching preserves Live versions and unrelated same-title covers', () => {
  const candidates = [
    { musicInfo: info('live', '买辣椒也用券', 'Song (Live)') },
    { musicInfo: info('cover', 'Unrelated Artist') },
  ]
  expect(filterQueuedResult({ candidates }, [fused()]).candidates).toEqual(candidates)
})
