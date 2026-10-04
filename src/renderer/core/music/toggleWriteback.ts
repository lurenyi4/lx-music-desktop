import { playMusicInfo } from '@renderer/store/player/state'

/** Record only this playback's actual resource. Saved identity and manual choice stay intact. */
export const writebackToggleMusicInfo = async(originalInfo: LX.Music.MusicInfoOnline, resolvedInfo: LX.Music.MusicInfoOnline) => {
  if (playMusicInfo.musicInfo !== originalInfo) return
  playMusicInfo.resolvedMusicInfo = resolvedInfo
  const preferred = originalInfo.meta.toggleMusicInfo ?? originalInfo
  playMusicInfo.versionNotice = preferred.id === resolvedInfo.id
    ? undefined
    : `所选版本暂不可用，正在临时播放：${resolvedInfo.name} · ${resolvedInfo.singer}（${resolvedInfo.source}）；收藏和所选版本未改变`
}
