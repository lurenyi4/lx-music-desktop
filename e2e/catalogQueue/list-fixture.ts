// Only selection side effects, downloads and dialogs are replaced. OnlineList's row/menu handlers stay real.
import { ref } from 'vue'
import { listEvents } from './mocks'
export default () => ({
  selectedList: ref([]),
  listItemHeight: 36,
  handleSelectData: (index: number) => { listEvents.selections.push(index) },
  removeAllSelect() {},
  isShowListAdd: ref(false),
  isShowListAddMultiple: ref(false),
  selectedAddMusicInfo: ref(null),
  isShowDownload: ref(false),
  isShowDownloadMultiple: ref(false),
  selectedDownloadMusicInfo: ref(null),
  handleShowMusicAddModal() {},
  handleShowDownloadModal() {},
  handleSearch() {},
  handleOpenMusicDetail() {},
  handleDislikeMusic() {},
})
