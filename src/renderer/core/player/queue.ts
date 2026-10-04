import { getList } from '@renderer/store/player/action'
import { playedList, playInfo, tempPlayList } from '@renderer/store/player/state'
import { appSetting } from '@renderer/store/setting'
import { getNextPlayMusicInfo } from './action'
import { filterList } from './utils'

/** Read the existing playback state; no second playback queue is maintained. */
export const getPlaybackQueue = async() => {
  const mode = appSetting['player.togglePlayMethod']
  const next = await getNextPlayMusicInfo()
  const pending = [...tempPlayList]
  const listId = playInfo.playerListId
  if (!listId) return { next, entries: pending, random: false }
  if (mode === 'random') {
    if (!pending.length && next) pending.push(next)
    return { next, entries: pending, random: true }
  }
  const list = getList(listId)
  const { filteredList, playerIndex } = await filterList({ listId, list, playedList, playerMusicInfo: list[playInfo.playerPlayIndex], isNext: true })
  let upcoming: typeof filteredList = []
  if (mode === 'singleLoop') {
    const repeated = filteredList[Math.max(0, playerIndex)]
    if (repeated) upcoming = [repeated]
  } else if (mode === 'list') upcoming = filteredList.slice(Math.max(0, playerIndex + 1))
  else if (mode === 'listLoop') upcoming = [...filteredList.slice(Math.max(0, playerIndex + 1)), ...filteredList.slice(0, playerIndex + 1)]
  pending.push(...upcoming.map(musicInfo => ({ musicInfo, listId, isTempPlay: false })))
  return { next, entries: pending, random: false }
}
