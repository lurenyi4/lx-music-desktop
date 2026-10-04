<template>
  <button type="button" :class="$style.link" :aria-label="`打开${kind === 'artist' ? '艺人' : '专辑'}目录：${label}`" @click.stop="openMusicCatalog(kind, effectiveMusic)" @dblclick.stop>
    {{ label }}
  </button>
</template>

<script setup lang="ts">
import { computed } from '@common/utils/vueTools'
import { openMusicCatalog } from '@renderer/core/catalog'
import { type CatalogKind } from '@renderer/core/catalog/types'
const props = defineProps<{ kind: CatalogKind, music: LX.Music.MusicInfo }>()
const effectiveMusic = computed(() => props.music.meta.toggleMusicInfo ?? props.music)
const label = computed(() => (props.kind === 'artist' ? effectiveMusic.value.singer : effectiveMusic.value.meta.albumName) || '未知')
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
