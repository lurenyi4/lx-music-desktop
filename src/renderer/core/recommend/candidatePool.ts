/**
 * 候选池纯函数（T-B3）。
 *
 * 统一承载召回末端与引擎跨批次排除的同一套去重语义：
 * - buildCandidatePool：先合并同 id/同曲证据，再排除锚点与红心，保留首个通过语言门控的来源；
 * - filterExcludeTracks：跨批次按 id 与 sameSong 排除已推荐曲目（防同曲不同 id 变体重复入队）。
 * 本模块无任何 lx 运行时依赖，由 vitest 直接测试。
 */

import { recallSourceLanguageBlocked } from './gates'
import type { LanguageConstraints, TrackLike } from './judgment'
import { normalizeTitle, sameSong } from './sameSong'
import type { SongRef } from './sameSong'
import { groupIdentities, musicInfosOf, sameIdentity, songRefs, uniqueMusicInfos, type SongIdentity } from './songIdentity'

/** 候选池构建选项。 */
export interface CandidatePoolOptions {
  /** 起点（会话锚点）：sameSong 命中或同 id 命中的候选剔除（id 兜底防跨语言/元数据不一致漏排）。 */
  anchor: SongIdentity
  /** 已红心歌曲（artist/title，同曲变体也命中；按 titleKey 分桶，全量读取无截断）。 */
  lovedTracks: SongIdentity[]
  /** 语言硬约束。 */
  constraints: LanguageConstraints
}

/** 红心歌按 titleKey 分桶：候选判定先查桶再 sameSong，只对 title 相同的少量项做 token 交集。 */
const indexLovedTracks = (lovedTracks: SongIdentity[]): Map<string, SongRef[]> => {
  const map = new Map<string, SongRef[]>()
  for (const loved of lovedTracks.flatMap(songRefs)) {
    const key = normalizeTitle(loved.title)
    if (!key) continue
    const bucket = map.get(key)
    if (bucket) bucket.push(loved)
    else map.set(key, [loved])
  }
  return map
}

/** 候选是否命中红心（titleKey 桶内 sameSong 判定；title 不同直接 false，不误伤同名异曲）。 */
const isLoved = (candidate: SongIdentity, lovedIndex: Map<string, SongRef[]>): boolean => {
  return songRefs(candidate).some(ref => lovedIndex.get(normalizeTitle(ref.title))?.some(loved => sameSong(loved, ref)))
}

/**
 * 排除前按整批同曲证据归组，避免晚到的别名来源被丢弃后漏排。
 * 首选仍为首个通过语言门控的条目（跨源搜索结果在前、本地池在后），其余音乐信息保留为备用证据。
 * 返回新数组，不改动入参。
 */
export function buildCandidatePool<T extends TrackLike & SongIdentity>(items: T[], options: CandidatePoolOptions): T[] {
  const lovedIndex = indexLovedTracks(options.lovedTracks ?? [])
  const groups = groupIdentities(items, (a, b) =>
    Boolean(a.encryptedId && a.encryptedId === b.encryptedId) || sameIdentity(a, b))
  return groups.flatMap(group => {
    if (group.some(c => sameIdentity({ ...c, id: c.encryptedId }, options.anchor, true) || isLoved(c, lovedIndex))) return []
    const preferred = group.find(c => !recallSourceLanguageBlocked(c, options.constraints))
    if (!preferred) return []
    if (group.length === 1) return [preferred]
    return [{
      ...preferred,
      alternativeMusicInfos: uniqueMusicInfos(group.flatMap(musicInfosOf)).filter(info => info !== preferred.musicInfo),
    }]
  })
}

/**
 * 按 id 与同曲语义排除已推荐曲目（engine 跨批次去重用）；
 * 与 buildCandidatePool 一样只排除、不改动其余候选的相对顺序。
 */
export function filterExcludeTracks<T extends TrackLike & SongIdentity>(items: T[], excludeIds: string[], excludeTracks: SongIdentity[]): T[] {
  const ids = new Set((excludeIds ?? []).map(id => String(id)))
  return items.filter(c => {
    if (songRefs({ ...c, id: c.encryptedId }).some(ref => ref.id && ids.has(ref.id))) return false
    if ((excludeTracks ?? []).some(track => sameIdentity(track, c))) return false
    return true
  })
}
