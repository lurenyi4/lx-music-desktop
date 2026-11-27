import { afterEach, expect, it, vi } from 'vitest'
import { isReactive, reactive } from 'vue'

// 联测渲染层 IPC、主进程路由和缓存序列化，仅替换 IPC 传输与数据库读写。
const mocks = vi.hoisted(() => ({
  rows: new Map<string, string>(),
  handlers: new Map<string, (args: { params: unknown }) => Promise<unknown>>(),
}))
vi.mock('@common/mainIpc', () => ({
  mainHandle: (name: string, handler: (args: { params: unknown }) => Promise<unknown>) => { mocks.handlers.set(name, handler) },
}))
vi.mock('@common/rendererIpc', () => ({
  rendererInvoke: async(name: string, params: unknown) => structuredClone(await mocks.handlers.get(name)!({ params: structuredClone(params) })),
}))
vi.mock('@main/worker/dbService/modules/music_url/dbHelper', () => ({
  queryMusicUrl: (id: string) => mocks.rows.get(id) ?? null,
  insertMusicUrl: (items: LX.Music.MusicUrlInfo[]) => {
    for (const { id, url } of items) mocks.rows.set(id, url)
  },
  clearMusicUrl: () => { mocks.rows.clear() },
}))
afterEach(() => { vi.unstubAllGlobals() })

it.each([false, true])('缓存 IPC 往返保留换源身份，URL-only 读取和清缓存仍可用（推荐路径代理=%s）', async(fromReactivePath) => {
  const dbService = await import('../src/main/worker/dbService/modules/music_url')
  vi.stubGlobal('lx', { worker: { dbService } })
  const { default: registerMusicIpc } = await import('../src/main/modules/winMain/rendererEvent/music')
  registerMusicIpc()
  const ipc = await import('../src/renderer/utils/ipc')
  const original: LX.Music.MusicInfoOnline = {
    id: 'kw_original',
    source: 'kw',
    name: 'Song',
    singer: 'Artist',
    interval: null,
    meta: { songId: 'original', albumName: '', qualitys: [], _qualitys: {} },
  }
  const resolved: LX.Music.MusicInfoOnline = { ...original, id: 'wy_resolved', source: 'wy' }
  // session 的深响应式路径在取出备用条目时返回 Vue Proxy，Electron IPC 不能直接克隆。
  const session = reactive({ path: [{ alternativeMusicInfos: [resolved] }] })
  const alternative = fromReactivePath ? session.path[0].alternativeMusicInfos[0] : resolved
  expect(isReactive(alternative)).toBe(fromReactivePath)
  await ipc.saveMusicUrl(original, '128k', 'cached-fallback', alternative)
  expect(await ipc.getMusicUrlInfo(original, '128k')).toEqual({ id: 'kw_original_128k', url: 'cached-fallback', musicInfo: resolved })
  expect(await ipc.getMusicUrl(original, '128k')).toBe('cached-fallback')
  await ipc.clearMusicUrl()
  expect(await ipc.getMusicUrlInfo(original, '128k')).toBeNull()
  expect(await ipc.getMusicUrl(original, '128k')).toBe('')
})
