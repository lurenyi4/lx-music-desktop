import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import names from './name'
import type * as ApiModule from './rendererEvent'

const mocks = vi.hoisted(() => ({
  windows: new Map<string, number>(),
  handlers: new Map<string, (args: any) => void>(),
  onClosed: null as ((apiId: string, reason?: string, browserWindow?: any) => void) | null,
  create: vi.fn(),
  close: vi.fn(),
  status: vi.fn(),
  send: vi.fn(),
  apis: ['user_api_primary', 'user_api_backup'].map(id => ({ id, name: id, description: '', allowShowUpdateAlert: false })),
}))
vi.mock('@common/mainIpc', () => ({
  mainOn: (name: string, handler: (args: any) => void) => mocks.handlers.set(name, handler),
}))
vi.mock('../main', () => ({
  createWindow: mocks.create,
  closeWindow: mocks.close,
  hasWindow: (id: string) => mocks.windows.has(id),
  isCurrentWindow: (id: string, browserWindow?: any) => browserWindow != null && mocks.windows.get(id) === browserWindow,
  getApiIdByWebContentsId: (id: number) => [...mocks.windows.entries()].find(([, value]) => value === id)?.[0],
  getProxy: vi.fn(),
  openDevTools: vi.fn(),
  sendEventToApi: mocks.send,
  setWindowClosedListener: (listener: ((apiId: string, reason?: string, browserWindow?: any) => void) | null) => { mocks.onClosed = listener },
}))
vi.mock('../utils', () => ({ getUserApis: () => mocks.apis }))
vi.mock('@main/modules/winMain', () => ({ sendStatusChange: mocks.status, sendShowUpdateAlert: vi.fn() }))

let api: typeof ApiModule
beforeEach(async() => {
  vi.resetModules()
  vi.useFakeTimers()
  vi.clearAllMocks()
  mocks.windows.clear()
  mocks.handlers.clear()
  mocks.create.mockImplementation(async(info: LX.UserApi.UserApiInfo) => {
    mocks.windows.set(info.id, mocks.create.mock.calls.length)
  })
  mocks.close.mockImplementation(async(id?: string) => {
    if (id == null) mocks.windows.clear()
    else mocks.windows.delete(id)
  })
  api = await import('./rendererEvent')
  api.init()
})
afterEach(async() => {
  await api.unloadAllApis()
  vi.useRealTimers()
})

const ready = (id: string) => {
  mocks.handlers.get(names.init)!({
    event: { sender: { id: mocks.windows.get(id) } },
    params: { status: true, data: { sources: {} } },
  })
}

describe('自定义音源生命周期', () => {
  it('默认 temp 状态不按不存在的自定义脚本报错', async() => {
    await expect(api.setApi('temp')).resolves.toBeUndefined()
    expect(mocks.create).not.toHaveBeenCalled()
    expect(api.getStatus().status).toBe(false)
    await expect(api.setApi('user_api_missing')).rejects.toThrow('api not found')
  })

  it('主窗口关闭后重开会重新创建主源和备源，并丢弃旧初始化状态', async() => {
    await Promise.all([api.setApi('user_api_primary'), api.setBackups(['user_api_backup'])])
    ready('user_api_primary')
    ready('user_api_backup')
    expect(api.getStatus().status).toBe(true)
    await api.unloadAllApis()
    expect(mocks.windows.size).toBe(0)
    expect(api.getStatus().status).toBe(false)
    await Promise.all([api.setApi('user_api_primary'), api.setBackups(['user_api_backup'])])
    expect(mocks.windows.size).toBe(2)
    expect(mocks.create).toHaveBeenCalledTimes(4)
    expect(api.getStatus().status).toBe(false)
    ready('user_api_primary')
    expect(api.getStatus().status).toBe(true)
  })

  it('窗口意外消失后重新配置同一源也会重建', async() => {
    await api.setApi('user_api_primary')
    ready('user_api_primary')
    mocks.windows.clear()
    await api.setApi('user_api_primary')
    expect(mocks.create).toHaveBeenCalledTimes(2)
    expect(api.getStatus().status).toBe(false)
  })

  it('创建窗口失败时也撤回已广播的就绪状态', async() => {
    mocks.create.mockImplementationOnce(async(info: LX.UserApi.UserApiInfo) => {
      mocks.windows.set(info.id, 1)
      ready(info.id)
      throw new Error('load failed')
    })
    await expect(api.setApi('user_api_primary')).rejects.toThrow('load failed')
    expect(api.getStatus().status).toBe(false)
    expect(mocks.windows.size).toBe(0)
    expect(mocks.status).toHaveBeenLastCalledWith(expect.objectContaining({
      status: false, apiInfo: expect.objectContaining({ id: 'user_api_primary' }),
    }))
  })

  it('切到默认源会卸载原主源但保留已启用备源', async() => {
    await api.setApi('user_api_primary')
    await api.setBackups(['user_api_backup'])
    await api.setApi('temp')
    expect([...mocks.windows.keys()]).toEqual(['user_api_backup'])
  })

  it('渲染窗口重载时可重新获取已初始化备源状态', async() => {
    await api.setBackups(['user_api_backup'])
    ready('user_api_backup')
    mocks.status.mockClear()
    await api.setBackups(['user_api_backup'])
    expect(mocks.create).toHaveBeenCalledOnce()
    expect(mocks.status).toHaveBeenCalledWith(expect.objectContaining({
      status: true, apiInfo: expect.objectContaining({ id: 'user_api_backup' }),
    }))
  })

  it('销毁期间的新配置等待旧窗口清理完成', async() => {
    await api.setApi('user_api_primary')
    let finishClose!: () => void
    mocks.close.mockImplementationOnce(async() => {
      await new Promise<void>(resolve => { finishClose = resolve })
      mocks.windows.clear()
    })
    const closing = api.unloadAllApis()
    await vi.waitFor(() => { expect(finishClose).toBeDefined() })
    const reopening = api.setApi('user_api_primary')
    expect(mocks.create).toHaveBeenCalledOnce()
    finishClose()
    await Promise.all([closing, reopening])
    expect(mocks.create).toHaveBeenCalledTimes(2)
    expect(mocks.windows.has('user_api_primary')).toBe(true)
  })

  it('关闭音源时取消待响应请求，避免重开后遗留超时', async() => {
    await api.setApi('user_api_primary')
    ready('user_api_primary')
    const request = api.request({ requestKey: 'pending', data: { action: 'musicUrl' } })
    const rejected = expect(request).rejects.toThrow('Cancel request')
    await api.unloadAllApis()
    await rejected
  })

  it.each(['disable', 'remove'])('单独卸载备源即时结束其请求，保留其他源请求（%s）', async(action) => {
    await api.setApi('user_api_primary')
    await api.setBackups(['user_api_backup'])
    ready('user_api_primary')
    ready('user_api_backup')
    const primarySettled = vi.fn()
    const backupRejected = vi.fn()
    const primary = api.request({ requestKey: 'primary-pending', data: { action: 'musicUrl' } }).then(primarySettled, primarySettled)
    const backup = api.request({ requestKey: 'backup-pending', data: { apiId: 'user_api_backup', action: 'musicUrl' } }).catch(backupRejected)
    if (action === 'disable') await api.setBackups([])
    else await api.unloadApi('user_api_backup')
    await Promise.resolve()

    expect(backupRejected).toHaveBeenCalledWith(expect.objectContaining({ message: 'Cancel request' }))
    expect(primarySettled).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(1)
    mocks.handlers.get(names.response)!({
      event: { sender: { id: mocks.windows.get('user_api_primary') } },
      params: { status: true, data: { requestKey: 'primary-pending', result: 'primary-url' } },
    })
    await Promise.all([primary, backup])
    expect(primarySettled).toHaveBeenCalledWith('primary-url')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('拒绝跨脚本伪造响应与未知发送方打开 DevTools', async() => {
    await api.setApi('user_api_primary')
    await api.setBackups(['user_api_backup'])
    ready('user_api_primary')
    ready('user_api_backup')
    const settled = vi.fn()
    const pending = api.request({ requestKey: 'primary-only', data: { action: 'musicUrl' } })
    void pending.then(settled)
    // 备源窗口尝试伪造主源 requestKey 响应必须被忽略
    mocks.handlers.get(names.response)!({
      event: { sender: { id: mocks.windows.get('user_api_backup') } },
      params: { status: true, data: { requestKey: 'primary-only', result: 'spoofed-url' } },
    })
    await Promise.resolve()
    expect(settled).not.toHaveBeenCalled()
    // 真实主源响应正常放行
    mocks.handlers.get(names.response)!({
      event: { sender: { id: mocks.windows.get('user_api_primary') } },
      params: { status: true, data: { requestKey: 'primary-only', result: 'real-url' } },
    })
    await expect(pending).resolves.toBe('real-url')
    expect(settled).toHaveBeenCalledWith('real-url')
    // 未知 webContentsId 不得回退打开其他窗口 DevTools
    const mainMod = await import('../main')
    mocks.handlers.get(names.openDevTools)!({ event: { sender: { id: 99999 } } })
    expect(mainMod.openDevTools).not.toHaveBeenCalled()
  })

  it('unloadApis 清理已删除的主源与备源引用，后续 setBackups 不再重载已删脚本', async() => {
    await api.setApi('user_api_primary')
    await api.setBackups(['user_api_backup'])
    await api.unloadApis(['user_api_primary'])
    const saved = mocks.apis.splice(0, 1)
    try {
      await expect(api.setBackups(['user_api_backup'])).resolves.toBeUndefined()
      expect([...mocks.windows.keys()]).toEqual(['user_api_backup'])
    } finally {
      mocks.apis.unshift(...saved)
    }
  })

  it('未显式指定 apiId 的请求也按发起时主源归属清理', async() => {
    await api.setApi('user_api_primary')
    ready('user_api_primary')
    const rejected = vi.fn()
    const pending = api.request({ requestKey: 'implicit-primary', data: { action: 'musicUrl' } }).catch(rejected)
    await api.setApi('user_api_backup')
    await Promise.resolve()
    expect(rejected).toHaveBeenCalledWith(expect.objectContaining({ message: 'Cancel request' }))
    expect(vi.getTimerCount()).toBe(0)
    await pending
    expect(api.getStatus().status).toBe(false)
    expect(mocks.windows.has('user_api_backup')).toBe(true)
  })

  it('主源切源失败时仍卸载旧主源且不阻塞后续 setBackups，unloadAllApis 即使状态推送报错仍关闭窗口', async() => {
    await api.setApi('user_api_primary')
    ready('user_api_primary')
    mocks.create.mockRejectedValueOnce(new Error('boom'))
    await expect(api.setApi('user_api_backup')).rejects.toThrow('boom')
    expect(mocks.windows.has('user_api_primary')).toBe(false)
    await expect(api.setBackups(['user_api_primary'])).resolves.toBeUndefined()
    expect(mocks.windows.has('user_api_primary')).toBe(true)

    mocks.status.mockImplementationOnce(() => { throw new Error('Object has been destroyed') })
    await expect(api.unloadAllApis()).resolves.toBeUndefined()
    expect(mocks.windows.size).toBe(0)
  })

  it('窗口异常退出或脚本加载失败回调即时清理状态并取消在途请求；旧窗口回调不误杀已重建新窗且清理坏主源', async() => {
    await api.setApi('user_api_primary')
    ready('user_api_primary')
    const currentWinToken = mocks.windows.get('user_api_primary')
    // 过期旧窗口实例的失败回调不得误杀健康新窗
    mocks.onClosed?.('user_api_primary', 'stale window error', 99999)
    await Promise.resolve()
    await Promise.resolve()
    expect(mocks.windows.get('user_api_primary')).toBe(currentWinToken)
    expect(api.getStatus().status).toBe(true)

    const rejected = vi.fn()
    const pending = api.request({ requestKey: 'crashed-req', data: { action: 'musicUrl' } }).catch(rejected)
    mocks.onClosed?.('user_api_primary', 'corrupt script', currentWinToken)
    await Promise.resolve()
    await Promise.resolve()
    await pending
    expect(rejected).toHaveBeenCalledWith(expect.objectContaining({ message: 'Cancel request' }))
    expect(api.getStatus().status).toBe(false)
    expect(mocks.status).toHaveBeenLastCalledWith(expect.objectContaining({ status: false, message: 'corrupt script' }))

    // 坏主源失败卸载后已清 primaryApiId，后续无关 setBackups 不再反复尝试重载坏主源
    const createsBefore = mocks.create.mock.calls.length
    await api.setBackups(['user_api_backup'])
    expect(mocks.create.mock.calls.slice(createsBefore).map(c => c[0].id)).toEqual(['user_api_backup'])
  })
})
