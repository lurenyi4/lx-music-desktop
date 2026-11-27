import { shallowReactive } from '@common/utils/vueTools'

type Music = LX.Music.MusicInfo | LX.Download.ListItem
/** A lazily created playback-only copy. Queue edits never write the user's saved playlist. */
export const queueSession = shallowReactive({
  listId: null as string | null,
  list: null as Music[] | null,
  revision: 0,
})
export const getQueueSource = (listId: string | null, original: Music[]): Music[] =>
  queueSession.list !== null && queueSession.listId === listId ? queueSession.list : original
export const resetQueueSession = () => {
  queueSession.listId = null
  queueSession.list = null
  queueSession.revision++
}

/** Metadata follows an authoritative saved-row update; membership/order remain session-owned. */
export const updateQueueSessionMusic = (listId: string, musicInfo: LX.Music.MusicInfo) => {
  if (queueSession.listId !== listId || !queueSession.list?.some(item => item.id === musicInfo.id)) return
  queueSession.list = queueSession.list.map(item => item.id === musicInfo.id ? musicInfo : item)
  queueSession.revision++
}
