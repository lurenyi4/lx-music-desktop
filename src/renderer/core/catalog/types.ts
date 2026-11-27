export type CatalogKind = 'artist' | 'album'
export interface CatalogTarget {
  kind: CatalogKind
  source: LX.OnlineSource
  id: string | number
  name: string
}
export interface CatalogPage {
  list: LX.Music.MusicInfoOnline[]
  page: number
  limit: number
  total: number | null
  hasMore: boolean
}
export interface CatalogRawPage {
  list: any[]
  limit?: number
  total?: number | string
}
export interface CatalogProvider {
  artist?: (id: string | number, page: number, limit: number) => Promise<CatalogRawPage>
  album?: (id: string | number, page: number, limit: number) => Promise<CatalogRawPage>
  detail?: (music: LX.Music.MusicInfoOnline) => Promise<{
    artists?: LX.Music.CatalogArtist[]
    albumId?: string | number
    albumName?: string
  } | null>
  /** Some endpoints choose their own page size instead of accepting a limit. */
  albumPageSize?: 'response-length'
}
export type CatalogProviders = Partial<Record<LX.OnlineSource, CatalogProvider>>
