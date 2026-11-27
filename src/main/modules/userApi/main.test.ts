import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type * as ApiModule from './main'

const mocks = vi.hoisted(() => ({ windows: [] as any[], sessions: new Map<string, any>(), send: vi.fn(), getScript: vi.fn(async() => 'script'), mainProxy: vi.fn(() => null as { host: string, port: number } | null) }))
vi.mock('fs', () => ({ default: { promises: { readFile: async() => '<html></html>' } } }))
vi.mock('@common/mainIpc', () => ({ mainSend: mocks.send }))
vi.mock('@main/utils', () => ({ openDevTools: vi.fn(), getProxy: mocks.mainProxy }))
vi.mock('./utils', () => ({ getScript: mocks.getScript }))
vi.mock('electron', async() => {
  const { EventEmitter } = await import('node:events')
  return {
    BrowserWindow: class extends EventEmitter {
      destroyed = false
      contents = {
        id: mocks.windows.length + 1,
        on: vi.fn(),
        setWindowOpenHandler: vi.fn(),
        session: null as any,
      }

      constructor(options: Electron.BrowserWindowConstructorOptions) {
        super()
        const key = options.webPreferences?.partition ?? 'default'
        if (!mocks.sessions.has(key)) {
          const cookies = new Map<string, string>()
          mocks.sessions.set(key, {
            cookies,
            setPermissionCheckHandler: vi.fn(),
            setPermissionRequestHandler: vi.fn(),
            clearAuthCache: vi.fn(async() => {}),
            clearStorageData: vi.fn(async() => { cookies.clear() }),
            clearCache: vi.fn(async() => {}),
          })
        }
        this.contents.session = mocks.sessions.get(key)
        mocks.windows.push(this)
      }

      get webContents() {
        if (this.destroyed) throw new Error('Object has been destroyed')
        return this.contents
      }

      async loadURL() {
        this.emit('ready-to-show')
      }

      isDestroyed() {
        return this.destroyed
      }

      destroy() {
        this.destroyed = true
        this.emit('closed')
      }
    },
  }
})

let api: typeof ApiModule
let events: EventEmitter
beforeEach(async() => {
  vi.resetModules()
  vi.clearAllMocks()
  mocks.windows.splice(0)
  mocks.sessions.clear()
  events = new EventEmitter()
  vi.stubGlobal('lx', { appSetting: {}, event_app: events })
  vi.stubGlobal('envParams', { cmdParams: {} })
  vi.stubGlobal('webpackUserApiPath', '/tmp/lx-test-user-api')
  api = await import('./main')
})
afterEach(async() => {
  await api.closeWindow()
  vi.unstubAllGlobals()
})

const info = (id: string): LX.UserApi.UserApiInfo => ({ id, name: id, description: '', allowShowUpdateAlert: false })

it('窗口销毁后不再读取 webContents，映射与代理订阅随最后一个窗口释放', async() => {
  await api.createWindow(info('primary'))
  await api.createWindow(info('backup'))
  const id = mocks.windows[0].webContents.id
  expect(api.getApiIdByWebContentsId(id)).toBe('primary')
  expect(events.listenerCount('updated_config')).toBe(1)
  await expect(api.closeWindow('primary')).resolves.toBeUndefined()
  expect(api.getApiIdByWebContentsId(id)).toBeUndefined()
  expect(api.hasWindow('backup')).toBe(true)
  expect(events.listenerCount('updated_config')).toBe(1)
  await expect(api.closeWindow()).resolves.toBeUndefined()
  expect(events.listenerCount('updated_config')).toBe(0)
})

it('反复装载卸载音源不累积代理监听器，初始化不遗漏早到的 ready-to-show', async() => {
  for (let i = 0; i < 3; i++) {
    await api.createWindow(info('primary'))
    expect(events.listenerCount('updated_config')).toBe(1)
    await api.closeWindow('primary')
    expect(events.listenerCount('updated_config')).toBe(0)
  }
  expect(mocks.send).toHaveBeenCalledTimes(3)
})


it('各音源隔离 Session，权限检查和申请均拒绝，卸载不清除其他源存储', async() => {
  await api.createWindow(info('primary'))
  await api.createWindow(info('backup'))
  const primary = mocks.windows[0].webContents.session
  const backup = mocks.windows[1].webContents.session
  expect(primary).not.toBe(backup)
  expect(mocks.sessions.has('default')).toBe(false)
  backup.cookies.set('auth', 'kept')
  for (const session of [primary, backup]) {
    expect(session.setPermissionCheckHandler.mock.calls[0][0]()).toBe(false)
    const resolve = vi.fn()
    session.setPermissionRequestHandler.mock.calls[0][0](mocks.windows[0].webContents, 'notifications', resolve)
    expect(resolve).toHaveBeenCalledWith(false)
  }
  await api.closeWindow('primary')
  expect(backup.cookies.get('auth')).toBe('kept')
  expect(backup.clearStorageData).not.toHaveBeenCalled()
})

it('清理缓存失败或窗口已提前销毁时 closeWindow 记录失败原因并仍销毁剩余窗口', async() => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  await api.createWindow(info('primary'))
  await api.createWindow(info('backup'))
  mocks.windows[0].webContents.session.clearCache.mockRejectedValueOnce(new Error('cache busy'))
  mocks.windows[1].destroyed = true
  await expect(api.closeWindow()).resolves.toBeUndefined()
  expect(mocks.windows[0].destroyed).toBe(true)
  expect(mocks.windows[1].destroyed).toBe(true)
  expect(warn).toHaveBeenCalledWith('[userApi] primary clearCache failed:', expect.any(Error))
  warn.mockRestore()
})

it('ready-to-show 中读取脚本失败时吞并记录并关闭僵尸窗口以便后续重建', async() => {
  mocks.getScript.mockRejectedValueOnce(new Error('corrupt script'))
  await expect(api.createWindow(info('broken'))).resolves.toBeUndefined()
  await Promise.resolve()
  await Promise.resolve()
  expect(mocks.send).not.toHaveBeenCalled()
  expect(api.hasWindow('broken')).toBe(false)
})

it('getProxy 复用主进程规范化代理，broadcastEvent/sendEventToApi 跳过已销毁窗口', async() => {
  mocks.mainProxy.mockReturnValueOnce({ host: '::1', port: 7890 })
  expect(api.getProxy()).toEqual({ host: '::1', port: '7890' })
  mocks.mainProxy.mockReturnValueOnce(null)
  expect(api.getProxy()).toEqual({ host: '', port: '' })

  await api.createWindow(info('primary'))
  await api.createWindow(info('backup'))
  mocks.send.mockClear()
  mocks.windows[0].destroyed = true
  expect(() => { api.broadcastEvent('proxyUpdate', { host: '127.0.0.1', port: '7890' }) }).not.toThrow()
  expect(mocks.send).toHaveBeenCalledTimes(1)
  expect(mocks.send).toHaveBeenCalledWith(mocks.windows[1], 'proxyUpdate', { host: '127.0.0.1', port: '7890' })
})
