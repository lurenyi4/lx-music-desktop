import { onBeforeRouteLeave } from '@common/utils/vueRouter'
import { ref, nextTick } from '@common/utils/vueTools'
import { addHistoryWord } from '@renderer/store/search/action'
// import { useI18n } from '@renderer/plugins/i18n'
// import { } from '@renderer/store/search/state'
import type { SearchListInfo, ListInfoItem } from '@renderer/store/search/songlist'
import { search as searchSongList, listInfos } from '@renderer/store/search/songlist'

export type SearchSource = LX.OnlineSource | 'all'

export default () => {
  const listRef = ref<any>(null)

  const listInfo = ref<SearchListInfo>({
    page: 1,
    limit: 30,
    total: 0,
    list: [],
    key: null,
    noItemLabel: '',
    tagId: '',
    sortId: '',
  })

  let searchVersion = 0
  const search = (text: string, source: SearchSource, page: number) => {
    // console.log(text, source, page)
    const version = ++searchVersion
    listInfo.value = listInfos[source] as SearchListInfo
    if (text.length) void addHistoryWord(text).catch(error => { console.log(error) })
    return searchSongList(text, page, source).then((list: ListInfoItem[]) => {
      if (version !== searchVersion) return
      // console.log(list)
      if (listInfo.value.key == window.lx.songListInfo.searchKey && window.lx.songListInfo.searchPosition) {
        void nextTick(() => {
          if (version !== searchVersion) return
          listRef.value?.scrollTo(window.lx.songListInfo.searchPosition)
        })
      } else if (list.length && listRef.value) {
        window.lx.songListInfo.searchKey = null
        void nextTick(() => {
          if (version === searchVersion) listRef.value?.scrollTo(0)
        })
      }
    })
  }

  onBeforeRouteLeave(() => {
    window.lx.songListInfo.searchKey = listInfo.value.key
    if (listRef.value) window.lx.songListInfo.searchPosition = listRef.value.getScrollTop()
  })


  return {
    listRef,
    listInfo,
    search,
  }
}
