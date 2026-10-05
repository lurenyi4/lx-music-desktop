import { groupIdentities, musicInfosOf, sameIdentity, uniqueMusicInfos, type SongIdentity } from './songIdentity'

interface Candidate {
  musicInfo?: LX.Music.MusicInfo
  alternativeMusicInfos?: LX.Music.MusicInfo[]
}

/** 提交前按实时队列去重；同时保留候选顺序、来源证据和批内唯一性。 */
export const filterQueuedResult = <T extends { candidates: Candidate[] }>(
  result: T,
  queue: ReadonlyArray<Pick<LX.Player.PlayMusicInfo, 'musicInfo' | 'alternativeMusicInfos'>>,
): T => {
  const existing = new Set<SongIdentity>(queue)
  const groups = groupIdentities<SongIdentity>([...queue, ...result.candidates.filter(candidate => candidate.musicInfo)], (a, b) => sameIdentity(a, b, true))
  const candidates = result.candidates.flatMap(candidate => {
    const group = groups.find(group => group[0] === candidate)
    if (!group || group.some(item => existing.has(item))) return []
    if (group.length === 1) return [candidate]
    return [{
      ...candidate,
      alternativeMusicInfos: uniqueMusicInfos(group.flatMap(musicInfosOf)).filter(info => info !== candidate.musicInfo),
    }]
  })
  return { ...result, candidates }
}
