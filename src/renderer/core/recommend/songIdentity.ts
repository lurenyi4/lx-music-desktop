import { sameSong, type SongRef } from './sameSong'

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
