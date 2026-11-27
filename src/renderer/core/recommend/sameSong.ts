/**
 * 同曲判定纯函数（T-B3）。
 *
 * 背景：音乐平台对同一首歌返回的 artist 串顺序/分隔符/合作者数量可能不同
 * （如 Möbius 一条 artist="Benjamin, Laco, 薄野弘之"，另一条 "mpi, Laco, Benjamin, 薄野弘之"；
 * Inferno 两条 artist 相同但 id 不同），导致同曲以多个 id/artist 变体穿过全链路去重。
 * 本模块无任何 lx 运行时依赖（纯函数），供 recall/candidatePool/engine/session-core 复用，
 * 由 vitest 直接测试。
 */

/** 参与同曲判定的最小歌曲引用（artist/title 均可空）。 */
export interface SongRef {
  artist?: string | null
  title?: string | null
}

/** 通用归一化：去零宽字符、统一括号和空白，不删除版本标记。 */
export const normalizeText = (text?: string | null): string => {
  return String(text ?? '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .trim().toLowerCase().replace(/\s+/g, ' ')
}

/** 标题统一括号周围空白，保留 (Live) 等版本差异；种子定位也使用此口径。 */
export const normalizeTitle = (title?: string | null): string => {
  return normalizeText(title).replace(/\s*\(\s*/g, '(').replace(/\s*\)\s*/g, ')').trim()
}

/** 单段艺人名的变体：原文、括号内别名、去括号主名。 */
const segmentVariants = (segment: string): string[] => {
  const variants = new Set<string>([segment.trim()])
  for (const m of segment.matchAll(/\(([^()]*)\)/g)) variants.add(m[1].trim())
  variants.add(segment.replace(/\([^()]*\)/g, ' ').trim())
  return [...variants].filter(Boolean)
}

const artistSegments = (artist?: string | null): string[] => normalizeText(artist).split(/[,、，/&;；|]+/)

/** 艺人按常见分隔符切词，并展开括号别名。 */
export const normalizeArtistTokens = (artist?: string | null): string[] => {
  return [...new Set(artistSegments(artist).flatMap(segmentVariants))]
}

/** 严格种子定位只使用起点首个艺人段，不能因合作艺人相交而放宽门禁。 */
export const primaryArtistVariants = (artist?: string | null): string[] => {
  return segmentVariants(artistSegments(artist)[0] ?? '')
}

/**
 * 是否同一首歌：
 * - title 归一化后不同 → false（保留 "(Live)" 等版本差异）；
 * - title 相同后：双方 artist 都为空 → true；任一方为空另一方非空 → false
 *   （同名但艺人归属不明/不同的不算同曲）；双方非空 → 艺人 token 集合有交集即 true，
 *   完全无交集 → false（同名不同艺人算不同曲）。
 */
export const sameSong = (a: SongRef, b: SongRef): boolean => {
  const ta = normalizeTitle(a.title)
  const tb = normalizeTitle(b.title)
  if (!ta || !tb || ta !== tb) return false
  const aTokens = normalizeArtistTokens(a.artist)
  const bTokens = normalizeArtistTokens(b.artist)
  if (!aTokens.length && !bTokens.length) return true
  if (!aTokens.length || !bTokens.length) return false
  return aTokens.some(t => bTokens.includes(t))
}

/**
 * 列表内是否已存在同曲（sameSong 语义）。
 * 候选池去重、跨批次排除、AI 分批保险、本地排序 seen 集合共用的“列表命中”语义。
 */
export const includesSameSong = (list: SongRef[], target: SongRef): boolean => {
  return list.some(item => sameSong(item, target))
}

/**
 * 同曲去重追加：列表中没有同曲时追加并返回 true，已有同曲返回 false（不追加）。
 * 供“边过滤边记录已见曲目”的场景直接用（filter 谓词 / 逐条累积）。
 */
export const pushUniqueSameSong = (list: SongRef[], item: SongRef): boolean => {
  if (includesSameSong(list, item)) return false
  list.push(item)
  return true
}
