<template>
  <button type="button" :class="$style.link" :aria-label="$t(kind === 'artist' ? 'catalog__open_artist' : 'catalog__open_album', { name: label })" @click.stop="openMusicCatalog(kind, effectiveMusic)" @dblclick.stop>
    {{ label }}
  </button>
</template>

<script setup lang="ts">
import { computed } from '@common/utils/vueTools'
import { useI18n } from '@renderer/plugins/i18n'
import { getPreferredMusicInfo } from '@renderer/core/music/version'
import { openMusicCatalog } from '@renderer/core/catalog'
import { type CatalogKind } from '@renderer/core/catalog/types'
const props = defineProps<{ kind: CatalogKind, music: LX.Music.MusicInfo | LX.Download.ListItem }>()
const t = useI18n()
const effectiveMusic = computed(() => getPreferredMusicInfo(props.music))
const label = computed(() => (props.kind === 'artist' ? effectiveMusic.value.singer : effectiveMusic.value.meta.albumName) || t('catalog__unknown'))
</script>

<style module>
.link {
  cursor: pointer;
  color: inherit;
  background: none;
  border: 0;
  padding: 0;
  font: inherit;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: left;
}
.link:hover, .link:focus-visible {
  color: var(--color-primary);
  text-decoration: underline;
}
</style>
