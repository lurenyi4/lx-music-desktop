import { getPreferredMusicInfo } from './version'
import { playMusicInfo } from '@renderer/store/player/state'

/** Record only this playback's actual resource. Saved identity and manual choice stay intact. */
export const writebackToggleMusicInfo = async(originalInfo: LX.Music.MusicInfo | LX.Download.ListItem, resolvedInfo: LX.Music.MusicInfoOnline) => {
  if (playMusicInfo.musicInfo !== originalInfo) return
  playMusicInfo.resolvedMusicInfo = resolvedInfo
  const preferred = getPreferredMusicInfo(originalInfo)
  playMusicInfo.versionNotice = preferred.id === resolvedInfo.id
    ? undefined
    : window.i18n.t('player__temporary_version_notice', { name: resolvedInfo.name, singer: resolvedInfo.singer, source: resolvedInfo.source })
}
