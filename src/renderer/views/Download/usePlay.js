import { addTempPlayList } from '@renderer/store/player/action'
import { playList, playMusicSelection } from '@renderer/core/player'
import { LIST_IDS } from '@common/constants'

export default ({ selectedList, list, listAll, removeAllSelect }) => {
  const handlePlayMusic = (index, single = false) => {
    if (selectedList.value.length && !single) {
      const ids = new Set(selectedList.value.map(item => item.id))
      playMusicSelection(list.value.filter(item => ids.has(item.id) && item.isComplate), LIST_IDS.DOWNLOAD)
      removeAllSelect()
    } else playList(LIST_IDS.DOWNLOAD, listAll.value.indexOf(list.value[index]))
  }

  const handlePlayMusicLater = (index, single) => {
    if (selectedList.value.length && !single) {
      addTempPlayList(list.value.filter(item => item.isComplate && selectedList.value.some(selected => selected.id === item.id)).map(s => ({ listId: LIST_IDS.DOWNLOAD, musicInfo: s })))
      removeAllSelect()
    } else {
      addTempPlayList([{ listId: LIST_IDS.DOWNLOAD, musicInfo: list.value[index] }])
    }
  }

  return {
    handlePlayMusic,
    handlePlayMusicLater,
  }
}
