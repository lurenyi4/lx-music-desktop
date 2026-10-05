import type * as VueTools from '@common/utils/vueTools'
import { EventEmitter } from 'node:events'
import useWatchList from '@renderer/core/useApp/usePlayer/useWatchList'
import { playNext } from '@renderer/core/player'
import { beforeEach, expect, it, vi } from 'vitest'
import { getPlayIndex, getPlaybackList, setPlayListId } from './action'
import { playInfo, playMusicInfo } from './state'
import { queueSession } from './queueSession'
const mocks = vi.hoisted(() => ({ saved: [] as any[] }))
vi.mock('./state', () => ({ playInfo: { playerListId: 'saved', playerPlayIndex: 0 }, playMusicInfo: {}, musicInfo: {}, isPlay: {}, status: {}, statusText: {}, isShowPlayerDetail: {}, isShowPlayComment: {}, isShowLrcSelectContent: {}, playedList: [], tempPlayList: [] }))
vi.mock('@renderer/store/list/action', () => ({ getListMusicsFromCache: () => mocks.saved }))
vi.mock('@renderer/store/download/state', () => ({ downloadList: [] }))
vi.mock('./playProgress', () => ({ setProgress: vi.fn() }))
vi.mock('@renderer/core/player', () => ({ playNext: vi.fn(), stop: vi.fn(), resetRandomNextMusicInfo: vi.fn() }))
vi.mock('@common/utils', () => ({ throttle: (fn: any) => fn }))
vi.mock('@common/utils/vueTools', async(importOriginal) => ({ ...await importOriginal<typeof VueTools>(), onBeforeUnmount: vi.fn() }))
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('window', { app_event: new EventEmitter(), lx: { isPlayedStop: false } })
  mocks.saved = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  setPlayListId('saved')
  playInfo.playerPlayIndex = 0
})
it('keeps saved-list and reordered playback indices independent', () => {
  queueSession.listId = 'saved'
  queueSession.list = [mocks.saved[2], mocks.saved[0], mocks.saved[1]]
  expect(getPlayIndex('saved', mocks.saved[0], false)).toEqual({ playIndex: 0, playerPlayIndex: 1 })
  expect(getPlaybackList('saved')).toBe(queueSession.list)
})
it('preserves the before-first cursor while a temporary track is playing', () => {
  queueSession.listId = 'saved'
  queueSession.list = [mocks.saved[1], mocks.saved[2]]
  playInfo.playerPlayIndex = -1
  expect(getPlayIndex(null, { id: 'temp' } as any, true).playerPlayIndex).toBe(-1)
})
it('starting an explicit playlist discards playback-only edits', () => {
  queueSession.listId = 'saved'; queueSession.list = [mocks.saved[2]]
  setPlayListId('saved')
  expect(getPlaybackList('saved')).toBe(mocks.saved)
  expect(queueSession.list).toBe(null)
})
it('a saved list deleted elsewhere does not corrupt an active snapshot cursor', () => {
  const song = mocks.saved[1]
  queueSession.listId = 'saved'; queueSession.list = [song]
  mocks.saved = []
  expect(getPlayIndex('saved', song, false)).toEqual({ playIndex: -1, playerPlayIndex: 0 })
})
it('saved removal, clearing and subsequent list updates never skip a current session song', () => {
  const current = mocks.saved[1]
  queueSession.listId = 'saved'; queueSession.list = [current, mocks.saved[2]]
  Object.assign(playMusicInfo, { musicInfo: current, listId: 'saved', isTempPlay: false })
  useWatchList()
  mocks.saved.splice(1, 1)
  ;(window.app_event as any).emit('myListUpdate', ['saved'])
  mocks.saved.splice(0)
  ;(window.app_event as any).emit('myListUpdate', ['saved'])
  ;(window.app_event as any).emit('myListUpdate', ['saved'])
  expect(playNext).not.toHaveBeenCalled()
  expect(playInfo.playIndex).toBe(-1)
  expect(playInfo.playerPlayIndex).toBe(0)
  expect(playMusicInfo.musicInfo).toBe(current)
})
it('without a session snapshot removing current from its source still advances playback', () => {
  Object.assign(playMusicInfo, { musicInfo: mocks.saved[1], listId: 'saved', isTempPlay: false })
  useWatchList()
  mocks.saved.splice(1, 1)
  ;(window.app_event as any).emit('myListUpdate', ['saved'])
  expect(playNext).toHaveBeenCalledWith(true, 'removed')
})
