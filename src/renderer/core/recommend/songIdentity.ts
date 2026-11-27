import { normalizeArtistTokens, sameSong, type SongRef } from './sameSong'
import { simplifyForMatch } from './ytmParser'

/** 推荐条目已有的展示、首选和备用来源证据；不建立跨歌曲的全局艺人别名表。 */
export interface SongIdentity extends SongRef {
  id?: string | null
  musicInfo?: LX.Music.MusicInfo | LX.Download.ListItem | null
  alternativeMusicInfos?: readonly LX.Music.MusicInfo[]
}

export const musicInfosOf = (identity: SongIdentity): LX.Music.MusicInfo[] => {
  const preferred = identity.musicInfo
  return [
    ...(preferred ? ['progress' in preferred ? preferred.metadata.musicInfo : preferred] : []),
    ...(identity.alternativeMusicInfos ?? []),
  ]
}

export const songRefs = (identity: SongIdentity): Array<SongRef & { id?: string | null }> => {
  const display = identity.id != null || identity.artist != null || identity.title != null
    ? [{ id: identity.id, artist: identity.artist, title: identity.title }]
    : []
  return [...display, ...musicInfosOf(identity).map(info => ({ id: info.id, artist: info.singer, title: info.name }))]
}

/** 比较双方全部已保留证据；仅既有 ID 去重入口显式启用 ID 通道。 */
export const sameIdentity = (a: SongIdentity, b: SongIdentity, matchIds = false): boolean => {
  const right = songRefs(b)
  return songRefs(a).some(left => right.some(ref =>
    (matchIds && left.id != null && left.id === ref.id) || sameSong(left, ref),
  ))
}

/** 繁简统一后的单条歌曲引用。 */
export const simplifiedSongRef = (ref: SongRef): SongRef => ({
  artist: simplifyForMatch(ref.artist),
  title: simplifyForMatch(ref.title),
})

/** 繁简统一后的同曲判定（跨 YTM 繁体与国内简体）。 */
export const sameSongSimplified = (a: SongRef, b: SongRef): boolean => {
  return sameSong(simplifiedSongRef(a), simplifiedSongRef(b))
}

/** 繁简统一后的身份比较（单一事实源，供 platformRecall/ytmBridge/submission/queue/similarFusion/session-core/Explore 共用）。 */
export const sameIdentitySimplified = (a: SongIdentity, b: SongIdentity, matchIds = false): boolean => {
  const right = songRefs(b)
  return songRefs(a).some(left => right.some(ref =>
    (matchIds && left.id != null && left.id === ref.id) || sameSongSimplified(left, ref),
  ))
}

/** 标题去掉括号版本标记（(Live)/(DJ版)/(伴奏) 等）并繁简归一后的作品名。 */
export const stripVersionMarkers = (title?: string | null): string => {
  return simplifyForMatch(title)
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[（(][^（）()]*[)）]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/**
 * 繁简统一的同一作品判定（起点排除专用，比 sameSong 宽一档）：
 * 去版本标记后的标题一致 + 艺人 token 有交集 → 视为起点同作品变体（如 Live/DJ 版），不入候选；
 * 不同艺人的翻唱不算同一作品。
 */
export const sameWorkSimplified = (a: SongRef, b: SongRef): boolean => {
  const sa = simplifiedSongRef(a)
  const sb = simplifiedSongRef(b)
  if (sameSong(sa, sb)) return true
  const ta = stripVersionMarkers(a.title)
  const tb = stripVersionMarkers(b.title)
  if (!ta || !tb || ta !== tb) return false
  const aTokens = normalizeArtistTokens(sa.artist)
  const bTokens = normalizeArtistTokens(sb.artist)
  if (!aTokens.length || !bTokens.length) return false
  return aTokens.some(t => bTokens.includes(t))
}

/** 相同 ID 的不同艺人/标题写法仍是证据，不能按 ID 单独丢弃。 */
export const uniqueMusicInfos = <T extends LX.Music.MusicInfo>(infos: readonly T[]): T[] => {
  return infos.filter((info, index) => infos.findIndex(other =>
    other.id === info.id && other.singer === info.singer && other.name === info.name,
  ) === index)
}

/** 先按整批证据归组，晚到的别名桥不能让两个先前的展示分组都通过；保留输入顺序。 */
export const groupIdentities = <T extends SongIdentity>(items: readonly T[], matches: (a: T, b: T) => boolean): T[][] => {
  const groups: T[][] = []
  for (const item of items) {
    const linked = groups.filter(group => group.some(existing => matches(existing, item)))
    if (!linked.length) {
      groups.push([item])
      continue
    }
    linked[0].push(...linked.slice(1).flat(), item)
    for (const group of linked.slice(1)) groups.splice(groups.indexOf(group), 1)
  }
  return groups.map(group => items.filter(item => group.includes(item)))
}
