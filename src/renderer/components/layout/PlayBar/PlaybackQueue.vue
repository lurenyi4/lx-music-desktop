<template>
  <button type="button" :class="$style.entry" :aria-label="$t('player__queue_title')" :title="playMusicInfo.versionNotice || $t('player__queue_open_tip')" @click="show = true">{{ $t('player__queue') }}<span v-if="playMusicInfo.versionNotice"> · {{ $t('player__temporary_version') }}</span></button>
  <material-modal :show="show" teleport="#root" @close="show = false">
    <section :class="$style.panel" :aria-label="$t('player__queue_title')">
      <h2>{{ $t('player__queue_title') }}</h2>
      <p v-if="playMusicInfo.musicInfo">{{ $t('player__queue_now_playing', { name: label(playMusicInfo.musicInfo) }) }}</p>
      <p v-if="playInfo.isSelectionQueue" role="status">{{ $t('player__queue_radio_paused') }}</p>
      <p v-if="playMusicInfo.versionNotice" role="status">{{ playMusicInfo.versionNotice }}</p>
      <p v-if="error" role="alert">{{ $t('player__queue_load_error') }} <button type="button" @click="refresh">{{ $t('retry') }}</button></p>
      <template v-else>
        <p>{{ $t('player__queue_next', { name: next ? label(next?.musicInfo) : $t('player__queue_no_next') }) }}</p>
        <p v-if="random">{{ $t('player__queue_random_tip') }}</p>
        <p v-else-if="appSetting['player.togglePlayMethod'] === 'listLoop' && playInfo.playerListId !== null">{{ $t('player__queue_loop_tip') }}</p>
        <p v-else-if="playInfo.playerListId === null">{{ $t('player__queue_stop_tip') }}</p>
        <ol :class="$style.list"><li v-for="(item, index) in entries" :key="`${index}-${item.musicInfo.id}`">{{ label(item.musicInfo) }}<span v-if="item.isTempPlay"> · {{ $t('player__queue_pending') }}</span></li></ol>
        <p v-if="!entries.length">{{ $t('player__queue_empty') }}</p>
      </template>
      <button v-if="tempPlayList.length" type="button" @click="clearPending">{{ $t('player__queue_clear') }}</button>
      <button type="button" @click="show = false">{{ $t('close') }}</button>
    </section>
  </material-modal>
</template>

<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from '@common/utils/vueTools'
import { playMusicInfo, playInfo, tempPlayList } from '@renderer/store/player/state'
import { clearTempPlayeList } from '@renderer/store/player/action'
import { appSetting } from '@renderer/store/setting'
import { getPreferredMusicInfo } from '@renderer/core/music/version'
import { getPlaybackQueue } from '@renderer/core/player/queue'

const show = ref(false)
const entries = ref<LX.Player.PlayMusicInfo[]>([])
const next = ref<LX.Player.PlayMusicInfo | null>(null)
const random = ref(false)
const error = ref(false)
let request = 0
const label = (music: LX.Music.MusicInfo | LX.Download.ListItem | null | undefined) => {
  if (!music) return ''
  const selected = getPreferredMusicInfo(music)
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
