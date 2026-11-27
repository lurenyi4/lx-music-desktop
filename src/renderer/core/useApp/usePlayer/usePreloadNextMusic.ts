import { onBeforeUnmount, watch } from '@common/utils/vueTools'
import { onTimeupdate, getCurrentTime } from '@renderer/plugins/player'
import { playProgress } from '@renderer/store/player/playProgress'
import { musicInfo, tempPlayList } from '@renderer/store/player/state'
import { queueSession } from '@renderer/store/player/queueSession'
// import { getList } from '@renderer/store/utils'
import { getNextPlayMusicInfo, resetRandomNextMusicInfo } from '@renderer/core/player'
import { getMusicUrl } from '@renderer/core/music'
import { appSetting } from '@renderer/store/setting'

let audio: HTMLAudioElement
const initAudio = () => {
  if (audio) return
  audio = new Audio()
  audio.controls = false
  audio.preload = 'auto'
  audio.crossOrigin = 'anonymous'
  audio.muted = true
  audio.volume = 0
  audio.autoplay = true
  audio.addEventListener('playing', () => {
    audio.pause()
  })
}
const checkMusicUrl = async(url: string): Promise<boolean> => {
  initAudio()
  return new Promise((resolve) => {
    const clear = () => {
      audio.removeEventListener('error', handleErr)
      audio.removeEventListener('canplay', handlePlay)
    }
    const handleErr = () => {
      clear()
      if (audio?.error?.code !== 1) {
        resolve(false)
      } else {
        resolve(true)
      }
    }
    const handlePlay = () => {
      clear()
      resolve(true)
    }
    audio.addEventListener('error', handleErr)
    audio.addEventListener('canplay', handlePlay)
    audio.src = url
  })
}

let preloadEpoch = 0
const preloadMusicInfo = {
  isLoading: false,
  preProgress: 0,
  info: null as LX.Player.PlayMusicInfo | null,
}
const resetPreloadInfo = () => {
  preloadEpoch++
  preloadMusicInfo.preProgress = 0
  preloadMusicInfo.info = null
  preloadMusicInfo.isLoading = false
}
const preloadNextMusicUrl = async(curTime: number) => {
  if (preloadMusicInfo.isLoading || curTime - preloadMusicInfo.preProgress < 3) return
  const epoch = ++preloadEpoch
  preloadMusicInfo.isLoading = true
  try {
    console.log('preload next music url')
    const info = await getNextPlayMusicInfo()
    if (epoch !== preloadEpoch) return
    if (info) {
      preloadMusicInfo.info = info
      const url = await getMusicUrl({ musicInfo: info.musicInfo, alternativeMusicInfos: info.alternativeMusicInfos }).catch(() => '')
      if (epoch !== preloadEpoch) return
      if (url) {
        console.log('preload url', url)
        const result = await checkMusicUrl(url)
        if (epoch !== preloadEpoch) return
        if (!result) {
          const refreshedUrl = await getMusicUrl({ musicInfo: info.musicInfo, alternativeMusicInfos: info.alternativeMusicInfos, isRefresh: true }).catch(() => '')
          if (epoch !== preloadEpoch || !refreshedUrl) return
          void checkMusicUrl(refreshedUrl)
          console.log('preload url refresh', refreshedUrl)
        }
      }
    }
  } finally {
    if (epoch === preloadEpoch) preloadMusicInfo.isLoading = false
  }
}

export default () => {
  const setProgress = (time: number) => {
    if (!musicInfo.id) return
    preloadMusicInfo.preProgress = time
  }

  const handleSetPlayInfo = () => {
    resetPreloadInfo()
  }

  watch(() => appSetting['player.togglePlayMethod'], () => {
    if (!preloadMusicInfo.info || preloadMusicInfo.info.isTempPlay) return
    resetRandomNextMusicInfo()
    preloadEpoch++
    preloadMusicInfo.info = null
    preloadMusicInfo.isLoading = false
    preloadMusicInfo.preProgress = playProgress.nowPlayTime
  })

  watch([() => queueSession.revision, () => tempPlayList.length], () => {
    if (!preloadMusicInfo.info && !preloadMusicInfo.isLoading) return
    preloadEpoch++
    preloadMusicInfo.info = null
    preloadMusicInfo.isLoading = false
    preloadMusicInfo.preProgress = playProgress.nowPlayTime
  })

  window.app_event.on('setProgress', setProgress)
  window.app_event.on('musicToggled', handleSetPlayInfo)

  const rOnTimeupdate = onTimeupdate(() => {
    const time = getCurrentTime()
    const duration = playProgress.maxPlayTime
    if (duration > 10 && duration - time < 10 && !preloadMusicInfo.info) {
      void preloadNextMusicUrl(time)
    }
  })


  onBeforeUnmount(() => {
    rOnTimeupdate()
    window.app_event.off('setProgress', setProgress)
    window.app_event.off('musicToggled', handleSetPlayInfo)
  })
}
