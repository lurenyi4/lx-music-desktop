// if (targetSong.key) { // 如果是已下载的歌曲
//   const filePath = path.join(appSetting['download.savePath'], targetSong.metadata.fileName)
//   // console.log(filePath)

import { requestMsg } from '@renderer/utils/message'
import {
  getMusicUrl as getOnlineMusicUrl,
  getPicUrl as getOnlinePicUrl,
  getLyricInfo as getOnlineLyricInfo,
} from './online'
import {
  getMusicUrl as getDownloadMusicUrl,
  getPicUrl as getDownloadPicUrl,
  getLyricInfo as getDownloadLyricInfo,
} from './download'
import {
  getMusicUrl as getLocalMusicUrl,
  getPicUrl as getLocalPicUrl,
  getLyricInfo as getLocalLyricInfo,
} from './local'


export const getMusicUrl = async({
  musicInfo,
  quality,
  isRefresh = false,
  onToggleSource,
  onToggleApiSource,
  allowToggleSource,
  onResolvedMusicInfo,
  alternativeMusicInfos,
}: {
  musicInfo: LX.Music.MusicInfo | LX.Download.ListItem
  isRefresh?: boolean
  quality?: LX.Quality
  onToggleSource?: (musicInfo?: LX.Music.MusicInfoOnline) => void
  onToggleApiSource?: () => void
  allowToggleSource?: boolean
  onResolvedMusicInfo?: (musicInfo: LX.Music.MusicInfoOnline) => void
  alternativeMusicInfos?: LX.Music.MusicInfoOnline[]
}): Promise<string> => {
  // Shared by playback and preloading. A previous rescue never becomes the next preference.
  const preferred = ('progress' in musicInfo ? musicInfo.metadata.musicInfo : musicInfo).meta.toggleMusicInfo
  if (preferred) {
    try {
      return await getOnlineMusicUrl({ musicInfo: preferred, quality, isRefresh, allowToggleSource: false, onResolvedMusicInfo, onToggleApiSource })
    } catch (err) {
      if (allowToggleSource === false || (err instanceof Error && err.message === requestMsg.cancelRequest)) throw err
      onToggleSource?.()
      return getOnlineMusicUrl({ musicInfo: preferred, quality, isRefresh, allowToggleSource: true, onResolvedMusicInfo, onToggleSource, onToggleApiSource, alternativeMusicInfos })
    }
  }
  if ('progress' in musicInfo) {
    return getDownloadMusicUrl({ musicInfo, isRefresh, onToggleSource, onToggleApiSource, allowToggleSource, onResolvedMusicInfo })
  } else if (musicInfo.source == 'local') {
    return getLocalMusicUrl({ musicInfo, isRefresh, onToggleSource, allowToggleSource })
  } else {
    return getOnlineMusicUrl({ musicInfo, isRefresh, quality, onToggleSource, onToggleApiSource, allowToggleSource, onResolvedMusicInfo, alternativeMusicInfos })
  }
}

export const getPicPath = async({
  musicInfo,
  isRefresh = false,
  listId,
  onToggleSource,
}: {
  musicInfo: LX.Music.MusicInfo | LX.Download.ListItem
  listId?: string | null
  isRefresh?: boolean
  onToggleSource?: (musicInfo?: LX.Music.MusicInfoOnline) => void
}): Promise<string> => {
  const preferred = ('progress' in musicInfo ? musicInfo.metadata.musicInfo : musicInfo).meta.toggleMusicInfo
  if (preferred) return getOnlinePicUrl({ musicInfo: preferred, isRefresh, onToggleSource })
  if ('progress' in musicInfo) {
    return getDownloadPicUrl({ musicInfo, isRefresh, listId, onToggleSource })
  } else if (musicInfo.source == 'local') {
    return getLocalPicUrl({ musicInfo, isRefresh, listId, onToggleSource })
  } else {
    return getOnlinePicUrl({ musicInfo, isRefresh, listId, onToggleSource })
  }
}

export const getLyricInfo = async({
  musicInfo,
  isRefresh = false,
  onToggleSource,
}: {
  musicInfo: LX.Music.MusicInfo | LX.Download.ListItem
  isRefresh?: boolean
  onToggleSource?: (musicInfo?: LX.Music.MusicInfoOnline) => void
}): Promise<LX.Player.LyricInfo> => {
  const preferred = ('progress' in musicInfo ? musicInfo.metadata.musicInfo : musicInfo).meta.toggleMusicInfo
  if (preferred) return getOnlineLyricInfo({ musicInfo: preferred, isRefresh, onToggleSource })
  if ('progress' in musicInfo) {
    return getDownloadLyricInfo({ musicInfo, isRefresh, onToggleSource })
  } else if (musicInfo.source == 'local') {
    return getLocalLyricInfo({ musicInfo, isRefresh, onToggleSource })
  } else {
    return getOnlineLyricInfo({ musicInfo, isRefresh, onToggleSource })
  }
}
