// import { updateListMusicsPosition } from '@renderer/store/list/action'
import { ref, nextTick } from '@common/utils/vueTools'
import { restartSelectedVersion } from '@renderer/core/player'
import { updateListMusics } from '@renderer/store/list/action'
import { playMusicInfo } from '@renderer/store/player/state'

export default (props, list) => {
  const isShowMusicToggleModal = ref(false)
  const musicInfo = ref(null)

  const handleShowMusicToggleModal = (index) => {
    musicInfo.value = list.value[index]
    nextTick(() => {
      isShowMusicToggleModal.value = true
    })
  }

  const toggleSource = async(toggleMusicInfo) => {
    const original = list.value.find(item => item.id === musicInfo.value.id)
    if (!original) {
      isShowMusicToggleModal.value = false
      return
    }
    // Keep the collection item, position and identity; only persist the chosen version.
    const selected = { ...toggleMusicInfo, meta: { ...toggleMusicInfo.meta } }
    delete selected.meta.toggleMusicInfo
    delete selected.meta.manualVersionPinned
    const updated = { ...original, meta: { ...original.meta, toggleMusicInfo: selected, manualVersionPinned: true } }
    await updateListMusics([{ id: props.listId, musicInfo: updated }])
    isShowMusicToggleModal.value = false
    if (playMusicInfo.listId === props.listId && playMusicInfo.musicInfo?.id === original.id) {
      restartSelectedVersion(props.listId, updated)
    }
  }

  return {
    isShowMusicToggleModal,
    selectedToggleMusicInfo: musicInfo,
    handleShowMusicToggleModal,
    toggleSource,
  }
}
