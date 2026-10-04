import { reactive } from '@common/utils/vueTools'
import { createCatalogController, createCatalogState } from './controller'
import { catalogAdapter } from './sdk'
import { type CatalogKind } from './types'

export const catalogState = reactive(createCatalogState())
export const catalogActions = createCatalogController(catalogState, catalogAdapter)
export const openMusicCatalog = (kind: CatalogKind, music: LX.Music.MusicInfo) => {
  void catalogActions.open(kind, music)
}
