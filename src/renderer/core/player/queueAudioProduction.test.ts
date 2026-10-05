import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { filterMusicList } from '@renderer/worker/main/list'
import { playList, playNext, play, stop, playMusicInfoNow, getNextPlayMusicInfo } from '@renderer/core/player/action'
import { clearPlaybackQueue, removeCurrentPlaybackEntry } from '@renderer/core/player/queue'
import { addTempPlayList } from '@renderer/store/player/action'
import { playedList, playMusicInfo, tempPlayList } from '@renderer/store/player/state'


const mocks = vi.hoisted(() => ({
  saved: [] as any[],
  urlJobs: [] as Array<{ resolve: (url: string | null) => void, reject: (error: Error) => void, options: any }>,
  jobs: [] as Array<{ args: any, resolve: (result: any) => void }>,
  explore: vi.fn(),
  setting: { 'player.autoSkipOnError': true, 'player.togglePlayMethod': 'list', 'recommend.radio': false, 'recommend.autoRefill': true, 'recommend.radius': 50, 'recommend.engine': 'local', 'ai.enable': false },
  state: { isPlay: { value: false }, playedList: [], tempPlayList: [], musicInfo: { id: '' }, playInfo: {}, playMusicInfo: {}, status: {}, statusText: {} },
}))
vi.mock('@renderer/store/player/state', () => mocks.state)
vi.mock('@renderer/store/setting', () => ({ appSetting: mocks.setting, updateSetting: vi.fn() }))
vi.mock('@renderer/store/list/action', () => ({ getListMusicsFromCache: () => mocks.saved, addListMusics: vi.fn(), removeListMusics: vi.fn() }))
vi.mock('@renderer/store/list/state', () => ({ loveList: { id: 'love' } }))
vi.mock('@renderer/store/download/state', () => ({ downloadList: [] }))
vi.mock('@renderer/store/player/playProgress', () => ({ setProgress: vi.fn() }))
vi.mock('@renderer/plugins/player', async(importOriginal) => importOriginal())
vi.mock('@renderer/core/music/index', () => ({ getMusicUrl: async(options: any) => new Promise((resolve, reject) => mocks.urlJobs.push({ resolve, reject, options })), getPicPath: async() => null, getLyricInfo: async() => ({ rawlrcInfo: { lyric: '' } }) }))
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
let events: EventEmitter
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers(); mocks.jobs.splice(0); mocks.urlJobs.splice(0)
  events = new EventEmitter()
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
  for (const job of mocks.urlJobs) job.resolve(null)
  await flush()
  stop()
  await vi.advanceTimersByTimeAsync(0)
  vi.useRealTimers(); vi.unstubAllGlobals()
})

const flush = async() => { for (let i = 0; i < 20; i++) await Promise.resolve() }
const audio = { src: '', autoplay: false, controls: false, preload: '', crossOrigin: '', addEventListener: vi.fn(), pause: vi.fn(), removeAttribute: (name: string) => { if (name === 'src') audio.src = '' } }
const createAudio = async() => {
  ;(window as any).Audio = function() { return audio }
  const plugin = await import('@renderer/plugins/player')
  plugin.createAudio()
  return audio
}
it.each(['resolve', 'reject'] as const)('removed source URL %s cannot restore audio, report errors or schedule a skip while successor is pending', async(outcome) => {
  const audio = await createAudio()
  prepare('list', ['a', 'b'])
  const old = mocks.urlJobs[0]
  const removal = removeCurrentPlaybackEntry()
  await vi.advanceTimersByTimeAsync(0)
  const status = structuredClone(mocks.state.statusText)
  old.options.onToggleSource(song('other'))
  old.options.onToggleApiSource()
  if (outcome === 'resolve') old.resolve('https://fixture.invalid/removed-a.mp3')
  else old.reject(new Error('stale failure'))
  await flush()
  expect(audio.src).toBe('')
  expect(audio.autoplay).toBe(true)
  expect(mocks.state.statusText).toEqual(status)
  expect(window.app_event.error).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(100001)
  expect(mocks.jobs).toHaveLength(1)
  await release(); await removal
  expect(playMusicInfo.musicInfo?.id).toBe('b')
  mocks.urlJobs[1].resolve('https://fixture.invalid/b.mp3')
  await flush()
  expect(audio.src).toBe('https://fixture.invalid/b.mp3')
})
it.each(['resolve', 'reject'] as const)('direct stop permits same-song resume and old %s/finally cannot cancel its loading timer', async(outcome) => {
  const audio = await createAudio()
  prepare('list', ['a', 'b'])
  const old = mocks.urlJobs[0]
  stop(); play()
  expect(mocks.urlJobs).toHaveLength(2)
  if (outcome === 'resolve') old.resolve('https://fixture.invalid/old-a.mp3')
  else old.reject(new Error('old failure'))
  await flush()
  expect(audio.src).toBe('')
  await vi.advanceTimersByTimeAsync(100001)
  expect(mocks.jobs).toHaveLength(1)
  await release(); await flush()
  expect(playMusicInfo.musicInfo?.id).toBe('b')
  mocks.urlJobs[2].resolve('https://fixture.invalid/b.mp3')
  await flush()
  expect(audio.src).toBe('https://fixture.invalid/b.mp3')
})
it('explicit same-song resume loads normally after stop and suppresses the old delayed stop event', async() => {
  const audio = await createAudio()
  prepare('list', ['a', 'b'])
  const onStop = vi.fn()
  window.app_event.on('stop', onStop)
  stop(); play()
  mocks.urlJobs[1].resolve('https://fixture.invalid/resumed-a.mp3')
  await flush(); await vi.advanceTimersByTimeAsync(0)
  expect(audio.src).toBe('https://fixture.invalid/resumed-a.mp3')
  expect(onStop).not.toHaveBeenCalled()
})
it.each([['clear', 'resolve'], ['clear', 'reject'], ['empty-next', 'resolve'], ['empty-next', 'reject']] as const)('%s invalidates a loading URL %s and its timer', async(action, outcome) => {
  const audio = await createAudio()
  prepare('list', ['a'])
  const old = mocks.urlJobs[0]
  if (action === 'clear') clearPlaybackQueue()
  else {
    mocks.saved.splice(0)
    const next = playNext(true)
    await release(); await next
  }
  if (outcome === 'resolve') old.resolve('https://fixture.invalid/old-a.mp3')
  else old.reject(new Error('late failure'))
  await flush(); await vi.advanceTimersByTimeAsync(100001)
  expect(audio.src).toBe('')
  expect(mocks.jobs).toHaveLength(0)
  expect(playMusicInfo.musicInfo).toBeNull()
  prepare('list', ['b'])
  mocks.urlJobs[1].resolve('https://fixture.invalid/new-b.mp3')
  await flush()
  expect(audio.src).toBe('https://fixture.invalid/new-b.mp3')
})
it('stop clears an already scheduled error-skip timer', async() => {
  await createAudio()
  prepare('list', ['a', 'b'])
  mocks.urlJobs[0].reject(new Error('first failure'))
  await flush()
  mocks.urlJobs[1].reject(new Error('retry failure'))
  await flush()
  expect(window.app_event.error).toHaveBeenCalledOnce()
  stop()
  await vi.advanceTimersByTimeAsync(100001)
  expect(mocks.jobs).toHaveLength(0)
})

it('direct stop cancels a loading timeout even when the transport never settles', async() => {
  const audio = await createAudio()
  prepare('list', ['a', 'b'])
  stop()
  await vi.advanceTimersByTimeAsync(100001)
  expect(mocks.jobs).toHaveLength(0)
  expect(audio.src).toBe('')
})

it.each(['resolve', 'reject', 'pending'] as const)('temporary removal revokes its URL %s and timers while preserving the source anchor', async(outcome) => {
  const audio = await createAudio()
  prepare('list', ['a', 'b'])
  playMusicInfoNow(song('temporary'))
  const old = mocks.urlJobs[1]
  const removal = removeCurrentPlaybackEntry()
  if (outcome === 'resolve') old.resolve('https://fixture.invalid/removed-temporary.mp3')
  if (outcome === 'reject') old.reject(new Error('removed temporary failure'))
  await flush(); await vi.advanceTimersByTimeAsync(100001)
  expect(audio.src).toBe('')
  expect(window.app_event.error).not.toHaveBeenCalled()
  expect(mocks.jobs).toHaveLength(1)
  await release(); await removal
  expect(playMusicInfo.musicInfo?.id).toBe('b')
  expect(mocks.saved.map(item => item.id)).toEqual(['a', 'b'])
  mocks.urlJobs[2].resolve('https://fixture.invalid/b.mp3')
  await flush()
  expect(audio.src).toBe('https://fixture.invalid/b.mp3')
})
it('a new explicit same-temporary-song owner wins over pending removal and gets a fresh URL', async() => {
  const audio = await createAudio()
  prepare('list', ['a', 'b'])
  const temporary = song('temporary')
  playMusicInfoNow(temporary)
  const removal = removeCurrentPlaybackEntry()
  playMusicInfoNow(temporary)
  expect(mocks.urlJobs).toHaveLength(3)
  mocks.urlJobs[1].resolve('https://fixture.invalid/old.mp3')
  mocks.urlJobs[2].resolve('https://fixture.invalid/new.mp3')
  await release(); await removal; await flush()
  expect(playMusicInfo.musicInfo?.id).toBe('temporary')
  expect(audio.src).toBe('https://fixture.invalid/new.mp3')
})
it('temporary removal plays pending next before the automatic source successor', async() => {
  const audio = await createAudio()
  prepare('list', ['a', 'b'])
  playMusicInfoNow(song('temporary'))
  addTempPlayList([{ listId: 'pending', musicInfo: song('pending') }])
  await removeCurrentPlaybackEntry()
  mocks.urlJobs[1].resolve('https://fixture.invalid/old.mp3')
  mocks.urlJobs[2].resolve('https://fixture.invalid/pending.mp3')
  await flush()
  expect(mocks.jobs).toHaveLength(0)
  expect(playMusicInfo.musicInfo?.id).toBe('pending')
  expect(audio.src).toBe('https://fixture.invalid/pending.mp3')
})
it('temporary removal consumes an already resolved random preview without a new random worker', async() => {
  const audio = await createAudio()
  prepare('random', ['a', 'b', 'c'])
  playMusicInfoNow(song('temporary'))
  const preview = getNextPlayMusicInfo()
  await release()
  const promised = await preview
  expect(promised).not.toBeNull()
  await removeCurrentPlaybackEntry()
  expect(mocks.jobs).toHaveLength(0)
  expect(playMusicInfo.musicInfo?.id).toBe(promised?.musicInfo.id)
  mocks.urlJobs[1].resolve('https://fixture.invalid/old.mp3')
  await flush()
  expect(audio.src).toBe('')
})

vi.mock('@renderer/plugins/i18n', () => ({ useI18n: () => (key: string) => key }))
it.each(['clear-restart', 'remove-to-pending'] as const)('review: deferred old media error cannot advance %s owner', async(action) => {
  const audio = await createAudio()
  vi.stubGlobal('document', { hidden: false })
  const { default: usePlayEvent } = await import('@renderer/core/useApp/usePlayer/usePlayEvent')
  usePlayEvent()
  prepare('list', ['a', 'b', 'c'])
  mocks.urlJobs[0].resolve('https://fixture.invalid/a.mp3')
  await flush()
  // Real recoverable media errors get two URL refresh attempts, then a deferred skip.
  for (let retry = 0; retry < 2; retry++) {
    events.emit('playerError', 2)
    mocks.urlJobs.at(-1)!.resolve(`https://fixture.invalid/a-retry${retry}.mp3`)
    await flush()
  }
  events.emit('playerError', 2)
  if (action === 'clear-restart') {
    clearPlaybackQueue()
    prepare('list', ['new-a', 'new-b'])
  } else {
    addTempPlayList([{ listId: 'pending', musicInfo: song('new-a') }])
    await removeCurrentPlaybackEntry()
  }
  mocks.urlJobs.at(-1)!.resolve('https://fixture.invalid/new-a.mp3')
  await flush()
  expect(playMusicInfo.musicInfo?.id).toBe('new-a')
  expect(audio.src).toBe('https://fixture.invalid/new-a.mp3')
  // Even the new media resource's normal emptied/playing cleanup happens before old registration.
  events.emit('playerEmptied')
  events.emit('playerPlaying')
  await vi.advanceTimersByTimeAsync(5001)
  for (let i = 0; i < 4 && mocks.jobs.length; i++) { await release(); await flush() }
  expect(playMusicInfo.musicInfo?.id, 'the obsolete error timer must not skip healthy new playback').toBe('new-a')
})
it('review: an unchanged owner still performs its ordinary media-error skip', async() => {
  await createAudio()
  vi.stubGlobal('document', { hidden: false })
  const { default: usePlayEvent } = await import('@renderer/core/useApp/usePlayer/usePlayEvent')
  usePlayEvent()
  prepare('list', ['a', 'b'])
  mocks.urlJobs[0].resolve('https://fixture.invalid/a.mp3')
  await flush()
  for (let retry = 0; retry < 2; retry++) {
    events.emit('playerError', 2)
    mocks.urlJobs.at(-1)!.resolve(`https://fixture.invalid/retry${retry}.mp3`)
    await flush()
  }
  events.emit('playerError', 2)
  await vi.advanceTimersByTimeAsync(5001)
  await release(); await flush()
  expect(playMusicInfo.musicInfo?.id).toBe('b')
})

const prepareMediaConsumer = async() => {
  await createAudio()
  vi.stubGlobal('document', { hidden: false })
  const { default: usePlayEvent } = await import('@renderer/core/useApp/usePlayer/usePlayEvent')
  usePlayEvent()
  prepare('list', ['a', 'b'])
  mocks.urlJobs[0].resolve('https://fixture.invalid/a.mp3')
  await flush()
}
it.each([
  ['playerPlaying', false], ['playerPlaying', true],
  ['playerEmptied', false], ['playerEmptied', true],
] as const)('%s cancels media-error work (five-second timer already registered=%s)', async(event, registered) => {
  await prepareMediaConsumer()
  events.emit('playerError', 1)
  if (registered) await vi.advanceTimersByTimeAsync(0)
  const { setResource } = await import('@renderer/plugins/player')
  setResource('https://fixture.invalid/recovered-a.mp3')
  events.emit(event)
  await vi.advanceTimersByTimeAsync(5001)
  expect(mocks.jobs).toHaveLength(0)
  expect(playMusicInfo.musicInfo?.id).toBe('a')
})
it('repeated terminal media errors retain one pending skip for the originating playback', async() => {
  await prepareMediaConsumer()
  events.emit('playerError', 1)
  events.emit('playerError', 1)
  await vi.advanceTimersByTimeAsync(0)
  events.emit('playerError', 1)
  await vi.advanceTimersByTimeAsync(5001)
  expect(mocks.jobs).toHaveLength(1)
  await release(); await flush()
  expect(playMusicInfo.musicInfo?.id).toBe('b')
})
it('clearing without restart cancels deferred media error work', async() => {
  await prepareMediaConsumer()
  events.emit('playerError', 1)
  clearPlaybackQueue()
  await vi.advanceTimersByTimeAsync(5001)
  expect(mocks.jobs).toHaveLength(0)
  expect(playMusicInfo.musicInfo).toBeNull()
})
it('same-object stop/resume replaces the owner of an already registered media-error skip', async() => {
  await prepareMediaConsumer()
  const current = playMusicInfo.musicInfo
  events.emit('playerError', 1)
  await vi.advanceTimersByTimeAsync(0)
  stop(); play()
  expect(playMusicInfo.musicInfo).toBe(current)
  mocks.urlJobs.at(-1)!.resolve('https://fixture.invalid/resumed-a.mp3')
  await flush(); await vi.advanceTimersByTimeAsync(5001)
  expect(mocks.jobs).toHaveLength(0)
  expect(audio.src).toBe('https://fixture.invalid/resumed-a.mp3')
})
it('same-object resume also invalidates the old media loading timeout before its refresh side effect', async() => {
  await prepareMediaConsumer()
  events.emit('playerLoadstart')
  stop(); play()
  mocks.urlJobs.at(-1)!.resolve('https://fixture.invalid/resumed-a.mp3')
  await flush()
  const count = mocks.urlJobs.length
  await vi.advanceTimersByTimeAsync(25001)
  expect(mocks.urlJobs).toHaveLength(count)
  expect(mocks.jobs).toHaveLength(0)
})
it('an unchanged media loading owner still requests its normal URL refresh', async() => {
  await prepareMediaConsumer()
  events.emit('playerLoadstart')
  await vi.advanceTimersByTimeAsync(25001)
  expect(mocks.urlJobs).toHaveLength(2)
  expect(mocks.jobs).toHaveLength(0)
})

it('the failed resource own emptied notification does not cancel its legitimate error skip', async() => {
  await prepareMediaConsumer()
  events.emit('playerError', 1)
  expect(audio.src).toBe('')
  events.emit('playerEmptied')
  await vi.advanceTimersByTimeAsync(5001)
  expect(mocks.jobs).toHaveLength(1)
  await release(); await flush()
  expect(playMusicInfo.musicInfo?.id).toBe('b')
})
