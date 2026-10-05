<template>
  <button type="button" :class="$style.entry" :aria-label="$t('player__queue_title')" :title="playMusicInfo.versionNotice || $t('player__queue_open_tip')" @click="show = true">{{ $t('player__queue') }}<span v-if="playMusicInfo.versionNotice"> · {{ $t('player__temporary_version') }}</span></button>
  <material-modal :show="show" teleport="#root" @close="show = false">
    <section :class="$style.panel" :aria-label="$t('player__queue_title')">
      <h2>{{ $t('player__queue_title') }}</h2>
      <div v-if="playMusicInfo.musicInfo" :class="$style.current" aria-current="true">
        <p>{{ $t('player__queue_now_playing', { name: label(playMusicInfo.musicInfo) }) }}</p>
        <button type="button" :disabled="busy" @click="run(removeCurrentPlaybackEntry)">{{ $t('player__queue_remove_current') }}</button>
      </div>
      <p v-if="playInfo.isSelectionQueue" role="status">{{ $t('player__queue_radio_paused') }}</p>
      <p v-if="playMusicInfo.versionNotice" role="status">{{ playMusicInfo.versionNotice }}</p>
      <p v-if="error" role="alert">{{ $t('player__queue_load_error') }} <button type="button" @click="refresh">{{ $t('retry') }}</button></p>
      <template v-else>
        <p>{{ $t('player__queue_next', { name: next ? label(next?.musicInfo) : $t('player__queue_no_next') }) }}</p>
        <p v-if="random">{{ $t('player__queue_random_tip') }}</p>
        <p v-else-if="appSetting['player.togglePlayMethod'] === 'listLoop' && playInfo.playerListId !== null">{{ $t('player__queue_loop_tip') }}</p>
        <p v-else-if="playInfo.playerListId === null">{{ $t('player__queue_stop_tip') }}</p>
        <ol :class="$style.list">
          <li v-for="(item, index) in entries" :key="`${index}-${item.musicInfo.id}`">
            <button type="button" :class="$style.song" :disabled="busy" :aria-label="$t('player__queue_play_label', { name: label(item.musicInfo) })" @click="run(() => playPlaybackEntry(item))">{{ label(item.musicInfo) }}</button>
            <span v-if="item.isTempPlay"> · {{ $t('player__queue_pending') }}</span>
            <div :class="$style.actions" role="group" :aria-label="label(item.musicInfo)">
              <button type="button" :disabled="busy" @click="run(() => enqueuePlaybackEntry(item, true))">{{ $t('player__queue_insert_next') }}</button>
              <button type="button" :disabled="busy" @click="run(() => enqueuePlaybackEntry(item, false))">{{ $t('player__queue_enqueue') }}</button>
              <button type="button" :disabled="busy || !canMove(index, -1)" :aria-label="$t('player__queue_move_up')" @click="run(() => movePlaybackEntry(item, entries[index - 1]))">↑</button>
              <button type="button" :disabled="busy || !canMove(index, 1)" :aria-label="$t('player__queue_move_down')" @click="run(() => movePlaybackEntry(item, entries[index + 1]))">↓</button>
              <button type="button" :disabled="busy" @click="run(() => isCurrent(item) ? removeCurrentPlaybackEntry() : removePlaybackEntry(item))">{{ $t('player__queue_remove') }}</button>
            </div>
          </li>
        </ol>
        <p v-if="!entries.length">{{ $t('player__queue_empty') }}</p>
      </template>
      <p v-if="operationError" role="alert">{{ $t('player__queue_action_error') }}</p>
      <p :class="$style.hint">{{ $t('player__queue_session_tip') }}</p>
      <div v-if="confirmClear" role="group" :aria-label="$t('player__queue_clear_confirm')">
        <p>{{ $t('player__queue_clear_confirm') }}</p>
        <button type="button" :disabled="busy" @click="run(clearPlaybackQueue); confirmClear = false">{{ $t('player__queue_clear_all') }}</button>
        <button type="button" @click="confirmClear = false">{{ $t('btn_cancel') }}</button>
      </div>
      <button v-else-if="entries.length || playMusicInfo.musicInfo" type="button" :disabled="busy" @click="confirmClear = true">{{ $t('player__queue_clear_all') }}</button>
      <button type="button" @click="show = false">{{ $t('close') }}</button>
    </section>
  </material-modal>
</template>

<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from '@common/utils/vueTools'
import { playMusicInfo, playInfo, tempPlayList } from '@renderer/store/player/state'
import { queueSession } from '@renderer/store/player/queueSession'
import { appSetting } from '@renderer/store/setting'
import { getPreferredMusicInfo } from '@renderer/core/music/version'
import { getPlaybackQueue, playPlaybackEntry, enqueuePlaybackEntry, movePlaybackEntry, removePlaybackEntry, removeCurrentPlaybackEntry, clearPlaybackQueue, isPlaybackQueueAnchor, type PlaybackQueueEntry } from '@renderer/core/player/queue'

const show = ref(false)
const entries = ref<PlaybackQueueEntry[]>([])
const busy = ref(false)
const confirmClear = ref(false)
const operationError = ref(false)
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
const isCurrent = (item: PlaybackQueueEntry) => !item.pendingEntry && !playMusicInfo.isTempPlay && item.musicInfo.id === playMusicInfo.musicInfo?.id
const canMove = (index: number, delta: number) => {
  const item = entries.value[index]
  const neighbor = entries.value[index + delta]
  return !!neighbor && !isPlaybackQueueAnchor(item) && !isPlaybackQueueAnchor(neighbor) && (!random.value || !!item.pendingEntry || !!neighbor.pendingEntry)
}
const run = async(action: () => void | Promise<void>) => {
  if (busy.value) return
  busy.value = true
  operationError.value = false
  try {
    await action()
    await refresh()
  } catch {
    operationError.value = true
  } finally {
    busy.value = false
  }
}
window.app_event.on('myListUpdate', refresh)
window.app_event.on('downloadListUpdate', refresh)
onBeforeUnmount(() => {
  request++
  window.app_event.off('myListUpdate', refresh)
  window.app_event.off('downloadListUpdate', refresh)
})
watch(() => [show.value, playMusicInfo.musicInfo, playInfo.playerPlayIndex, queueSession.revision, tempPlayList.map(item => item.musicInfo.id).join(','), appSetting['player.togglePlayMethod']], () => { if (!show.value) confirmClear.value = false; void refresh() })
</script>

<style lang="less" module>
.entry { flex: none; margin: 0 8px; padding: 5px; color: var(--color-font); background: transparent; border: 0; cursor: pointer; }
.panel { box-sizing: border-box; max-height: calc(76vh - 18px); overflow: auto; width: 540px; max-width: 80vw; padding: 20px; line-height: 1.6; p { margin: 10px 0; } button { margin-right: 12px; } }
.list { max-height: 42vh; overflow: auto; list-style: decimal; padding-left: 24px; li { padding: 8px 0; border-bottom: 1px solid var(--color-primary-light-100-alpha-100); } }
.current { padding-bottom: 8px; border-bottom: 1px solid var(--color-primary-light-100-alpha-100); }
.actions { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
.panel button { cursor: pointer; min-height: 30px; }
.panel button:disabled { cursor: default; opacity: .4; }
.panel button:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
.song { background: transparent; border: 0; color: var(--color-font); text-align: left; }
.hint { font-size: 12px; opacity: .75; }
</style>
