import { apiSource, qualityList, userApi } from '@renderer/store'
import { appSetting, setApiSource } from '@renderer/store/setting'
import { setUserApi as setUserApiAction, setUserApiBackups as setUserApiBackupsAction } from '@renderer/utils/ipc'
import musicSdk from '@renderer/utils/musicSdk'
import apiSourceInfo from '@renderer/utils/musicSdk/api-source-info'
import { USER_API_INIT_TIMEOUT_MS } from '@common/userApi'

let prevId = ''
let switchSeq = 0
let pendingPrimaryUserApiId: string | null = null
let pendingPrimaryToken: number | null = null
export const isPendingPrimaryUserApi = (apiId: string): boolean => pendingPrimaryUserApiId === apiId

export const setUserApi = async(apiId: string) => {
  if (prevId == apiId) return
  // 切源先释放上一代等待者；新源始终拥有独立的代际令牌与初始化期限。
  if (!window.lx.apiInitPromise[1]) window.lx.apiInitPromise[2](false)
  const token = ++switchSeq
  const isCurrent = () => switchSeq === token
  prevId = apiId
  pendingPrimaryUserApiId = /^user_api/.test(apiId) ? apiId : null
  pendingPrimaryToken = pendingPrimaryUserApiId ? token : null
  const clearPendingIfCurrent = () => {
    if (pendingPrimaryToken === token) {
      pendingPrimaryUserApiId = null
      pendingPrimaryToken = null
    }
  }
  window.lx.apiInitPromise[1] = false
  window.lx.apiInitPromise[0] = new Promise<boolean>(resolve => {
    const timer = setTimeout(() => {
      if (isCurrent()) {
        userApi.message = 'init timeout'
        window.lx.apiInitPromise[2](false)
      }
    }, USER_API_INIT_TIMEOUT_MS)
    window.lx.apiInitPromise[2] = (result: boolean) => {
      clearTimeout(timer)
      resolve(result)
      if (!isCurrent()) return
      window.lx.apiInitPromise[1] = true
      // 超时后迟到的成功初始化仍可恢复后续播放。
      window.lx.apiInitPromise[0] = Promise.resolve(result)
    }
  })

  if (/^user_api/.test(apiId)) {
    qualityList.value = {}
    userApi.status = false
    userApi.message = 'initing'

    let failed = false
    await setUserApiAction(apiId).then(() => {
      clearPendingIfCurrent()
      if (!isCurrent()) return
      apiSource.value = apiId
    }).catch(err => {
      clearPendingIfCurrent()
      failed = true
      if (!isCurrent()) return
      console.log(err)
      let api = apiSourceInfo.find(api => !api.disabled)
      if (!window.lx.apiInitPromise[1]) window.lx.apiInitPromise[2](Boolean(api))
      if (!api) {
        prevId = ''
        return
      }
      prevId = api.id
      // @ts-expect-error
      qualityList.value = musicSdk.supportQuality[api.id] ?? {}
      apiSource.value = api.id
      if (api.id != appSetting['common.apiSource']) setApiSource(api.id)
    })
    if (failed) return
  } else {
    // @ts-expect-error
    qualityList.value = musicSdk.supportQuality[apiId] ?? {}
    apiSource.value = apiId
    void setUserApiAction(apiId).catch(err => { console.log(err) })
    if (!window.lx.apiInitPromise[1]) window.lx.apiInitPromise[2](true)
  }

  if (!isCurrent()) return
  if (apiId != appSetting['common.apiSource']) setApiSource(apiId)
}

/** 装载/卸载备源窗口（主源不受影响；顺序即播放取流失败时的轮换顺序） */
export const setUserApiBackups = async(apiIds: string[]) => {
  // 展开为普通数组：响应式数组（Proxy）无法被 IPC 结构化克隆
  await setUserApiBackupsAction([...apiIds]).catch(err => {
    console.log(err)
  })
}
