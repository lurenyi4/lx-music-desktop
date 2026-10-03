import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { playMusicInfoNow, playNext, setMusicUrl } from './action'
import { playInfo, playMusicInfo, tempPlayList } from '@renderer/store/player/state'
import { clearTempPlayeList, setPlayMusicInfo, removeTempPlayList, addPlayedList } from '@renderer/store/player/action'
import { setResource, setStop } from '@renderer/plugins/player'
import { getMusicUrl } from '../music/index'
import { writebackToggleMusicInfo } from '../music/toggleWriteback'
import { getMusicUrl as getOnlineMusicUrl } from '../music/online'

const urlCache = vi.hoisted(() => ({ entries: new Map<string, LX.Music.MusicUrlInfo>(), resolve: vi.fn() }))
vi.mock('../music/utils', () => ({
  getPlayQuality: () => '128k',
  handleGetOnlineMusicUrl: urlCache.resolve,
}))
vi.mock('@renderer/utils/ipc', () => ({
  getMusicUrl: async(info: LX.Music.MusicInfo, quality: LX.Quality) => urlCache.entries.get(`${info.id}_${quality}`)?.url ?? '',
  getMusicUrlInfo: async(info: LX.Music.MusicInfo, quality: LX.Quality) => urlCache.entries.get(`${info.id}_${quality}`) ?? null,
  saveMusicUrl: async(info: LX.Music.MusicInfo, quality: LX.Quality, url: string, musicInfo?: LX.Music.MusicInfoOnline) => {
    const id = `${info.id}_${quality}`
    urlCache.entries.set(id, { id, url, musicInfo })
  },
}))

vi.mock('@renderer/plugins/player', () => ({ isEmpty: vi.fn(), setPause: vi.fn(), setPlay: vi.fn(), setResource: vi.fn(), setStop: vi.fn() }))
vi.mock('@renderer/store/player/state', () => ({
  isPlay: { value: false },
  playedList: [],
  tempPlayList: [],
  musicInfo: {},
  playInfo: { playerListId: 'original', playerPlayIndex: 4 },
  playMusicInfo: { musicInfo: null, listId: 'original', isTempPlay: false },
}))
vi.mock('@renderer/store/player/action', () => ({
  getList: vi.fn(),
  clearPlayedList: vi.fn(),
  clearTempPlayeList: vi.fn(),
  setPlayMusicInfo: vi.fn(),
  addPlayedList: vi.fn(),
  setMusicInfo: vi.fn(),
  setAllStatus: vi.fn(),
  removeTempPlayList: vi.fn(),
  setPlayListId: vi.fn(),
  removePlayedList: vi.fn(),
}))
vi.mock('@renderer/store/setting', () => ({ appSetting: { 'player.togglePlayMethod': 'random' } }))
vi.mock('../music/index', () => ({
  getMusicUrl: vi.fn(async() => null),
  getPicPath: vi.fn(async() => null),
  getLyricInfo: vi.fn(async() => ({ rawlrcInfo: { lyric: '' } })),
}))
vi.mock('../music/toggleWriteback', () => ({ writebackToggleMusicInfo: vi.fn(async() => {}) }))
vi.mock('./utils', () => ({ filterList: vi.fn() }))
vi.mock('@renderer/utils/message', () => ({ requestMsg: {} }))
vi.mock('@renderer/utils/index', () => ({ getRandom: vi.fn() }))
vi.mock('@renderer/store/list/action', () => ({ addListMusics: vi.fn(), removeListMusics: vi.fn() }))
vi.mock('@renderer/store/list/state', () => ({ loveList: {} }))
vi.mock('@renderer/core/dislikeList', () => ({ addDislikeInfo: vi.fn() }))

beforeEach(() => {
  vi.clearAllMocks()
  urlCache.entries.clear()
  tempPlayList.splice(0)
  playMusicInfo.alternativeMusicInfos = undefined
  vi.stubGlobal('window', {
    lx: { isPlayedStop: false },
    i18n: { t: (value: string) => value },
    app_event: { pause: vi.fn(), picUpdated: vi.fn(), lyricUpdated: vi.fn(), error: vi.fn() },
  })
  vi.mocked(setPlayMusicInfo).mockImplementation((listId, musicInfo, isTempPlay = false, alternativeMusicInfos) => {
    Object.assign(playMusicInfo, { listId, musicInfo, isTempPlay, alternativeMusicInfos })
  })
  vi.mocked(removeTempPlayList).mockImplementation(index => { tempPlayList.splice(index, 1) })
})
afterEach(async() => {
  // 排空取 URL/歌词 Promise 后再撤除播放器事件环境。
  for (let i = 0; i < 10; i++) await Promise.resolve()
  vi.unstubAllGlobals()
})
it('路径即播标记为临时播放并重新启动播放，保留原列表位置和稍后播放', () => {
  const song: LX.Music.MusicInfo = { id: 'recommended', name: 'Recommended', singer: 'Artist', source: 'wy', interval: null, meta: { songId: 'recommended', albumName: '', qualitys: [], _qualitys: {} } }
  tempPlayList.push({ listId: 'later', musicInfo: song, isTempPlay: true })
  playMusicInfoNow(song)
  expect(setPlayMusicInfo).toHaveBeenCalledWith(null, song, true, undefined)
  expect(setStop).toHaveBeenCalledOnce()
  expect(clearTempPlayeList).not.toHaveBeenCalled()
  expect(addPlayedList).not.toHaveBeenCalled()
  expect(playInfo.playerPlayIndex).toBe(4)
  expect(tempPlayList).toHaveLength(1)
})
it('下一曲消费 FIFO 队首一次，继续保持临时播放身份', async() => {
  const song: LX.Music.MusicInfo = { id: 'next', name: 'Next', singer: 'Artist', source: 'wy', interval: null, meta: { songId: 'next', albumName: '', qualitys: [], _qualitys: {} } }
  tempPlayList.push({ listId: 'later', musicInfo: song, isTempPlay: true })
  await playNext()
  expect(removeTempPlayList).toHaveBeenCalledExactlyOnceWith(0)
  expect(setPlayMusicInfo).toHaveBeenCalledWith('later', song, true, undefined, 'user')
  expect(tempPlayList).toHaveLength(0)
})

const onlineSong = (id: string, source: 'kw' | 'wy' = 'kw'): LX.Music.MusicInfoOnline => ({
  id,
  source,
  name: 'Song',
  singer: 'Artist',
  interval: null,
  meta: { songId: id, albumName: '', qualitys: [], _qualitys: {} },
})

it('播放器接受 URL 后才执行换源写回', async() => {
  const original = onlineSong('kw_original')
  const replacement = onlineSong('wy_replacement', 'wy')
  playMusicInfo.musicInfo = original
  vi.mocked(getMusicUrl).mockImplementationOnce(async({ onResolvedMusicInfo }) => {
    onResolvedMusicInfo?.(replacement)
    return 'https://example.test/music'
  })
  setMusicUrl(original)
  await vi.waitFor(() => { expect(writebackToggleMusicInfo).toHaveBeenCalledWith(original, replacement) })
  expect(vi.mocked(setResource).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(writebackToggleMusicInfo).mock.invocationCallOrder[0])
})

it('预加载换源只缓存实际身份，正式播放命中缓存后才写回列表', async() => {
  const original = onlineSong('kw_preloaded')
  const replacement = onlineSong('wy_preloaded', 'wy')
  urlCache.resolve.mockResolvedValueOnce({ url: 'cached-fallback', quality: '128k', musicInfo: replacement, isFromCache: false })
  // 与 usePreloadNextMusic 一样不传身份回调，预加载不得提交播放身份或列表写回。
  await expect(getOnlineMusicUrl({ musicInfo: original, isRefresh: false })).resolves.toBe('cached-fallback')
  expect(writebackToggleMusicInfo).not.toHaveBeenCalled()
  expect(setResource).not.toHaveBeenCalled()
  expect(original.meta.toggleMusicInfo).toBeUndefined()

  playMusicInfo.musicInfo = original
  vi.mocked(getMusicUrl).mockImplementationOnce(getOnlineMusicUrl as typeof getMusicUrl)
  setMusicUrl(original)
  await vi.waitFor(() => { expect(writebackToggleMusicInfo).toHaveBeenCalledWith(original, replacement) })
  expect(urlCache.resolve).toHaveBeenCalledOnce()
  expect(setResource).toHaveBeenCalledWith('cached-fallback')
  expect(vi.mocked(setResource).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(writebackToggleMusicInfo).mock.invocationCallOrder[0])
})

it('刷新回原提供方后，缓存不再报告旧换源身份', async() => {
  const original = onlineSong('kw_refresh')
  const replacement = onlineSong('wy_old', 'wy')
  urlCache.entries.set('kw_refresh_128k', { id: 'kw_refresh_128k', url: 'old', musicInfo: replacement })
  urlCache.resolve.mockResolvedValueOnce({ url: 'fresh', quality: '128k', musicInfo: original, isFromCache: false })
  await getOnlineMusicUrl({ musicInfo: original, isRefresh: true })
  const resolved = vi.fn()
  await expect(getOnlineMusicUrl({ musicInfo: original, isRefresh: false, onResolvedMusicInfo: resolved })).resolves.toBe('fresh')
  expect(resolved).toHaveBeenCalledExactlyOnceWith(original)
})

it('取流期间已切歌则不写回迟到结果', async() => {
  const original = onlineSong('kw_old')
  let resolveUrl!: (url: string) => void
  playMusicInfo.musicInfo = original
  vi.mocked(getMusicUrl).mockImplementationOnce(async({ onResolvedMusicInfo }) => {
    onResolvedMusicInfo?.(onlineSong('wy_old', 'wy'))
    return new Promise(resolve => { resolveUrl = resolve })
  })
  setMusicUrl(original)
  await vi.waitFor(() => { expect(resolveUrl).toBeDefined() })
  playMusicInfo.musicInfo = onlineSong('other')
  resolveUrl('https://example.test/old')
  for (let i = 0; i < 10; i++) await Promise.resolve()
  expect(setResource).not.toHaveBeenCalled()
  expect(writebackToggleMusicInfo).not.toHaveBeenCalled()
})


it('FIFO 与路径播放把备用条目交给取流，普通播放清除旧备用条目', async() => {
  const song = onlineSong('kw_with_alternative')
  const alternatives = [onlineSong('wy_alternative', 'wy')]
  vi.mocked(getMusicUrl).mockResolvedValue(null as any)
  tempPlayList.push({ listId: 'later', musicInfo: song, isTempPlay: true, alternativeMusicInfos: alternatives })
  await playNext()
  await vi.waitFor(() => { expect(getMusicUrl).toHaveBeenCalledWith(expect.objectContaining({ musicInfo: song, alternativeMusicInfos: alternatives })) })
  playMusicInfoNow(onlineSong('path'), null, alternatives)
  expect(setPlayMusicInfo).toHaveBeenLastCalledWith(null, expect.objectContaining({ id: 'path' }), true, alternatives)
  playMusicInfoNow(onlineSong('ordinary'))
  expect(playMusicInfo.alternativeMusicInfos).toBeUndefined()
})

it.each(['success', 'failure'])('旧歌曲请求%s后不能清掉其换源歌曲的新请求', async(outcome) => {
  const original = onlineSong('kw_pending')
  const replacement = onlineSong('wy_pending', 'wy')
  original.meta.toggleMusicInfo = replacement
  let resolveOld!: (url: string) => void
  let rejectOld!: (error: Error) => void
  let resolveNew!: (url: string) => void
  vi.mocked(getMusicUrl)
    .mockImplementationOnce(async() => new Promise((resolve, reject) => { resolveOld = resolve; rejectOld = reject }))
    .mockImplementationOnce(async() => new Promise(resolve => { resolveNew = resolve }))

  playMusicInfo.musicInfo = original
  setMusicUrl(original)
  await vi.waitFor(() => { expect(resolveOld).toBeDefined() })
  playMusicInfo.musicInfo = replacement
  setMusicUrl(replacement)
  await vi.waitFor(() => { expect(resolveNew).toBeDefined() })
  if (outcome === 'success') resolveOld('old-url')
  else rejectOld(new Error('old request failed'))
  for (let i = 0; i < 20; i++) await Promise.resolve()
  expect(setResource).not.toHaveBeenCalled()
  expect(window.app_event.error).not.toHaveBeenCalled()
  resolveNew('new-url')
  await vi.waitFor(() => { expect(setResource).toHaveBeenCalledExactlyOnceWith('new-url') })
  expect(getMusicUrl).toHaveBeenCalledTimes(2)
})

it('A→B→A 快速切换时相同歌曲的旧请求也不能提交结果', async() => {
  const first = onlineSong('kw_repeat')
  const middle = onlineSong('kw_middle')
  const releases: Array<(url: string) => void> = []
  vi.mocked(getMusicUrl).mockImplementation(async() => new Promise(resolve => { releases.push(resolve) }))
  for (const song of [first, middle, first]) {
    playMusicInfo.musicInfo = song
    setMusicUrl(song)
    for (let i = 0; i < 10; i++) await Promise.resolve()
  }
  expect(releases).toHaveLength(3)
  releases[0]('stale-first')
  releases[1]('stale-middle')
  for (let i = 0; i < 20; i++) await Promise.resolve()
  expect(setResource).not.toHaveBeenCalled()
  releases[2]('current-first')
  await vi.waitFor(() => { expect(setResource).toHaveBeenCalledExactlyOnceWith('current-first') })
})

it.each(['ended', 'error', 'removed'] as const)('自动切歌把 %s 原因传给播放状态', async(reason) => {
  const song = onlineSong(`next-${reason}`)
  vi.mocked(getMusicUrl).mockResolvedValue('next-url')
  tempPlayList.push({ listId: 'later', musicInfo: song, isTempPlay: true })
  await playNext(true, reason)
  expect(setPlayMusicInfo).toHaveBeenCalledWith('later', song, true, undefined, reason)
})
