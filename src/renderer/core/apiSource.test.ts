import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { USER_API_INIT_TIMEOUT_MS } from '@common/userApi'
import type * as ApiSourceModule from './apiSource'

const mocks = vi.hoisted(() => ({ primary: vi.fn(), backup: vi.fn(), setUserApi: vi.fn(), setApiSource: vi.fn() }))
vi.mock('@renderer/store', () => ({
  apiSource: { value: '' },
  qualityList: { value: {} },
  userApi: { apis: { backup: { wy: { getMusicUrl: mocks.backup } } }, qualityLists: { backup: { wy: ['128k'] } } },
}))
vi.mock('@renderer/store/setting', () => ({
  appSetting: { 'common.apiSource': 'user_api_primary', 'common.apiSourceBackups': ['backup'], 'player.playQuality': '128k' }, setApiSource: mocks.setApiSource,
}))
vi.mock('@renderer/utils/musicSdk', () => ({ default: { wy: { getMusicUrl: mocks.primary }, findMusic: vi.fn() } }))
vi.mock('@renderer/utils/musicSdk/api-source-info', () => ({ default: [] }))
vi.mock('@renderer/utils/musicSdk/api-source', () => ({ apis: () => ({ getMusicUrl: mocks.backup }) }))
vi.mock('@renderer/utils', () => ({ toNewMusicInfo: (info: unknown) => info, toOldMusicInfo: (info: unknown) => info, langS2T: vi.fn() }))
vi.mock('@renderer/utils/ipc', () => ({ setUserApi: mocks.setUserApi, setUserApiBackups: async() => {}, getMusicUrl: async() => null, getPlayerLyric: vi.fn() }))

let setUserApi: typeof ApiSourceModule.setUserApi
beforeEach(async() => {
  vi.resetModules()
  vi.useFakeTimers()
  vi.clearAllMocks()
  mocks.setUserApi.mockResolvedValue(undefined)
  const store = await import('@renderer/store')
  store.apiSource.value = ''
  store.qualityList.value = {}
  vi.stubGlobal('window', { lx: { apiInitPromise: [Promise.resolve(false), true, () => {}] }, i18n: { t: (key: string) => key } })
  setUserApi = (await import('./apiSource')).setUserApi
  mocks.backup.mockReturnValue({ promise: Promise.resolve({ url: 'https://example.test/backup', type: '128k' }) })
})
afterEach(() => {
  window.lx.apiInitPromise[2](false)
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

it('主源初始化不回应时，在期限内放行已就绪备源，后续播放不重复等待', async() => {
  await setUserApi('user_api_primary')
  const { handleGetOnlineMusicUrl } = await import('./music/utils')
  const musicInfo: LX.Music.MusicInfoOnline = { id: 'wy_1', source: 'wy', name: 'Song', singer: 'Artist', interval: null, meta: { songId: '1', albumName: '', qualitys: [], _qualitys: { '128k': { size: null } } } }
  const options = {
    musicInfo,
    isRefresh: true,
    allowToggleSource: true,
    onToggleSource: vi.fn(),
  }
  const pending = handleGetOnlineMusicUrl(options)
  await vi.advanceTimersByTimeAsync(USER_API_INIT_TIMEOUT_MS)
  await expect(pending).resolves.toMatchObject({ url: 'https://example.test/backup' })
  await expect(handleGetOnlineMusicUrl(options)).resolves.toMatchObject({ url: 'https://example.test/backup' })
  expect(mocks.primary).not.toHaveBeenCalled()
  expect(mocks.backup).toHaveBeenCalledTimes(2)
})

it('超时后的迟到成功恢复后续主源请求', async() => {
  await setUserApi('user_api_primary')
  await vi.advanceTimersByTimeAsync(USER_API_INIT_TIMEOUT_MS)
  await expect(window.lx.apiInitPromise[0]).resolves.toBe(false)
  window.lx.apiInitPromise[2](true)
  await expect(window.lx.apiInitPromise[0]).resolves.toBe(true)
  expect(vi.getTimerCount()).toBe(0)
})

it('初始化期间切源释放旧等待，新源拥有独立期限且不被旧回调覆盖', async() => {
  await setUserApi('user_api_primary')
  const oldPromise = window.lx.apiInitPromise[0]
  const oldResolve = window.lx.apiInitPromise[2]
  await vi.advanceTimersByTimeAsync(USER_API_INIT_TIMEOUT_MS / 2)
  await setUserApi('user_api_next')
  await expect(oldPromise).resolves.toBe(false)
  oldResolve(true)
  await vi.advanceTimersByTimeAsync(USER_API_INIT_TIMEOUT_MS / 2)
  expect(window.lx.apiInitPromise[1]).toBe(false)
  await vi.advanceTimersByTimeAsync(USER_API_INIT_TIMEOUT_MS / 2)
  await expect(window.lx.apiInitPromise[0]).resolves.toBe(false)
})

it('setUserApi 主进程加载失败时不落入成功分支且重置 prevId 允许重试', async() => {
  const { apiSource } = await import('@renderer/store')
  mocks.setUserApi.mockRejectedValueOnce(new Error('load script failed'))
  await setUserApi('user_api_broken')

  await expect(window.lx.apiInitPromise[0]).resolves.toBe(false)
  expect(apiSource.value).toBe('')
  expect(mocks.setApiSource).not.toHaveBeenCalledWith('user_api_broken')

  // 重试同名源不会被旧 prevId 拦截
  mocks.setUserApi.mockResolvedValueOnce(undefined)
  await setUserApi('user_api_broken')
  expect(mocks.setUserApi).toHaveBeenCalledTimes(2)
  expect(apiSource.value).toBe('user_api_broken')
})
