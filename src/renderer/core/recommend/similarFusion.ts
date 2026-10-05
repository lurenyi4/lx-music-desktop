/**
 * 跨源相似候选合并与排名融合纯函数（平台相似推荐 4.3）。
 *
 * - 候选保留作品身份 + 各来源条目（含排名与备用音源），不提前「保留第一条」丢证据；
 * - 等权倒数排名融合 Σ 1/(k + rank)（k 集中配置于 recommendationConfig）：
 *   仅用来源内排名，避免不同平台原始分数不可比；同源重复行/重试返回只计一次；
 * - 确定性：固定来源顺序（PROVIDER_ORDER）+ 稳定全序比较，异步返回先后不改变最终排名；
 * - 本地画像加成是有界次级调整（默认 ±15%），保留来源排名的主要作用；
 * - 艺人多样性：同主艺人每批最多 maxPerArtist 首，不足一批允许少量结果，不补足数量。
 * 本模块无 lx 运行时依赖，由 vitest 直接测试。
 */

import { SIMILAR_FUSION_K } from '@common/recommendationConfig'
import { primaryArtistVariants } from './sameSong'
import { groupIdentities, musicInfosOf, sameIdentity, uniqueMusicInfos } from './songIdentity'

/** 平台提供方固定顺序（确定性合并的来源序，与异步完成顺序无关）。 */
export const PROVIDER_ORDER = ['wy', 'tx'] as const
export type SimilarProviderId = typeof PROVIDER_ORDER[number]

/** 单来源候选（平台返回的归一化条目，rank 为来源内排名，从 1 开始）。 */
export interface ProviderCandidate {
  musicInfo: LX.Music.MusicInfo
  rank: number
}

/** 单来源输入批次。 */
export interface ProviderBatch {
  provider: SimilarProviderId
  candidates: ProviderCandidate[]
}

/** 来源证据：提供方 + 来源内排名 + 该来源的可播放条目（备用音源）。 */
export interface CandidateSource {
  provider: SimilarProviderId
  rank: number
  musicInfo: LX.Music.MusicInfo
}

/** 融合后的候选：保留全部来源证据；musicInfo 为首选播放条目（按 PROVIDER_ORDER 取最早来源）。 */
export interface FusedCandidate {
  artist: string
  title: string
  album: string
  /** 各来源证据（按 PROVIDER_ORDER 排序；同一候选跨源合并后仍保留各自排名与条目）。 */
  sources: CandidateSource[]
  /** 首选播放条目（PROVIDER_ORDER 中最早的来源；推荐方不一定是最终播放源）。 */
  musicInfo: LX.Music.MusicInfo
  /** 所有保留的来源身份（含同平台归并条目），与每平台一次的排名贡献分开。 */
  alternativeMusicInfos: LX.Music.MusicInfo[]
  /** 融合分 Σ 1/(k + rank)（画像调整前）。 */
  fusionScore: number
}

/** 画像加成的有界调整幅度（localBonus ∈ [-10,+10] 映射为分数乘数最多 ±15%）。 */
const PROFILE_ADJUST_LIMIT = 0.15

/** 候选的最佳来源证据（排名最靠前；并列时取来源固定序靠前者）——全序比较的次级键。 */
const bestSource = (c: FusedCandidate): CandidateSource => {
  return c.sources.reduce((best, s) => {
    if (s.rank < best.rank) return s
    if (s.rank === best.rank && PROVIDER_ORDER.indexOf(s.provider) < PROVIDER_ORDER.indexOf(best.provider)) return s
    return best
  })
}

/** 全序比较（确定性）：融合分降序 → 最佳来源排名升序 → 来源固定顺序 → 标题/艺人归一化字典序。 */
const compareFused = (a: FusedCandidate, b: FusedCandidate): number => {
  if (a.fusionScore !== b.fusionScore) return b.fusionScore - a.fusionScore
  const aBest = bestSource(a)
  const bBest = bestSource(b)
  if (aBest.rank !== bBest.rank) return aBest.rank - bBest.rank
  const aOrder = PROVIDER_ORDER.indexOf(aBest.provider)
  const bOrder = PROVIDER_ORDER.indexOf(bBest.provider)
  if (aOrder !== bOrder) return aOrder - bOrder
  const aKey = `${String(a.title).toLowerCase()}||${String(a.artist).toLowerCase()}`
  const bKey = `${String(b.title).toLowerCase()}||${String(b.artist).toLowerCase()}`
  return aKey < bKey ? -1 : aKey > bKey ? 1 : 0
}

/**
 * 跨源合并与融合：
 * - 按同曲与同源 ID 归并完整来源证据（含晚到的别名桥），每平台仅最佳排名计一次投票；
 * - 融合分 Σ 1/(k + rank)，多源共同推荐自然累加，但单源高排名候选仍有展示机会；
 * - 输出顺序与来源输入顺序/异步完成顺序无关（固定来源序 + 全序比较）。
 */
export const fuseSimilarCandidates = (batches: ProviderBatch[]): FusedCandidate[] => {
  // 固定来源顺序消费输入（调用方传入顺序不影响结果）
  const ordered = PROVIDER_ORDER
    .map(provider => batches.find(b => b.provider === provider))
    .filter((b): b is ProviderBatch => b != null)

  const records = ordered.flatMap(batch => batch.candidates.map(candidate => ({ ...candidate, provider: batch.provider })))
  const groups = groupIdentities(records, (a, b) =>
    (a.provider === b.provider && a.musicInfo.id === b.musicInfo.id) || sameIdentity(a, b),
  ).map((group): FusedCandidate => {
    // 全部条目保留身份；每个平台仅其最佳排名贡献一票，别名桥归并不放大分数。
    const sources = PROVIDER_ORDER.flatMap(provider => {
      const candidates = group.filter(record => record.provider === provider)
      if (!candidates.length) return []
      return [candidates.reduce((best, record) => record.rank < best.rank ? record : best)]
    })
    const musicInfo = sources[0].musicInfo
    return {
      artist: musicInfo.singer,
      title: musicInfo.name,
      album: musicInfo.meta.albumName ?? '',
      sources,
      musicInfo,
      alternativeMusicInfos: uniqueMusicInfos(group.map(record => record.musicInfo)).filter(info => info !== musicInfo),
      fusionScore: sources.reduce((sum, source) => sum + 1 / (SIMILAR_FUSION_K + source.rank), 0),
    }
  })
  return groups.sort(compareFused)
}

/**
 * 有界画像调整：localBonus（[-10,+10]）映射为最多 ±15% 的分数乘数，来源排名仍主导顺序；
 * 调整后重排仍用 compareFused 的全序（分数变化才可能换位）。
 */
export const applyProfileAdjustment = (items: FusedCandidate[], profileBoost?: (artist: string) => number): FusedCandidate[] => {
  if (!profileBoost) return items
  const adjusted = items.map(item => {
    const bonus = Math.max(-10, Math.min(10, Number(profileBoost(item.artist ?? '')) || 0))
    const multiplier = 1 + (bonus / 10) * PROFILE_ADJUST_LIMIT
    return { ...item, fusionScore: item.fusionScore * multiplier }
  })
  return adjusted.sort(compareFused)
}

/**
 * 艺人多样性限制：按顺序保留同主艺人（首个艺人段及括号别名）最多 maxPerArtist 首，
 * 超出的本批不展示（不重排、不从无关来源补足数量）；不足一批允许少量结果。
 */
export const applyArtistDiversity = (items: FusedCandidate[], maxPerArtist = 2): FusedCandidate[] => {
  const primaries = items.map(item => {
    const variants = primaryArtistVariants(item.artist)
    return variants.length ? variants : ['']
  })
  const sourcePrimaries = items.flatMap(item => musicInfosOf(item).map(info => primaryArtistVariants(info.singer)))
  const groups = new Map<string, { variants: Set<string>, count: number }>()
  // 先合并整批主艺人别名，避免低排名的括号写法才揭示两个已分开计数的名字属于同一艺人。
  // 备用来源也可能保留别名证据；每个来源仅关联其自身主艺人别名，不因歌曲已融合而合并不同主艺人。
  for (const variants of [...primaries, ...sourcePrimaries]) {
    const group = { variants: new Set(variants), count: 0 }
    for (const variant of variants) {
      for (const alias of groups.get(variant)?.variants ?? []) group.variants.add(alias)
    }
    for (const alias of group.variants) groups.set(alias, group)
  }
  return items.filter((_, index) => {
    const group = groups.get(primaries[index][0])!
    if (group.count >= maxPerArtist) return false
    group.count++
    return true
  })
}
