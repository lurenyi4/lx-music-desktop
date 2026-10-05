import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { filterMusicList } from '@renderer/worker/main/list'
import { getNextPlayMusicInfo, playList, playNext, restartSelectedVersion, playMusicInfoNow } from '@renderer/core/player/action'
import { clearPlaybackQueue, removeCurrentPlaybackEntry, removePlaybackEntry, enqueuePlaybackEntry } from '@renderer/core/player/queue'
import { addTempPlayList, getPlaybackList } from '@renderer/store/player/action'
import { playedList, playMusicInfo, tempPlayList } from '@renderer/store/player/state'

import { listMusicUpdateInfo } from '@renderer/store/list/listManage/action'
import { allMusicList } from '@renderer/store/list/listManage/state'
import { createManualVersion, getPreferredMusicInfo } from '@renderer/core/music/version'

const mocks = vi.hoisted(() => ({
  saved: [] as any[],
  jobs: [] as Array<{ args: any, resolve: (result: any) => void }>,
  explore: vi.fn(),
  setting: { 'player.togglePlayMethod': 'list', 'recommend.radio': false, 'recommend.autoRefill': true, 'recommend.radius': 50, 'recommend.engine': 'local', 'ai.enable': false },
  state: { isPlay: { value: false }, playedList: [], tempPlayList: [], musicInfo: {}, playInfo: {}, playMusicInfo: {}, status: {}, statusText: {} },
}))
vi.mock('@renderer/store/player/state', () => mocks.state)
vi.mock('@renderer/store/setting', () => ({ appSetting: mocks.setting, updateSetting: vi.fn() }))
vi.mock('@renderer/store/list/action', () => ({ getListMusicsFromCache: () => mocks.saved, addListMusics: vi.fn(), removeListMusics: vi.fn() }))
vi.mock('@renderer/store/list/state', () => ({ loveList: { id: 'love' } }))
vi.mock('@renderer/store/download/state', () => ({ downloadList: [] }))
vi.mock('@renderer/store/player/playProgress', () => ({ setProgress: vi.fn() }))
vi.mock('@renderer/plugins/player', () => ({ isEmpty: () => true, setPause: vi.fn(), setPlay: vi.fn(), setResource: vi.fn(), setStop: vi.fn() }))
vi.mock('@renderer/core/music/index', () => ({ getMusicUrl: async() => null, getPicPath: async() => null, getLyricInfo: async() => ({ rawlrcInfo: { lyric: '' } }) }))
vi.mock('@renderer/core/music/toggleWriteback', () => ({ writebackToggleMusicInfo: async() => {} }))
vi.mock('@renderer/utils/message', () => ({ requestMsg: {} }))
vi.mock('@renderer/utils/index', () => ({ getRandom: () => 0 }))
vi.mock('@renderer/core/dislikeList', () => ({ addDislikeInfo: vi.fn() }))
vi.mock('@renderer/store/dislikeList', () => ({ dislikeInfo: { names: new Set(), musicNames: new Set(), singerNames: new Set() } }))
vi.mock('@renderer/utils/ipc', () => ({ setPowerSaveBlocker: vi.fn() }))
vi.mock('@renderer/utils/music', () => ({ createLocalMusicInfo: vi.fn() }))
vi.mock('@common/utils/nodejs', () => ({ joinPath: vi.fn(), saveStrToFile: vi.fn() }))
vi.mock('@renderer/core/recommend/engine', () => ({ exploreOnce: mocks.explore }))
vi.mock('@renderer/core/recommend/platformEngine', () => ({ explorePlatformOnce: mocks.explore }))
vi.mock('@renderer/store/list/listManage/rendererListManage', () => ({ getListMusics: async() => [] }))
vi.mock('@renderer/core/recommend/feature', () => ({ startFeatureCollection: vi.fn(), stopFeatureCollection: vi.fn() }))
vi.mock('@renderer/core/recommend/profile', () => ({ getProfileState: () => null, onProfileSignal: vi.fn(), recordRecommendedSkip: vi.fn() }))
vi.mock('@renderer/utils/data', () => ({ getRecommendMetrics: async() => null, saveRecommendMetrics: vi.fn() }))

const song = (id: string): LX.Music.MusicInfoOnline => ({ id, name: id, singer: 'Artist', source: 'wy', interval: null, meta: { songId: id, albumName: '', qualitys: [], _qualitys: {} } })
const prepare = (mode: 'list' | 'random', ids: string[]) => {
  playedList.splice(0); tempPlayList.splice(0)
  mocks.saved = ids.map(song)
  mocks.setting['player.togglePlayMethod'] = mode
  playList('list', 0)
}
const release = async(index = 0) => {
  const job = mocks.jobs.splice(index, 1)[0]
  expect(job).toBeDefined()
  job.resolve(await filterMusicList(job.args))
}
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers(); mocks.jobs.splice(0)
  const events = new EventEmitter()
  Object.assign(events, { musicToggled: (reason: string) => events.emit('musicToggled', reason), pause: () => events.emit('pause'), stop: () => events.emit('stop'), picUpdated: vi.fn(), lyricUpdated: vi.fn(), error: vi.fn() })
  vi.stubGlobal('window', {
    app_event: events,
    i18n: { t: (key: string) => key },
    lx: { isProd: true, isPlayedStop: false, worker: { main: { filterMusicList: async(args: any) => new Promise(resolve => { mocks.jobs.push({ args: structuredClone(args), resolve }) }) } } },
  })
})
afterEach(async() => {
  const { endSession } = await import('@renderer/core/recommend/session')
  endSession()
  await vi.advanceTimersByTimeAsync(0)
  vi.useRealTimers(); vi.unstubAllGlobals()
})
const preferredCurrent = () => {
  const current = playMusicInfo.musicInfo
  if (!current) throw new Error('Expected a current song')
  return getPreferredMusicInfo(current)
}

it('manual version confirmation remains effective after a session queue edit and loop traversal', async() => {
  prepare('list', ['a', 'b', 'c'])
  removePlaybackEntry({ listId: 'list', musicInfo: mocks.saved[2], isTempPlay: false })
  const replacement = createManualVersion(mocks.saved[0], song('selected-version'))
  // list_music_update replaces the row object in the real renderer cache.
  allMusicList.set('list', mocks.saved)
  listMusicUpdateInfo([{ id: 'list', musicInfo: replacement }])
  restartSelectedVersion('list', replacement)
  expect(preferredCurrent().id).toBe('selected-version')
  mocks.setting['player.togglePlayMethod'] = 'singleLoop'
  const next = playNext(true)
  await release(); await next
  expect(preferredCurrent().id).toBe('selected-version')
  expect(getPreferredMusicInfo(mocks.saved[0]).id).toBe('selected-version')
  expect(getPlaybackList('list').map(song => song.id)).toEqual(['a', 'b'])
})
it('removing a temporary current song in single-repeat honors the displayed automatic anchor', async() => {
  prepare('list', ['a', 'b'])
  mocks.setting['player.togglePlayMethod'] = 'singleLoop'
  playMusicInfoNow(song('temporary'))
  const preview = getNextPlayMusicInfo()
  await release()
  expect((await preview)?.musicInfo.id).toBe('a')
  const removal = removeCurrentPlaybackEntry()
  await release(); await removal
  expect(playMusicInfo.musicInfo?.id).toBe('a')
})
it('queue Play Next during an ended traversal does not strand the completed song', async() => {
  prepare('list', ['a', 'b', 'c'])
  const next = playNext(true)
  enqueuePlaybackEntry({ listId: 'list', musicInfo: mocks.saved[2], isTempPlay: false }, true)
  await release(); await next
  // The real worker reply has returned, with no remaining work or second ended event.
  expect(mocks.jobs).toHaveLength(0)
  expect(playMusicInfo.musicInfo?.id).toBe('c')
})

it('a future manual version follows list-loop order and survives deletion from the saved list', async() => {
  prepare('list', ['a', 'b', 'c'])
  removePlaybackEntry({ listId: 'list', musicInfo: mocks.saved[2], isTempPlay: false })
  const replacement = createManualVersion(mocks.saved[1], song('selected-b'))
  allMusicList.set('list', mocks.saved)
  listMusicUpdateInfo([{ id: 'list', musicInfo: replacement }])
  restartSelectedVersion('list', replacement)
  expect(playMusicInfo.musicInfo?.id).toBe('a')
  expect(getPlaybackList('list').map(song => song.id)).toEqual(['a', 'b'])
  mocks.saved.splice(1, 1)
  mocks.setting['player.togglePlayMethod'] = 'listLoop'
  const next = playNext(true)
  await release(); await next
  expect(preferredCurrent().id).toBe('selected-b')
  expect(mocks.saved.map(song => song.id)).toEqual(['a', 'c'])
  expect(getPlaybackList('list').map(song => song.id)).toEqual(['a', 'b'])
})
it('manual confirmation also updates an already pending occurrence without restarting the unrelated current song', async() => {
  prepare('list', ['a', 'b', 'c'])
  enqueuePlaybackEntry({ listId: 'list', musicInfo: mocks.saved[1], isTempPlay: false }, true)
  const occurrence = tempPlayList[0]
  const replacement = createManualVersion(mocks.saved[1], song('selected-pending-b'))
  allMusicList.set('list', mocks.saved)
  listMusicUpdateInfo([{ id: 'list', musicInfo: replacement }])
  restartSelectedVersion('list', replacement)
  expect(playMusicInfo.musicInfo?.id).toBe('a')
  expect(tempPlayList[0]).toBe(occurrence)
  await playNext(true)
  expect(preferredCurrent().id).toBe('selected-pending-b')
})
it.each([0, 1])('temporary removal preserves single-repeat source anchor at index %s', async(index) => {
  prepare('list', ['a', 'b'])
  playList('list', index)
  mocks.setting['player.togglePlayMethod'] = 'singleLoop'
  playMusicInfoNow(song('overlay'))
  const removal = removeCurrentPlaybackEntry()
  await release(); await removal
  expect(playMusicInfo.musicInfo?.id).toBe(index === 0 ? 'a' : 'b')
  expect(mocks.setting['player.togglePlayMethod']).toBe('singleLoop')
})
it('pending still wins when a temporary single-repeat current is removed', async() => {
  prepare('list', ['a', 'b'])
  mocks.setting['player.togglePlayMethod'] = 'singleLoop'
  playMusicInfoNow(song('overlay'))
  addTempPlayList([{ listId: null, musicInfo: song('pending') }])
  await removeCurrentPlaybackEntry()
  expect(playMusicInfo.musicInfo?.id).toBe('pending')
  expect(mocks.jobs).toHaveLength(0)
})

// A queue revision may need another worker job; an obsolete playback owner must never retry.
const settleTraversal = async(promise: Promise<void>) => {
  let done = false
  void promise.then(() => { done = true })
  for (let attempt = 0; attempt < 10; attempt++) {
    if (done) break
    for (let microtask = 0; microtask < 10; microtask++) await Promise.resolve()
    if (mocks.jobs.length) await release()
  }
  expect(done, 'normal queue edits should finish without requiring a second ended event').toBe(true)
  await promise
}
it.each(['append', 'remove', 'reorder', 'mode'] as const)('ended traversal completes after a same-owner %s change', async(change) => {
  prepare('list', ['a', 'b', 'c'])
  const toggled = vi.fn()
  window.app_event.on('musicToggled', toggled)
  const next = playNext(true)
  if (change === 'append') enqueuePlaybackEntry({ listId: 'list', musicInfo: mocks.saved[2], isTempPlay: false }, false)
  if (change === 'remove') removePlaybackEntry({ listId: 'list', musicInfo: mocks.saved[1], isTempPlay: false })
  if (change === 'reorder') {
    const { movePlaybackEntry } = await import('@renderer/core/player/queue')
    movePlaybackEntry({ listId: 'list', musicInfo: mocks.saved[2], isTempPlay: false }, { listId: 'list', musicInfo: mocks.saved[1], isTempPlay: false })
  }
  if (change === 'mode') mocks.setting['player.togglePlayMethod'] = 'singleLoop'
  await settleTraversal(next)
  expect(playMusicInfo.musicInfo?.id).toBe(change === 'mode' ? 'a' : 'c')
  expect(toggled).toHaveBeenCalledExactlyOnceWith('ended')
  expect(mocks.jobs).toHaveLength(0)
})
it.each(['clear', 'restart'] as const)('ended traversal never retries after %s replaces its owner', async(change) => {
  prepare('list', ['a', 'b', 'c'])
  const next = playNext(true)
  if (change === 'clear') clearPlaybackQueue()
  else playList('list', 2)
  await settleTraversal(next)
  expect(playMusicInfo.musicInfo?.id ?? null).toBe(change === 'clear' ? null : 'c')
  expect(mocks.jobs).toHaveLength(0)
})
it('multiple same-owner revisions use an awaited retry loop rather than recursive playback or stale selection', async() => {
  prepare('list', ['a', 'b', 'c'])
  const next = playNext(true)
  removePlaybackEntry({ listId: 'list', musicInfo: mocks.saved[1], isTempPlay: false })
  await release()
  for (let i = 0; i < 10; i++) await Promise.resolve()
  expect(mocks.jobs).toHaveLength(1)
  enqueuePlaybackEntry({ listId: 'list', musicInfo: mocks.saved[2], isTempPlay: false }, true)
  await settleTraversal(next)
  expect(playMusicInfo.musicInfo?.id).toBe('c')
  expect(tempPlayList).toHaveLength(0)
})
it('metadata for the same song in a different saved list cannot replace this session selection', () => {
  prepare('list', ['a', 'b', 'c'])
  removePlaybackEntry({ listId: 'list', musicInfo: mocks.saved[2], isTempPlay: false })
  allMusicList.set('other', [mocks.saved[0]])
  const otherVersion = createManualVersion(mocks.saved[0], song('other-list-version'))
  listMusicUpdateInfo([{ id: 'other', musicInfo: otherVersion }])
  restartSelectedVersion('other', otherVersion)
  expect(getPreferredMusicInfo(getPlaybackList('list')[0]).id).toBe('a')
  expect(getPreferredMusicInfo(mocks.saved[0]).id).toBe('a')
})
it.each([false, true])('an ended traversal follows the confirmed future version with a same-owner metadata update (snapshot=%s)', async(snapshot) => {
  prepare('list', ['a', 'b', 'c'])
  if (snapshot) removePlaybackEntry({ listId: 'list', musicInfo: mocks.saved[2], isTempPlay: false })
  const next = playNext(true)
  const replacement = createManualVersion(mocks.saved[1], song('newly-selected-b'))
  allMusicList.set('list', mocks.saved)
  listMusicUpdateInfo([{ id: 'list', musicInfo: replacement }])
  restartSelectedVersion('list', replacement)
  await settleTraversal(next)
  expect(preferredCurrent().id).toBe('newly-selected-b')
  expect(getPreferredMusicInfo(mocks.saved[1]).id).toBe('newly-selected-b')
})
it('source-current removal uses the normal random history exclusions rather than replaying an already played song', async() => {
  prepare('random', ['a', 'b', 'c'])
  playList('list', 1)
  expect(playedList.map(entry => entry.musicInfo.id)).toEqual(['a', 'b'])
  const removal = removeCurrentPlaybackEntry()
  await release(); await removal
  expect(playMusicInfo.musicInfo?.id).toBe('c')
  expect(mocks.setting['player.togglePlayMethod']).toBe('random')
})
it.each([false, true])('source-current deletion supersedes an older single-loop ended task (remove finishes first=%s)', async(removeFirst) => {
  prepare('list', ['a', 'b', 'c'])
  playList('list', 1)
  mocks.setting['player.togglePlayMethod'] = 'singleLoop'
  const ended = playNext(true)
  const removal = removeCurrentPlaybackEntry()
  expect(mocks.jobs).toHaveLength(2)
  await release(removeFirst ? 1 : 0)
  await release()
  await ended; await removal
  expect(playMusicInfo.musicInfo?.id).toBe('c')
  expect(mocks.jobs).toHaveLength(0)
})
