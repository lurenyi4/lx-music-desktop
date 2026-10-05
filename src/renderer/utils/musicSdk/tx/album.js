import { MusicSdkResponseError } from '../responseError'
import { createMusicuFetch, filterMusicInfoItem } from './singer'

export default {
  async getAlbumDetail(id, page = 1, limit = 50) {
    // Search/saved tracks historically store QQ's MID in albumId; singer rows use numeric IDs.
    const identity = typeof id === 'number' || /^[1-9]\d*$/.test(id)
      ? { albumID: Number(id) }
      : { albumMid: String(id) }
    if ('albumID' in identity && (!Number.isSafeInteger(identity.albumID) || identity.albumID <= 0)) throw new Error('Invalid album ID')
    const body = await createMusicuFetch({
      req: {
        module: 'music.musichallAlbum.AlbumSongList',
        method: 'GetAlbumSongList',
        param: { ...identity, begin: (page - 1) * limit, num: limit },
      },
    })
    const data = body.req?.data
    if (body.req == null || typeof body.req.code !== 'number') throw new MusicSdkResponseError()
    if (body.req.code !== 0) throw new Error('Get album songs failed')
    if (!Array.isArray(data?.songList)) throw new MusicSdkResponseError()
    let list
    try {
      list = data.songList.map(item => {
        if (typeof item?.songInfo?.mid !== 'string' || !item.songInfo.mid.trim()) throw new MusicSdkResponseError()
        return filterMusicInfoItem(item.songInfo)
      })
    } catch {
      throw new MusicSdkResponseError()
    }
    return {
      list,
      total: data.totalNum,
      page,
      limit,
      source: 'tx',
    }
  },
}
