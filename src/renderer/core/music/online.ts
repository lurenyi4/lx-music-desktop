import { requestMsg } from '@renderer/utils/message'
import { getPreferredMusicInfo } from './version'
import { appSetting } from '@renderer/store/setting'
import {
  saveLyric,
  saveMusicUrl,
  getMusicUrlInfo,
} from '@renderer/utils/ipc'
import {
  buildLyricInfo,
  getPlayQuality,
  handleGetOnlineLyricInfo,
  handleGetOnlineMusicUrl,
  handleGetOnlinePicUrl,
  getCachedLyricInfo,
} from './utils'

/* export const setMusicUrl = ({ musicInfo, type, url }: {
  musicInfo: LX.Music.MusicInfo
  type: LX.Quality
  url: string
}) => {
  saveMusicUrl(musicInfo, type, url)
}

export const setPic = (datas: {
  listId: string
  musicInfo: LX.Music.MusicInfo
  url: string
}) => {
  datas.musicInfo.img = datas.url
  updateMusicInfo({
    listId: datas.listId,
    id: datas.musicInfo.songmid,
    data: { img: datas.url },
    musicInfo: datas.musicInfo,
  })
}
 */


export const getMusicUrl = async({ musicInfo, quality, isRefresh, allowToggleSource = true, onResolvedMusicInfo, onToggleSource = () => {}, onToggleApiSource, alternativeMusicInfos }: {
  musicInfo: LX.Music.MusicInfoOnline
  quality?: LX.Quality
  isRefresh: boolean
  allowToggleSource?: boolean
  alternativeMusicInfos?: LX.Music.MusicInfoOnline[]
  /** 只报告实际取流条目；播放状态和歌单写回由播放器提交。 */
  onResolvedMusicInfo?: (musicInfo: LX.Music.MusicInfoOnline) => void
  onToggleSource?: (musicInfo?: LX.Music.MusicInfoOnline) => void
  onToggleApiSource?: () => void
}): Promise<string> => {
  // if (!musicInfo._types[type]) {
  //   // 兼容旧版酷我源搜索列表过滤128k音质的bug
  //   if (!(musicInfo.source == 'kw' && type == '128k')) throw new Error('该歌曲没有可播放的音频')

  //   // return Promise.reject(new Error('该歌曲没有可播放的音频'))
  // }
  const targetQuality = quality ?? getPlayQuality(appSetting['player.playQuality'], musicInfo)
  const cached = isRefresh ? null : await getMusicUrlInfo(musicInfo, targetQuality)
  // 旧 URL 缓存可能属于别的平台；来源不明时重新取流，不能谎报为原条目。
  if (cached?.musicInfo && cached.musicInfo.id === musicInfo.id) {
    onResolvedMusicInfo?.(cached.musicInfo)
    return cached.url
  }

  return handleGetOnlineMusicUrl({ musicInfo, quality, onToggleSource, onToggleApiSource, isRefresh, allowToggleSource, alternativeMusicInfos }).then(async({ url, quality: targetQuality, musicInfo: targetMusicInfo, isFromCache }) => {
    const saves = isFromCache ? [] : [saveMusicUrl(targetMusicInfo, targetQuality, url, targetMusicInfo)]
    // 预加载完成后正式播放即可读取完整结果；写缓存失败仍允许播放有效地址。
    await Promise.all(saves).catch(err => { console.warn('[music] 缓存取流结果失败', err) })
    onResolvedMusicInfo?.(targetMusicInfo)
    return url
  })
}

/** Shared online-version policy; download callers invoke it only after checking the saved file. */
export const getVersionMusicUrl = async(options: Omit<Parameters<typeof getMusicUrl>[0], 'musicInfo'> & { musicInfo: LX.Music.MusicInfo }): Promise<string> => {
  const preferred = getPreferredMusicInfo(options.musicInfo)
  if (preferred.source === 'local') throw new Error('online version unavailable')
  if (preferred === options.musicInfo) return getMusicUrl({ ...options, musicInfo: preferred })
  try {
    return await getMusicUrl({ ...options, musicInfo: preferred, allowToggleSource: false })
  } catch (error) {
    if (options.allowToggleSource === false || (error instanceof Error && error.message === requestMsg.cancelRequest)) throw error
    options.onToggleSource?.()
    return getMusicUrl({ ...options, musicInfo: preferred, allowToggleSource: true })
  }
}

export const getPicUrl = async({ musicInfo, isRefresh, allowToggleSource = true, onToggleSource = () => {} }: {
  musicInfo: LX.Music.MusicInfoOnline
  listId?: string | null
  isRefresh: boolean
  allowToggleSource?: boolean
  onToggleSource?: (musicInfo?: LX.Music.MusicInfoOnline) => void
}): Promise<string> => {
  if (musicInfo.meta.picUrl && !isRefresh) return musicInfo.meta.picUrl
  return handleGetOnlinePicUrl({ musicInfo, onToggleSource, isRefresh, allowToggleSource }).then(({ url, musicInfo: targetMusicInfo, isFromCache }) => {
    // Automatic artwork belongs to this playback request, not a full saved-list metadata update.
    // A late result must never overwrite a newer manual version or another saved entry.
    return url
  })
}
export const getLyricInfo = async({ musicInfo, isRefresh, allowToggleSource = true, onToggleSource = () => {} }: {
  musicInfo: LX.Music.MusicInfoOnline
  isRefresh: boolean
  allowToggleSource?: boolean
  onToggleSource?: (musicInfo?: LX.Music.MusicInfoOnline) => void
}): Promise<LX.Player.LyricInfo> => {
  if (!isRefresh) {
    const lyricInfo = await getCachedLyricInfo(musicInfo)
    if (lyricInfo) return buildLyricInfo(lyricInfo)
  }

  // lrcRequest = music[musicInfo.source].getLyric(musicInfo)
  return handleGetOnlineLyricInfo({ musicInfo, onToggleSource, isRefresh, allowToggleSource }).then(async({ lyricInfo, musicInfo: targetMusicInfo, isFromCache }) => {
    // lrcRequest = null
    if (isFromCache) return buildLyricInfo(lyricInfo)
    if (targetMusicInfo.id == musicInfo.id) void saveLyric(musicInfo, lyricInfo)
    else void saveLyric(targetMusicInfo, lyricInfo)

    return buildLyricInfo(lyricInfo)
  })
}
