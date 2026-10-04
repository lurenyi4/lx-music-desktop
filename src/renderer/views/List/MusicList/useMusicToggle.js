// import { updateListMusicsPosition } from '@renderer/store/list/action'
import { ref, nextTick } from '@common/utils/vueTools'
import { createManualVersion } from '@renderer/core/music/version'
import { restartSelectedVersion } from '@renderer/core/player'
import { updateListMusics } from '@renderer/store/list/action'
import { playMusicInfo } from '@renderer/store/player/state'

export default (props, list) => {
  const isShowMusicToggleModal = ref(false)
  const musicInfo = ref(null)
  let preview
  let originalWasTemp = true

  const handleShowMusicToggleModal = (index) => {
    musicInfo.value = list.value[index]
    preview = undefined
    originalWasTemp = playMusicInfo.listId === props.listId && playMusicInfo.musicInfo?.id === musicInfo.value.id ? playMusicInfo.isTempPlay : true
    nextTick(() => {
      isShowMusicToggleModal.value = true
    })
  }

  const handlePreviewVersion = (selected) => {
    if (!preview) originalWasTemp = playMusicInfo.listId === props.listId && playMusicInfo.musicInfo?.id === musicInfo.value.id ? playMusicInfo.isTempPlay : true
    preview = { musicInfo: selected, isTempPlay: originalWasTemp }
  }

  const toggleSource = async(toggleMusicInfo) => {
    const original = list.value.find(item => item.id === musicInfo.value.id)
    if (!original) {
      isShowMusicToggleModal.value = false
      return
    }
    // Keep the collection item, position and identity; only persist the chosen version.
    const updated = createManualVersion(original, toggleMusicInfo)
    await updateListMusics([{ id: props.listId, musicInfo: updated }])
    isShowMusicToggleModal.value = false
    if (preview) restartSelectedVersion(props.listId, updated, preview)
    else restartSelectedVersion(props.listId, updated)
  }

  return {
    isShowMusicToggleModal,
    selectedToggleMusicInfo: musicInfo,
    handleShowMusicToggleModal,
    toggleSource,
    handlePreviewVersion,
  }
}
