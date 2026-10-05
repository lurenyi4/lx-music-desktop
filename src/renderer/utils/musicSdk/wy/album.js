import { MusicSdkResponseError } from '../responseError'
import { eapiRequest } from './utils/index'
import singer from './singer'

export default {
  async getAlbumDetail(id, page = 1, limit = 50) {
    const { body } = await eapiRequest(`/api/v1/album/${encodeURIComponent(id)}`, {}).promise
    if (body?.code !== 200) throw new Error('Get album songs failed')
    if (!Array.isArray(body.songs)) throw new MusicSdkResponseError()
    const songs = body.songs.slice((page - 1) * limit, page * limit)
    // The legacy singer converter silently skips missing IDs. A nonempty malformed page is not an empty album.
    const validId = id => (typeof id === 'number' && Number.isSafeInteger(id) && id > 0) || (typeof id === 'string' && /^[1-9]\d*$/.test(id))
    if (songs.some(song => !song || !validId(song.id))) throw new MusicSdkResponseError()
    let list
    try {
      list = singer.filterSongList(songs)
    } catch {
      throw new MusicSdkResponseError()
    }
    // This endpoint returns the complete album. Present the same one-based paging contract as other SDKs.
    return {
      list,
      total: body.songs.length,
      page,
      limit,
      source: 'wy',
    }
  },
}
