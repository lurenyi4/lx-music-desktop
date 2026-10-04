<template>
  <button type="button" :class="$style.entry" aria-label="当前播放队列" :title="playMusicInfo.versionNotice || '查看下一首与播放队列'" @click="show = true">队列<span v-if="playMusicInfo.versionNotice"> · 临时版本</span></button>
  <material-modal :show="show" teleport="#root" @close="show = false">
    <section :class="$style.panel" aria-label="当前播放队列">
      <h2>当前播放队列</h2>
      <p v-if="playMusicInfo.musicInfo">正在播放：{{ label(playMusicInfo.musicInfo) }}</p>
      <p v-if="playMusicInfo.versionNotice" role="status">{{ playMusicInfo.versionNotice }}</p>
      <p v-if="error" role="alert">队列加载失败，请重试 <button type="button" @click="refresh">重试</button></p>
      <template v-else>
        <p>下一首：{{ next ? label(next.musicInfo) : '无（播放结束后停止）' }}</p>
        <p v-if="random">随机播放：下方先显示已排定歌曲，其余歌曲将在切歌时决定</p>
        <p v-else-if="appSetting['player.togglePlayMethod'] === 'listLoop'">按以下顺序播放，列表结束后循环</p>
        <ol :class="$style.list"><li v-for="(item, index) in entries" :key="`${index}-${item.musicInfo.id}`">{{ label(item.musicInfo) }}<span v-if="item.isTempPlay"> · 已排队</span></li></ol>
        <p v-if="!entries.length">暂无后续歌曲</p>
      </template>
      <button v-if="tempPlayList.length" type="button" @click="clearPending">清空待播队列</button>
      <button type="button" @click="show = false">关闭</button>
    </section>
  </material-modal>
</template>

<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from '@common/utils/vueTools'
import { playMusicInfo, playInfo, tempPlayList } from '@renderer/store/player/state'
import { clearTempPlayeList } from '@renderer/store/player/action'
import { appSetting } from '@renderer/store/setting'
import { getPlaybackQueue } from '@renderer/core/player/queue'

const show = ref(false)
const entries = ref<LX.Player.PlayMusicInfo[]>([])
const next = ref<LX.Player.PlayMusicInfo | null>(null)
const random = ref(false)
const error = ref(false)
let request = 0
const label = (music: LX.Music.MusicInfo | LX.Download.ListItem) => {
  const info = 'progress' in music ? music.metadata.musicInfo : music
  const selected = info.meta.toggleMusicInfo ?? info
  return `${selected.name} · ${selected.singer}`
}
const refresh = async() => {
  const id = ++request
  if (!show.value) return
  error.value = false
  try {
    const result = await getPlaybackQueue()
    if (id !== request || !show.value) return
    entries.value = result.entries
    next.value = result.next
    random.value = result.random
  } catch {
    if (id === request) error.value = true
  }
}
const clearPending = () => { clearTempPlayeList(); void refresh() }
window.app_event.on('myListUpdate', refresh)
window.app_event.on('downloadListUpdate', refresh)
onBeforeUnmount(() => {
  request++
  window.app_event.off('myListUpdate', refresh)
  window.app_event.off('downloadListUpdate', refresh)
})
watch(() => [show.value, playMusicInfo.musicInfo, playInfo.playerPlayIndex, tempPlayList.map(item => item.musicInfo.id).join(','), appSetting['player.togglePlayMethod']], () => { void refresh() })
</script>

<style lang="less" module>
.entry { flex: none; margin: 0 8px; padding: 5px; color: var(--color-font); background: transparent; border: 0; cursor: pointer; }
.panel { width: 540px; max-width: 80vw; padding: 20px; line-height: 1.6; p { margin: 10px 0; } button { margin-right: 12px; } }
.list { max-height: 45vh; overflow: auto; list-style: decimal; padding-left: 24px; }
</style>
