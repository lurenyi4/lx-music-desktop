import { getDownloadFilePath } from '@renderer/utils/music'

import {
  getVersionMusicUrl as getOnlineMusicUrl,
  getPicUrl as getOnlinePicUrl,
  getLyricInfo as getOnlineLyricInfo,
} from './online'
import { getPreferredMusicInfo } from './version'
import { buildLyricInfo, getCachedLyricInfo } from './utils'
import { buildSavePath } from '@renderer/store/download/utils'

export const getMusicUrl = async({ musicInfo, isRefresh, allowToggleSource = true, onResolvedMusicInfo, onToggleSource = () => {}, onToggleApiSource }: {
  musicInfo: LX.Download.ListItem
  isRefresh: boolean
  onToggleSource?: (musicInfo?: LX.Music.MusicInfoOnline) => void
  onToggleApiSource?: () => void
  allowToggleSource?: boolean
  onResolvedMusicInfo?: (musicInfo: LX.Music.MusicInfoOnline) => void
}): Promise<string> => {
  if (!isRefresh) {
    const path = await getDownloadFilePath(musicInfo, buildSavePath(musicInfo))
    if (path) return path
  }

  return getOnlineMusicUrl({ musicInfo: musicInfo.metadata.musicInfo, isRefresh, onToggleSource, onToggleApiSource, allowToggleSource, onResolvedMusicInfo })
}

export const getPicUrl = async({ musicInfo, isRefresh, listId, onToggleSource = () => {} }: {
  musicInfo: LX.Download.ListItem
  isRefresh: boolean
  listId?: string | null
  onToggleSource?: (musicInfo?: LX.Music.MusicInfoOnline) => void
}): Promise<string> => {
  const preferred = getPreferredMusicInfo(musicInfo.metadata.musicInfo)
  const targetOnline = preferred.source === 'local' ? musicInfo.metadata.musicInfo : preferred
  if (!isRefresh) {
    const path = await getDownloadFilePath(musicInfo, buildSavePath(musicInfo))
    if (path) {
      const pic = await window.lx.worker.main.getMusicFilePic(path)
      if (pic) return pic
    }

    if (targetOnline.meta.picUrl) return targetOnline.meta.picUrl
  }

  return getOnlinePicUrl({ musicInfo: targetOnline, isRefresh, onToggleSource }).then((url) => {
    // TODO: when listId required save url (update downloadInfo)

    return url
  })
}

export const getLyricInfo = async({ musicInfo, isRefresh, onToggleSource = () => {} }: {
  musicInfo: LX.Download.ListItem
  isRefresh: boolean
  onToggleSource?: (musicInfo?: LX.Music.MusicInfoOnline) => void
}): Promise<LX.Player.LyricInfo> => {
  const preferred = getPreferredMusicInfo(musicInfo.metadata.musicInfo)
  const targetOnline = preferred.source === 'local' ? musicInfo.metadata.musicInfo : preferred
  if (!isRefresh) {
    const lyricInfo = await getCachedLyricInfo(targetOnline)
    if (lyricInfo) return buildLyricInfo(lyricInfo)
  }

  return getOnlineLyricInfo({
    musicInfo: targetOnline,
    isRefresh,
    onToggleSource,
  }).catch(async() => {
    // 尝试读取文件内歌词
    const path = await getDownloadFilePath(musicInfo, buildSavePath(musicInfo))
    if (path) {
      const rawlrcInfo = await window.lx.worker.main.getMusicFileLyric(path)
      if (rawlrcInfo) return buildLyricInfo(rawlrcInfo)
    }

    throw new Error('failed')
  })
}
