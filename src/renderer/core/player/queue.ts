import { toRaw } from '@common/utils/vueTools'
import { getPlaybackList, clearTempPlayeList, clearPlayedList, setPlayListId, setPlayMusicInfo } from '@renderer/store/player/action'
import { queueSession, resetQueueSession } from '@renderer/store/player/queueSession'
import { playInfo, playMusicInfo, tempPlayList } from '@renderer/store/player/state'
import { appSetting } from '@renderer/store/setting'
import { getNextPlayMusicInfo, getCachedRandomNextMusicInfo, playQueueMusic, resetRandomNextMusicInfo, capturePlaybackContext, capturePlaybackOwner, stop } from './action'
import { filterList } from './utils'

export interface PlaybackQueueEntry extends LX.Player.PlayMusicInfo {
  /** Object identity distinguishes duplicate pending entries and rejects stale UI actions. */
  pendingEntry?: LX.Player.PlayMusicInfo
}

/** Read the same session source and pending queue consumed by playback. */
export const getPlaybackQueue = async() => {
  const mode = appSetting['player.togglePlayMethod']
  const next = await getNextPlayMusicInfo()
  const pending: PlaybackQueueEntry[] = tempPlayList.map(item => ({ ...item, pendingEntry: item }))
  const listId = playInfo.playerListId
  if (!listId) return { next, entries: pending, random: false }
  if (mode === 'random') {
    if (!pending.length && next) pending.push(next)
    return { next, entries: pending, random: true }
  }
  const list = getPlaybackList(listId)
  const { filteredList, playerIndex } = await filterList({ listId, list, playedList: [], playerMusicInfo: list[playInfo.playerPlayIndex], isNext: true })
  let upcoming: typeof filteredList = []
  if (mode === 'singleLoop') {
    const repeated = filteredList[Math.max(0, playerIndex)]
    if (repeated) upcoming = [repeated]
  } else if (mode === 'list') upcoming = filteredList.slice(Math.max(0, playerIndex + 1))
  else if (mode === 'listLoop') upcoming = [...filteredList.slice(Math.max(0, playerIndex + 1)), ...filteredList.slice(0, playerIndex + 1)]
  pending.push(...upcoming.map(musicInfo => ({ musicInfo, listId, isTempPlay: false })))
  return { next, entries: pending, random: false }
}

const changed = () => {
  queueSession.revision++
  resetRandomNextMusicInfo()
}
const sourceIndex = (entry: PlaybackQueueEntry) => {
  if (entry.pendingEntry != null || entry.listId !== playInfo.playerListId) return -1
  return getPlaybackList(playInfo.playerListId).findIndex(song => song.id === entry.musicInfo.id)
}
export const isPlaybackQueueAnchor = (entry: PlaybackQueueEntry) => {
  const index = sourceIndex(entry)
  return index >= 0 && index === playInfo.playerPlayIndex
}
const pendingIndex = (entry: PlaybackQueueEntry) => entry.pendingEntry ? tempPlayList.indexOf(toRaw(entry.pendingEntry)) : -1
const writeSource = (list: Array<LX.Music.MusicInfo | LX.Download.ListItem>) => {
  const previous = getPlaybackList(playInfo.playerListId)
  const anchor = previous[playInfo.playerPlayIndex]
  const previousIndex = playInfo.playerPlayIndex
  queueSession.listId = playInfo.playerListId
  queueSession.list = list
  const index = anchor ? list.findIndex(song => song.id === anchor.id) : -1
  // If the current entry was removed, the previous slot becomes the traversal anchor.
  playInfo.playerPlayIndex = index < 0 ? Math.min(previousIndex - 1, list.length - 1) : index
  changed()
}

export const removePlaybackEntry = (entry: PlaybackQueueEntry) => {
  if (entry.pendingEntry) {
    const index = pendingIndex(entry)
    if (index < 0) return
    tempPlayList.splice(index, 1)
    changed()
  } else {
    const index = sourceIndex(entry)
    if (index < 0) return
    const list = [...getPlaybackList(playInfo.playerListId)]
    list.splice(index, 1)
    writeSource(list)
  }
}

export const playPlaybackEntry = (entry: PlaybackQueueEntry) => {
  if (entry.pendingEntry) {
    if (pendingIndex(entry) < 0) return
    removePlaybackEntry(entry)
  } else if (sourceIndex(entry) < 0) return
  playQueueMusic(entry)
}

/** Explicit enqueue wins over automatic random/repeat traversal, as existing Play Later does. */
export const enqueuePlaybackEntry = (entry: PlaybackQueueEntry, next: boolean) => {
  if (entry.pendingEntry ? pendingIndex(entry) < 0 : sourceIndex(entry) < 0) return
  const item: LX.Player.PlayMusicInfo = next && entry.pendingEntry ? toRaw(entry.pendingEntry) : {
    listId: entry.listId,
    musicInfo: entry.musicInfo,
    isTempPlay: true,
    alternativeMusicInfos: entry.alternativeMusicInfos,
  }
  if (next) {
    // Play Next moves an existing queue occurrence instead of introducing an accidental repeat.
    // The currently playing loop anchor is retained until playback advances.
    if (!isPlaybackQueueAnchor(entry)) removePlaybackEntry(entry)
    tempPlayList.unshift(item)
  } else tempPlayList.push(item)
  changed()
}

/** Swap adjacent visible rows, including across the pending/automatic boundary. */
export const movePlaybackEntry = (entry: PlaybackQueueEntry, neighbor: PlaybackQueueEntry) => {
  if (entry === neighbor) return
  const a = pendingIndex(entry)
  const b = pendingIndex(neighbor)
  if (entry.pendingEntry && neighbor.pendingEntry) {
    if (a < 0 || b < 0) return
    ;[tempPlayList[a], tempPlayList[b]] = [tempPlayList[b], tempPlayList[a]]
    changed()
  } else if (!entry.pendingEntry && !neighbor.pendingEntry) {
    const x = sourceIndex(entry)
    const y = sourceIndex(neighbor)
    if (x < 0 || y < 0) return
    // Keep the current anchor fixed; it may occur as the final repeat in a loop preview.
    if (x === playInfo.playerPlayIndex || y === playInfo.playerPlayIndex) return
    const list = [...getPlaybackList(playInfo.playerListId)]
    ;[list[x], list[y]] = [list[y], list[x]]
    writeSource(list)
  } else {
    const pending = entry.pendingEntry ? entry : neighbor
    const source = entry.pendingEntry ? neighbor : entry
    const index = pendingIndex(pending)
    if (index < 0 || sourceIndex(source) < 0 || isPlaybackQueueAnchor(source)) return
    removePlaybackEntry(source)
    tempPlayList.splice(index, 0, { musicInfo: source.musicInfo, listId: source.listId, isTempPlay: true })
    changed()
  }
}

export const clearPlaybackQueue = () => {
  stop()
  clearTempPlayeList()
  clearPlayedList()
  setPlayListId(null)
  setPlayMusicInfo(null, null)
  resetQueueSession()
  // An explicit clear must not be silently undone by radio refill.
  playInfo.isSelectionQueue = true
  // Reuse the existing finite-selection cancellation barrier: ends the recommendation epoch and timers.
  window.app_event.musicToggled('selection')
  changed()
}

const playPendingAfterRemoval = () => {
  if (!tempPlayList.length) return false
  const item = tempPlayList.shift()!
  changed()
  playQueueMusic(item, 'removed')
  return true
}

export const removeCurrentPlaybackEntry = async() => {
  if (!playMusicInfo.musicInfo) return
  const wasTemporary = playMusicInfo.isTempPlay
  // Preserve only an already resolved preview while revoking all removed audio/async ownership.
  const promisedNext = wasTemporary ? getCachedRandomNextMusicInfo() : null
  stop()
  const ownsPlayback = capturePlaybackOwner()
  const current = playMusicInfo.musicInfo
  if (!wasTemporary && playInfo.playerListId) {
    removePlaybackEntry({ musicInfo: current, listId: playInfo.playerListId, isTempPlay: false })
  }
  while (ownsPlayback()) {
    if (playPendingAfterRemoval()) return
    if (promisedNext) {
      playQueueMusic(promisedNext, 'removed')
      return
    }
    const valid = capturePlaybackContext()
    // A temporary overlay leaves its source anchor intact. Only a removed source entry advances past single-repeat.
    const next = await getNextPlayMusicInfo({ advanceFromRemovedSource: !wasTemporary })
    if (!valid()) continue
    if (playPendingAfterRemoval()) return
    if (next) playQueueMusic(next, 'removed')
    else clearPlaybackQueue()
    return
  }
}
