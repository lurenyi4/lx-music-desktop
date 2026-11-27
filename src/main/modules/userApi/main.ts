import { mainSend } from '@common/mainIpc'
import { BrowserWindow } from 'electron'
import fs from 'fs'
import path from 'node:path'
import { getProxy as getMainProxy, openDevTools as handleOpenDevTools } from '@main/utils'
import USER_API_RENDERER_EVENT_NAME from './rendererEvent/name'
import { getScript } from './utils'

/** 已加载音源的窗口注册表：apiId -> 隐藏窗口（多活音源，一源一窗，脚本彼此隔离） */
const windows = new Map<string, Electron.BrowserWindow>()
/** 窗口 webContents id -> apiId（用于窗口→主进程事件按来源路由） */
const webContentsApiMap = new Map<number, string>()
let windowClosedListener: ((apiId: string, reason?: string, browserWindow?: Electron.BrowserWindow) => void) | null = null

export const setWindowClosedListener = (listener: ((apiId: string, reason?: string, browserWindow?: Electron.BrowserWindow) => void) | null) => {
  windowClosedListener = listener
}

let html: string | null = null
let dir: string | null = null

const denyEvents = [
  'will-navigate',
  'will-redirect',
  'will-attach-webview',
  'will-prevent-unload',
  'media-started-playing',
] as const


export const getProxy = () => {
  const resolved = getMainProxy()
  if (resolved) {
    return {
      host: resolved.host,
      port: String(resolved.port),
    }
  }
  return {
    host: '',
    port: '',
  }
}
const handleUpdateProxy = (keys: Array<keyof LX.AppSetting>) => {
  if (keys.includes('network.proxy.enable') || (global.lx.appSetting['network.proxy.enable'] && keys.some(k => k.startsWith('network.proxy.')))) {
    broadcastEvent(USER_API_RENDERER_EVENT_NAME.proxyUpdate, getProxy())
  }
}

const winEvent = (apiId: string, browserWindow: Electron.BrowserWindow) => {
  const webContentsId = browserWindow.webContents.id
  browserWindow.on('closed', () => {
    const unexpected = windows.get(apiId) === browserWindow
    if (unexpected) windows.delete(apiId)
    webContentsApiMap.delete(webContentsId)
    if (!windows.size) global.lx.event_app.off('updated_config', handleUpdateProxy)
    if (unexpected) windowClosedListener?.(apiId, undefined, browserWindow)
  })
}

export const createWindow = async(userApi: LX.UserApi.UserApiInfo) => {
  await closeWindow(userApi.id)
  dir ??= process.env.NODE_ENV !== 'production' ? webpackUserApiPath : path.join(__dirname, 'userApi')

  if (!html) {
    // eslint-disable-next-line require-atomic-updates
    html = await fs.promises.readFile(path.join(dir, 'renderer/user-api.html'), 'utf8')
  }
  const preloadUrl = process.env.NODE_ENV !== 'production'
    ? `${path.join(__dirname, '../dist/user-api-preload.js')}`
    : `${path.join(__dirname, 'user-api-preload.js')}`
  // console.log(preloadUrl)

  /**
   * Initial window options
   */
  const browserWindow = new BrowserWindow({
    // enableRemoteModule: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    roundedCorners: false,
    hasShadow: false,
    show: false,
    webPreferences: {
      partition: `user-api-${userApi.id}`,
      contextIsolation: true,
      // worldSafeExecuteJavaScript: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      sandbox: false,

      spellcheck: false,
      autoplayPolicy: 'document-user-activation-required',
      enableWebSQL: false,
      disableDialogs: true,
      // nativeWindowOpen: false,
      webgl: false,
      images: false,

      preload: preloadUrl,
    },
  })

  for (const eventName of denyEvents) {
    // @ts-expect-error
    browserWindow.webContents.on(eventName, (event: Electron.Event) => {
      event.preventDefault()
    })
  }
  browserWindow.webContents.session.setPermissionCheckHandler(() => false)
  browserWindow.webContents.session.setPermissionRequestHandler((_webContents, _permission, resolve) => {
    resolve(false)
  })
  browserWindow.webContents.setWindowOpenHandler(() => {
    return { action: 'deny' }
  })

  if (!windows.size) global.lx.event_app.on('updated_config', handleUpdateProxy)
  windows.set(userApi.id, browserWindow)
  webContentsApiMap.set(browserWindow.webContents.id, userApi.id)
  winEvent(userApi.id, browserWindow)

  // console.log(html.replace('</body>', `<script>${userApi.script}</script></body>`))
  // const randomNum = Math.random().toString().substring(2, 10)
  browserWindow.once('ready-to-show', async() => {
    try {
      const script = await getScript(userApi.id)
      if (windows.get(userApi.id) !== browserWindow || browserWindow.isDestroyed()) return
      sendEventToApi(userApi.id, USER_API_RENDERER_EVENT_NAME.initEnv, { ...userApi, script, proxy: getProxy() })
    } catch (err) {
      console.log(err)
      if (windows.get(userApi.id) === browserWindow) {
        const message = err instanceof Error ? err.message : String(err)
        if (windowClosedListener) {
          windowClosedListener(userApi.id, message, browserWindow)
        } else {
          void closeWindow(userApi.id, browserWindow).catch(closeErr => { console.log(closeErr) })
        }
      }
    }
  })
  await browserWindow.loadURL('data:text/html;charset=UTF-8,' + encodeURIComponent(html))

  // global.modules.userApiWindow.loadFile(join(dir, 'renderer/user-api.html'))
  // global.modules.userApiWindow.webContents.openDevTools()
}

const SESSION_CLEAR_OPS = [
  ['clearAuthCache', async(ses: Electron.Session) => ses.clearAuthCache()],
  ['clearStorageData', async(ses: Electron.Session) => ses.clearStorageData()],
  ['clearCache', async(ses: Electron.Session) => ses.clearCache()],
] as const

const clearWindowSession = async(apiId: string, browserWindow: Electron.BrowserWindow) => {
  if (browserWindow.isDestroyed()) return
  const ses = browserWindow.webContents.session
  const results = await Promise.allSettled(SESSION_CLEAR_OPS.map(async([, fn]) => fn(ses)))
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      console.warn(`[userApi] ${apiId} ${SESSION_CLEAR_OPS[index][0]} failed:`, result.reason)
    }
  })
}

export const closeWindow = async(apiId?: string, expectedWindow?: Electron.BrowserWindow) => {
  if (apiId == null) {
    global.lx.event_app.off('updated_config', handleUpdateProxy)
    if (!windows.size) return
    const allEntries = [...windows.entries()]
    windows.clear()
    webContentsApiMap.clear()
    try {
      await Promise.allSettled(allEntries.map(async([id, browserWindow]) => clearWindowSession(id, browserWindow)))
    } finally {
      for (const [, browserWindow] of allEntries) {
        if (!browserWindow.isDestroyed()) browserWindow.destroy()
      }
    }
    return
  }
  const browserWindow = windows.get(apiId)
  if (!browserWindow || (expectedWindow && browserWindow !== expectedWindow)) return
  windows.delete(apiId)
  if (!browserWindow.isDestroyed()) {
    webContentsApiMap.delete(browserWindow.webContents.id)
  } else {
    for (const [wcId, mappedApiId] of webContentsApiMap) {
      if (mappedApiId === apiId) webContentsApiMap.delete(wcId)
    }
  }
  if (!windows.size) global.lx.event_app.off('updated_config', handleUpdateProxy)
  try {
    await clearWindowSession(apiId, browserWindow)
  } finally {
    if (!browserWindow.isDestroyed()) browserWindow.destroy()
  }
}

export const hasWindow = (apiId: string): boolean => windows.has(apiId)

export const isCurrentWindow = (apiId: string, browserWindow?: Electron.BrowserWindow): boolean =>
  browserWindow != null && windows.get(apiId) === browserWindow

export const getApiIdByWebContentsId = (webContentsId: number): string | undefined => webContentsApiMap.get(webContentsId)

export const sendEventToApi = <T = any>(apiId: string, name: string, params?: T) => {
  const browserWindow = windows.get(apiId)
  if (!browserWindow || browserWindow.isDestroyed()) return
  mainSend(browserWindow, name, params)
}

export const broadcastEvent = <T = any>(name: string, params?: T) => {
  for (const browserWindow of windows.values()) {
    if (browserWindow.isDestroyed()) continue
    mainSend(browserWindow, name, params)
  }
}

export const openDevTools = (apiId?: string) => {
  const browserWindow = apiId == null ? [...windows.values()][0] : windows.get(apiId)
  if (!browserWindow || browserWindow.isDestroyed()) return
  handleOpenDevTools(browserWindow.webContents)
}
