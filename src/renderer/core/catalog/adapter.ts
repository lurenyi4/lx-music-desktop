import { toNewMusicInfo } from '@common/utils/tools'
import { type CatalogKind, type CatalogPage, type CatalogProviders, type CatalogTarget } from './types'

export class CatalogError extends Error {
  constructor(public readonly code: 'unsupported' | 'metadata' | 'response', message: string) {
    super(message)
  }
}
const validId = (id: unknown): id is string | number =>
  (typeof id === 'string' && id.trim() !== '' && id !== '0') || (typeof id === 'number' && Number.isFinite(id) && id > 0)

export const createCatalogAdapter = (providers: CatalogProviders) => ({
  async resolve(kind: CatalogKind, music: LX.Music.MusicInfo): Promise<CatalogTarget[]> {
    if (music.source === 'local' || !providers[music.source]?.[kind]) {
      throw new CatalogError('unsupported', `当前提供方 ${music.source} 暂不支持${kind === 'artist' ? '艺人' : '专辑'}目录`)
    }
    const provider = providers[music.source]!
    let metadata = music.meta
    const needsDetail = kind === 'artist'
      ? !metadata.artists?.some(artist => validId(artist.id) && artist.name)
      : !validId(metadata.albumId)
    if (needsDetail && provider.detail) {
      const detail = await provider.detail(music)
      if (detail) metadata = { ...metadata, ...detail }
    }
    if (kind === 'album') {
      if (!validId(metadata.albumId)) throw new CatalogError('metadata', '缺少准确的专辑 ID，无法打开完整目录')
      return [{ kind, source: music.source, id: metadata.albumId, name: metadata.albumName || music.meta.albumName || '专辑' }]
    }
    const seen = new Set<string>()
    const artists = metadata.artists?.filter(artist => {
      if (!validId(artist.id) || !artist.name || seen.has(String(artist.id))) return false
      seen.add(String(artist.id))
      return true
    }) ?? []
    if (!artists.length) throw new CatalogError('metadata', '歌曲详情未提供准确的艺人 ID，无法打开完整目录')
    return artists.map(artist => ({ kind, source: music.source, id: artist.id, name: artist.name }))
  },

  async load(target: CatalogTarget, page = 1, limit = 50): Promise<CatalogPage> {
    const provider = providers[target.source]
    const fetchPage = provider?.[target.kind]
    if (!fetchPage) throw new CatalogError('unsupported', '当前提供方暂不支持此目录')
    if (!validId(target.id) || !Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1) {
      throw new CatalogError('metadata', '目录参数无效')
    }
    const result = await fetchPage(target.id, page, limit)
    if (!Array.isArray(result?.list)) throw new CatalogError('response', '提供方返回的目录格式无效')
    const totalValue = result.total == null ? NaN : Number(result.total)
    const total = Number.isFinite(totalValue) && totalValue >= 0 ? totalValue : null
    const responseLimit = Number(result.limit)
    // Migu's legacy SDK reports the album total as the page size. Infer only on page 1.
    const pageSize = target.kind === 'album' && provider?.albumPageSize === 'response-length'
      ? (page === 1 ? result.list.length || limit : limit)
      : Number.isFinite(responseLimit) && responseLimit > 0 ? responseLimit : limit
    const list = result.list.map(raw => toNewMusicInfo(raw) as LX.Music.MusicInfoOnline)
    return {
      list,
      page,
      limit: pageSize,
      total,
      hasMore: total === null ? result.list.length > 0 : page * pageSize < total,
    }
  },
})
