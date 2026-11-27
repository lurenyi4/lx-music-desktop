/** Collection/download identity and the user's preferred recording are distinct. */
export const getOriginalMusicInfo = (music: LX.Music.MusicInfo | LX.Download.ListItem): LX.Music.MusicInfo =>
  'progress' in music ? music.metadata.musicInfo : music

export const getPreferredMusicInfo = (music: LX.Music.MusicInfo | LX.Download.ListItem): LX.Music.MusicInfo => {
  const original = getOriginalMusicInfo(music)
  return original.meta.toggleMusicInfo ?? original
}

/** Legacy preferences remain playable; only an explicit user confirmation creates a manual pin. */
export const getVersionPreference = (music: LX.Music.MusicInfo | LX.Download.ListItem): 'manual' | 'legacy' | 'original' => {
  const original = getOriginalMusicInfo(music)
  return original.meta.manualVersionPinned ? 'manual' : original.meta.toggleMusicInfo ? 'legacy' : 'original'
}

const withoutNestedPreference = <T extends LX.Music.MusicInfoOnline>(selected: T): T => {
  const meta = { ...selected.meta }
  delete meta.toggleMusicInfo
  delete meta.manualVersionPinned
  return { ...selected, meta }
}

export const createManualVersion = <T extends LX.Music.MusicInfo>(original: T, selected: LX.Music.MusicInfo): T => {
  if (selected.id === original.id) return { ...original, meta: { ...original.meta, toggleMusicInfo: null, manualVersionPinned: true } }
  if (selected.source === 'local') throw new Error('selected version must be online')
  const preferred = withoutNestedPreference(selected)
  return { ...original, meta: { ...original.meta, toggleMusicInfo: preferred, manualVersionPinned: true } }
}
