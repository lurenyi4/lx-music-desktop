import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as MainApi from '../src/main/modules/userApi/rendererEvent/rendererEvent'
import type * as RendererApi from '../src/renderer/core/apiSource'
import type * as Capabilities from '../src/renderer/core/music/sourceCapabilities'
import names from '../src/main/modules/userApi/rendererEvent/name'

// 联测真实主进程生命周期、渲染层状态处理与播放能力；窗口和 IPC 使用内存替身。
const mocks = vi.hoisted(() => {
  const qualityList: { value: LX.QualityList } = { value: {} }
  const apiHandlers: Record<string, any> = {}
  const qualityLists: Record<string, LX.QualityList> = {}
  return {
    windows: new Map<string, number>(),
    handlers: new Map<string, (args: any) => void>(),
    statusListener: null as ((args: any) => void) | null,
    windowClosedListener: null as ((apiId: string, reason?: string, browserWindow?: any) => void) | null,
    create: vi.fn(),
    send: vi.fn(),
    request: vi.fn(),
    setApi: vi.fn(),
    setBackups: vi.fn(),
    cancel: vi.fn(),
    dialog: vi.fn(),
    appSetting: { 'common.apiSource': 'user_api_primary', 'common.apiSourceBackups': [] as string[] },
    store: {
      apiSource: { value: '' },
      qualityList,
      userApi: {
        list: [] as LX.UserApi.UserApiInfo[],
        apis: apiHandlers,
        qualityLists,
        status: false,
        message: undefined as string | undefined,
      },
    },
    apis: ['user_api_primary', 'user_api_backup'].map(id => ({ id, name: id, description: '', allowShowUpdateAlert: false })),
  }
})

vi.mock('@common/mainIpc', () => ({ mainOn: (name: string, handler: (args: any) => void) => mocks.handlers.set(name, handler) }))
vi.mock('@main/modules/userApi/main', () => ({
  createWindow: mocks.create,
  closeWindow: async(id?: string) => {
    if (id == null) mocks.windows.clear()
    else mocks.windows.delete(id)
  },
  hasWindow: (id: string) => mocks.windows.has(id),
  isCurrentWindow: (id: string, browserWindow?: any) => browserWindow != null && mocks.windows.get(id) === browserWindow,
  getApiIdByWebContentsId: (id: number) => [...mocks.windows].find(([, value]) => value === id)?.[0],
  sendEventToApi: mocks.send,
  getProxy: vi.fn(),
  openDevTools: vi.fn(),
  setWindowClosedListener: (listener: (apiId: string, reason?: string, browserWindow?: any) => void) => {
    mocks.windowClosedListener = listener
  },
}))
vi.mock('@main/modules/userApi/utils', () => ({ getUserApis: () => mocks.apis }))
vi.mock('@main/modules/winMain', () => ({
  sendStatusChange: (params: LX.UserApi.UserApiStatus) => mocks.statusListener?.({ params }),
  sendShowUpdateAlert: vi.fn(),
}))
vi.mock('@common/utils/vueTools', () => ({ onBeforeUnmount: vi.fn(), watch: () => vi.fn() }))
vi.mock('@common/utils/electron', () => ({ openUrl: vi.fn() }))
vi.mock('@renderer/plugins/i18n', () => ({ useI18n: () => (key: string) => key }))
vi.mock('@renderer/plugins/Dialog', () => ({ dialog: mocks.dialog }))
vi.mock('@renderer/store', () => mocks.store)
vi.mock('@renderer/store/setting', () => ({ appSetting: mocks.appSetting, setApiSource: vi.fn() }))
vi.mock('@renderer/utils/musicSdk', () => ({ default: { supportQuality: { temp: {} } } }))
vi.mock('@renderer/utils/musicSdk/api-source-info', () => ({ default: [] }))
vi.mock('@renderer/utils/ipc', () => ({
  onUserApiStatus: (listener: (args: any) => void) => {
    mocks.statusListener = listener
    return () => { mocks.statusListener = null }
  },
  onShowUserApiUpdateAlert: () => vi.fn(),
  getUserApiList: async() => mocks.apis,
  sendUserApiRequest: mocks.request,
  userApiRequestCancel: mocks.cancel,
  setUserApi: mocks.setApi,
  setUserApiBackups: mocks.setBackups,
}))

let api: typeof MainApi
let renderer: typeof RendererApi
let capabilities: typeof Capabilities
beforeEach(async() => {
  vi.resetModules()
  vi.clearAllMocks()
  vi.useFakeTimers()
  mocks.windows.clear()
  mocks.handlers.clear()
  mocks.statusListener = null
  mocks.windowClosedListener = null
  mocks.appSetting['common.apiSource'] = 'user_api_primary'
  mocks.appSetting['common.apiSourceBackups'] = []
  mocks.store.apiSource.value = ''
  mocks.store.qualityList.value = {}
  Object.assign(mocks.store.userApi, { apis: {}, qualityLists: {}, status: false, message: undefined })
  mocks.create.mockImplementation(async(info: LX.UserApi.UserApiInfo) => {
    mocks.windows.set(info.id, mocks.create.mock.calls.length)
  })
  vi.stubGlobal('window', { lx: { apiInitPromise: [Promise.resolve(false), true, () => {}] } })
  api = await import('../src/main/modules/userApi/rendererEvent/rendererEvent')
  api.init()
  mocks.setApi.mockImplementation(api.setApi)
  mocks.setBackups.mockImplementation(api.setBackups)
  mocks.request.mockImplementation(api.request)
  mocks.cancel.mockImplementation(api.cancelRequest)
  renderer = await import('../src/renderer/core/apiSource')
  capabilities = await import('../src/renderer/core/music/sourceCapabilities')
  const { default: useInitUserApi } = await import('../src/renderer/core/useApp/useInitUserApi')
  useInitUserApi()
})
afterEach(async() => {
  await api.unloadAllApis()
  window.lx.apiInitPromise[2](false)
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const ready = (id: string, provider = id === 'user_api_primary' ? 'kw' : 'wy', senderId = mocks.windows.get(id)) => {
  mocks.handlers.get(names.init)!({
    event: { sender: { id: senderId } },
    params: { status: true, data: { sources: { [provider]: { type: 'music', actions: ['musicUrl'], qualitys: ['128k'] } } } },
  })
}
const enableBackup = async(enabled: boolean) => {
  mocks.appSetting['common.apiSourceBackups'] = enabled ? ['user_api_backup'] : []
  await renderer.setUserApiBackups(mocks.appSetting['common.apiSourceBackups'])
}
const startReadyApis = async() => {
  await renderer.setUserApi('user_api_primary')
  ready('user_api_primary')
  await enableBackup(true)
  ready('user_api_backup')
}
const resolveRequest = (requestKey: string, apiId = 'user_api_primary') => {
  mocks.handlers.get(names.response)!({
    event: { sender: { id: mocks.windows.get(apiId) } },
    params: { status: true, data: { requestKey, result: { data: { url: 'ready-url' } } } },
  })
}

describe('音源就绪状态跨进程同步', () => {
  it('首次主源装载保留初始化等待，初始化前请求立即拒绝且不创建请求超时', async() => {
    await renderer.setUserApi('user_api_primary')
    const settled = vi.fn()
    void window.lx.apiInitPromise[0].then(settled)
    await expect(api.request({ requestKey: 'too-early', data: {} })).rejects.toThrow('not initialized')
    expect(settled).not.toHaveBeenCalled()
    expect(mocks.send).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(1) // 仅主源初始化期限，没有 20 秒请求超时

    ready('user_api_primary')
    await expect(window.lx.apiInitPromise[0]).resolves.toBe(true)
    expect(capabilities.assertPlaybackSupport('kw')).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
    const pending = api.request({ requestKey: 'ready-primary', data: {} })
    resolveRequest('ready-primary')
    await expect(pending).resolves.toEqual({ data: { url: 'ready-url' } })
  })

  it.each(['disable', 'remove'])('备源卸载清理处理器与能力，重新启用直到新 init 才可取流（%s）', async(action) => {
    await startReadyApis()
    const staleHandler = mocks.store.userApi.apis.user_api_backup.wy.getMusicUrl
    expect(capabilities.assertPlaybackSupport('wy')).toBe(true)
    if (action === 'disable') await enableBackup(false)
    else await api.unloadApi('user_api_backup')
    expect(mocks.store.userApi.apis.user_api_backup).toBeUndefined()
    expect(mocks.store.userApi.qualityLists.user_api_backup).toBeUndefined()
    expect(capabilities.assertPlaybackSupport('wy')).toBe(false)
    expect(capabilities.assertPlaybackSupport('kw')).toBe(true)

    await enableBackup(true)
    expect(capabilities.sourceRotationEnv().readyApiIds).toEqual(['user_api_primary'])
    expect(capabilities.assertPlaybackSupport('wy')).toBe(false)
    await expect(staleHandler({}, '128k').promise).rejects.toThrow('not initialized')
    expect(mocks.send).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)

    ready('user_api_backup')
    expect(capabilities.assertPlaybackSupport('wy')).toBe(true)
    const pending = mocks.store.userApi.apis.user_api_backup.wy.getMusicUrl({}, '128k').promise
    const [apiId, event, { requestKey }] = mocks.send.mock.calls[0]
    expect([apiId, event]).toEqual(['user_api_backup', names.request])
    resolveRequest(requestKey, apiId)
    await expect(pending).resolves.toEqual({ type: '128k', url: 'ready-url' })
    expect(vi.getTimerCount()).toBe(0)
    expect(mocks.dialog).not.toHaveBeenCalled()
  })

  it('重建意外丢失的备源窗口清除旧就绪状态，旧窗口 init 不可恢复能力', async() => {
    await startReadyApis()
    const oldSenderId = mocks.windows.get('user_api_backup')
    mocks.windows.delete('user_api_backup')
    await enableBackup(true)
    expect(mocks.store.userApi.apis.user_api_backup).toBeUndefined()
    expect(capabilities.assertPlaybackSupport('wy')).toBe(false)
    await expect(api.request({ requestKey: 'reload-early', data: { apiId: 'user_api_backup' } })).rejects.toThrow('not initialized')
    expect(mocks.send).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
    ready('user_api_backup', 'wy', oldSenderId)
    expect(capabilities.assertPlaybackSupport('wy')).toBe(false)
    ready('user_api_backup')
    expect(capabilities.assertPlaybackSupport('wy')).toBe(true)
  })

  it('全部卸载同时清除主备能力，并释放主源就绪状态', async() => {
    await startReadyApis()
    await api.unloadAllApis()
    expect(mocks.store.userApi.apis).toEqual({})
    expect(mocks.store.userApi.qualityLists).toEqual({})
    expect(mocks.store.qualityList.value).toEqual({})
    expect(mocks.store.userApi.status).toBe(false)
    expect(capabilities.assertPlaybackSupport('kw')).toBe(false)
    expect(capabilities.assertPlaybackSupport('wy')).toBe(false)
    await expect(window.lx.apiInitPromise[0]).resolves.toBe(false)
  })

  it('就绪备源升主源沿用窗口和能力，保留为备源时也不重新初始化', async() => {
    await startReadyApis()
    mocks.appSetting['common.apiSource'] = 'user_api_backup'
    await renderer.setUserApi('user_api_backup')
    await expect(window.lx.apiInitPromise[0]).resolves.toBe(true)
    expect(mocks.store.qualityList.value).toEqual({ wy: ['128k'] })
    expect(capabilities.assertPlaybackSupport('wy')).toBe(true)
    expect(mocks.create).toHaveBeenCalledTimes(2)

    mocks.appSetting['common.apiSource'] = 'temp'
    await renderer.setUserApi('temp')
    expect(mocks.windows.has('user_api_backup')).toBe(true)
    expect(capabilities.assertPlaybackSupport('wy')).toBe(true)
    const pending = api.request({ requestKey: 'demoted-backup', data: { apiId: 'user_api_backup' } })
    resolveRequest('demoted-backup', 'user_api_backup')
    await expect(pending).resolves.toEqual({ data: { url: 'ready-url' } })
    expect(mocks.create).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('初始化失败后仍拒绝请求，迟到成功可恢复该源', async() => {
    await startReadyApis()
    mocks.handlers.get(names.init)!({
      event: { sender: { id: mocks.windows.get('user_api_backup') } },
      params: { status: false, message: 'init failed', data: {} },
    })
    expect(capabilities.assertPlaybackSupport('wy')).toBe(false)
    await expect(api.request({ requestKey: 'failed-backup', data: { apiId: 'user_api_backup' } })).rejects.toThrow('not initialized')
    expect(mocks.send).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
    ready('user_api_backup')
    expect(capabilities.assertPlaybackSupport('wy')).toBe(true)
  })

  it('主源窗口意外关闭时清理就绪状态并拒绝后续请求', async() => {
    await startReadyApis()
    expect(mocks.store.apiSource.value).toBe('user_api_primary')
    expect(capabilities.assertPlaybackSupport('kw')).toBe(true)

    mocks.windowClosedListener?.('user_api_primary', 'User API window closed unexpectedly')
    await vi.advanceTimersByTimeAsync(0)

    expect(mocks.store.userApi.status).toBe(false)
    expect(capabilities.assertPlaybackSupport('kw')).toBe(false)
    await expect(api.request({ requestKey: 'after-crash', data: {} })).rejects.toThrow('user api is not load')
  })

  it('主源就绪同步更新 apiSource，且切源在途中的旧卸载通知不提前判死新主源', async() => {
    await renderer.setUserApi('user_api_primary')
    ready('user_api_primary')
    expect(mocks.store.apiSource.value).toBe('user_api_primary')

    // 模拟在途切源到 user_api_backup，尚未完成时收到无 message（undefined）的静默卸载通知不应提前 resolve(false)
    let resolveSetApi!: () => void
    mocks.setApi.mockImplementationOnce(async() => new Promise<void>(resolve => { resolveSetApi = resolve }))
    mocks.appSetting['common.apiSource'] = 'user_api_backup'
    const switching = renderer.setUserApi('user_api_backup')
    const settled = vi.fn()
    void window.lx.apiInitPromise[0].then(settled)

    mocks.statusListener?.({
      params: {
        status: false,
        message: undefined,
        apiInfo: mocks.apis[1],
      },
    })
    await Promise.resolve()
    expect(settled).not.toHaveBeenCalled()

    // 真实 init 失败即使 message 为空字符串 '' 也必须立即 resolve(false)，不等待 10s 超时
    mocks.statusListener?.({
      params: {
        status: false,
        message: '',
        apiInfo: mocks.apis[1],
      },
    })
    await Promise.resolve()
    expect(settled).toHaveBeenCalledWith(false)

    resolveSetApi()
    await switching
    await api.setApi('user_api_backup')
    ready('user_api_backup')
    await expect(window.lx.apiInitPromise[0]).resolves.toBe(true)
    expect(mocks.store.apiSource.value).toBe('user_api_backup')
  })

  it('快速 A→B→A 切源时旧 A 回调不清除新 A 的 pending 代际也不毒化新 A 的 init promise', async() => {
    let resolveFirstA!: () => void
    let resolveB!: () => void
    let resolveSecondA!: () => void
    mocks.setApi
      .mockImplementationOnce(async() => new Promise<void>(resolve => { resolveFirstA = resolve }))
      .mockImplementationOnce(async() => new Promise<void>(resolve => { resolveB = resolve }))
      .mockImplementationOnce(async() => new Promise<void>(resolve => { resolveSecondA = resolve }))

    mocks.appSetting['common.apiSource'] = 'user_api_primary'
    const pA1 = renderer.setUserApi('user_api_primary')
    mocks.appSetting['common.apiSource'] = 'user_api_backup'
    const pB = renderer.setUserApi('user_api_backup')
    mocks.appSetting['common.apiSource'] = 'user_api_primary'
    const pA2 = renderer.setUserApi('user_api_primary')

    const settledA2 = vi.fn()
    void window.lx.apiInitPromise[0].then(settledA2)

    // 第一次 A 提前 resolve，不得清除第三次 A 的 pendingPrimary 保护
    resolveFirstA()
    await pA1
    // 随后 B 卸载旧 A 发来无 message 的静默卸载通知，不得判死第三次 A
    mocks.statusListener?.({
      params: { status: false, message: undefined, apiInfo: mocks.apis[0] },
    })
    await Promise.resolve()
    expect(settledA2).not.toHaveBeenCalled()

    resolveB()
    await pB
    resolveSecondA()
    await pA2
    await api.setApi('user_api_primary')
    ready('user_api_primary')
    await expect(window.lx.apiInitPromise[0]).resolves.toBe(true)
  })
})
