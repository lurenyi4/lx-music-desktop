import { markRaw } from '@common/utils/vueTools'
import music from '@renderer/utils/musicSdk'
import { deduplicationList, toNewMusicInfo } from '@renderer/utils'
import { sortInsert, similar } from '@common/utils/common'

import { sources, maxPages, listInfos } from './state'

interface SearchResult {
  list: LX.Music.MusicInfo[]
  allPage: number
  limit: number
  total: number
  source: LX.OnlineSource
}


/**
 * 按搜索关键词重新排序列表
 * @param list 歌曲列表
 * @param keyword 搜索关键词
 * @returns 排序后的列表
 */
const handleSortList = (list: LX.Music.MusicInfo[], keyword: string) => {
  let arr: any[] = []
  for (const item of list) {
    sortInsert(arr, {
      num: similar(keyword, `${item.name} ${item.singer}`),
      data: item,
    })
  }
  return arr.map(item => item.data).reverse()
}


const setLists = (results: SearchResult[], page: number, text: string): LX.Music.MusicInfo[] => {
  let pages = []
  let totals = []
  let limit = 0
  let list = []
  for (const source of results) {
    maxPages[source.source] = source.allPage
    limit = Math.max(source.limit, limit)
    if (source.allPage < page) continue
    list.push(...source.list)
    pages.push(source.allPage)
    totals.push(source.total)
  }
  list = deduplicationList(list.map(s => markRaw(toNewMusicInfo(s))))
  let listInfo = listInfos.all
  listInfo.maxPage = Math.max(0, ...pages)
  const total = Math.max(0, ...totals)
  if (page == 1 || (total && list.length)) listInfo.total = total
  else listInfo.total = limit * page
  // listInfo.limit = limit
  listInfo.page = page
  listInfo.list = handleSortList(list, text)
  if (text && !list.length && page == 1) listInfo.noItemLabel = window.i18n.t('no_item')
  else listInfo.noItemLabel = ''
  return listInfo.list
}

const setList = (datas: SearchResult, page: number, text: string): LX.Music.MusicInfo[] => {
  // console.log(datas.source, datas.list)
  let listInfo = listInfos[datas.source]!
  listInfo.list = deduplicationList(datas.list.map(s => markRaw(toNewMusicInfo(s))))
  if (page == 1 || (datas.total && datas.list.length)) listInfo.total = datas.total
  else listInfo.total = datas.limit * page
  listInfo.maxPage = datas.allPage
  listInfo.page = page
  listInfo.limit = datas.limit
  if (text && !datas.list.length && page == 1) listInfo.noItemLabel = window.i18n.t('no_item')
  else listInfo.noItemLabel = ''
  return listInfo.list
}

const requestVersions = new Map<string, number>()
const completedKeys = new Map<string, string>()

export const resetListInfo = (sourceId: LX.OnlineSource | 'all'): [] => {
  completedKeys.delete(sourceId)
  requestVersions.set(sourceId, (requestVersions.get(sourceId) ?? 0) + 1)
  let listInfo = listInfos[sourceId]
  if (!listInfo) return []
  listInfo.error = ''
  listInfo.key = null
  listInfo.list = []
  listInfo.page = 0
  listInfo.maxPage = 0
  listInfo.total = 0
  listInfo.noItemLabel = ''
  return []
}

/** Expected provider failures are represented in UI state, never as an unhandled view promise. */
export const search = async(text: string, page: number, sourceId: LX.OnlineSource | 'all'): Promise<LX.Music.MusicInfo[]> => {
  const listInfo = listInfos[sourceId]
  if (!listInfo) return []
  if (!text) return resetListInfo(sourceId)
  const key = `${page}__${text}`
  if (completedKeys.get(sourceId) === key && listInfo.key === key && listInfo.list.length && !listInfo.error) return listInfo.list
  const requestId = (requestVersions.get(sourceId) ?? 0) + 1
  requestVersions.set(sourceId, requestId)
  const isCurrent = () => requestVersions.get(sourceId) === requestId
  completedKeys.delete(sourceId)
  listInfo.key = key
  listInfo.error = ''
  listInfo.noItemLabel = window.i18n.t('list__loading')
  const failures: string[] = []
  let cancelled = false
  const load = async(source: LX.OnlineSource): Promise<SearchResult | null> => {
    try {
      const data = await music[source]?.musicSearch.search(text, page, listInfo.limit)
      if (!data || data.source !== source || !Array.isArray(data.list) || !Number.isFinite(data.total) || data.total < 0 || !Number.isFinite(data.limit) || data.limit <= 0 || !Number.isFinite(data.allPage) || data.allPage < 0) throw new Error('Invalid search response')
      return data
    } catch (error) {
      if (error instanceof Error && /cancel/i.test(error.message)) cancelled = true
      else failures.push(source)
      return null
    }
  }
  try {
    const results = await Promise.all((sourceId === 'all' ? sources.filter((source): source is LX.OnlineSource => source !== 'all') : [sourceId]).map(load))
    if (!isCurrent()) return []
    const successful = results.filter((data): data is SearchResult => data !== null)
    if (!successful.length) {
      listInfo.error = failures.length ? window.i18n.t('list__load_failed') : ''
      listInfo.noItemLabel = listInfo.list.length ? '' : listInfo.error
      return []
    }
    const list = sourceId === 'all' ? setLists(successful, page, text) : setList(successful[0], page, text)
    listInfo.error = failures.length ? window.i18n.t('list__load_failed') + ` (${failures.join(', ')})` : ''
    if (!list.length && failures.length) listInfo.noItemLabel = listInfo.error
    // A cancelled/partially failed aggregate remains retryable rather than being cached as complete.
    if (cancelled) listInfo.key = null
    else if (!failures.length) completedKeys.set(sourceId, key)
    return list
  } catch {
    if (!isCurrent()) return []
    listInfo.error = window.i18n.t('list__load_failed')
    listInfo.noItemLabel = listInfo.list.length ? '' : listInfo.error
    return []
  }
}
