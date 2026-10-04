<template>
  <material-modal :show="catalogState.show" width="88%" max-width="1000px" height="82%" max-height="90%" bg-close @close="catalogActions.close">
    <section :class="$style.catalog" :aria-label="$t('catalog__title')">
      <h2>{{ catalogState.title }}</h2>
      <div v-if="catalogState.targets.length > 1" :class="$style.artists" :aria-label="$t('catalog__select_artist')">
        <span>{{ $t('catalog__select_artist') }}</span>
        <base-btn v-for="target in catalogState.targets" :key="target.id" :aria-pressed="catalogState.target?.id === target.id" @click="catalogActions.select(target)">{{ target.name }}</base-btn>
      </div>
      <p v-if="catalogState.error" :class="$style.status" role="alert">{{ catalogState.error }} <base-btn :disabled="catalogState.loading" @click="catalogActions.retry">{{ $t('retry') }}</base-btn></p>
      <p v-if="catalogState.loading" :class="$style.status" role="status">{{ $t('catalog__loading') }}</p>
      <div v-if="catalogState.target" :class="$style.songs">
        <material-online-list
          :key="`${catalogState.target.source}:${catalogState.target.kind}:${catalogState.target.id}`"
          :list="catalogState.list" :page="1" :limit="Math.max(1, catalogState.list.length)" :total="catalogState.list.length"
          :no-item="!catalogState.loading && !catalogState.error && !catalogState.list.length ? $t('catalog__empty') : ''"
          check-api-source @play-list="playCatalogSong"
        />
      </div>
      <footer v-if="catalogState.target" :class="$style.footer">
        <span>{{ $t('catalog__loaded_count', { count: catalogState.list.length }) }}<span v-if="catalogState.total !== null"> · {{ $t('catalog__total_count', { count: catalogState.total }) }}</span></span>
        <base-btn v-if="catalogState.hasMore" :disabled="catalogState.loading" @click="catalogActions.loadMore">{{ $t('catalog__load_more') }}</base-btn>
        <span v-else-if="!catalogState.loading && !catalogState.error">{{ $t(catalogState.total === null ? 'catalog__no_more' : catalogState.list.length < catalogState.total ? 'catalog__partial_end' : 'catalog__end') }}</span>
      </footer>
    </section>
  </material-modal>
</template>

<script setup lang="ts">
import { catalogState, catalogActions } from '@renderer/core/catalog'
import { playMusicSelection } from '@renderer/core/player/action'
import { assertPlaybackSupport } from '@renderer/core/music/sourceCapabilities'

const playCatalogSong = (index: number) => {
  const music = catalogState.list[index]
  if (!music || !assertPlaybackSupport(music.source)) return
  playMusicSelection(catalogState.list.slice(index), null)
}
</script>

<style module>
.catalog {
  height: 100%;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  padding: 20px;
  gap: 12px;
}
.catalog h2 { font-size: 18px; padding-right: 20px; }
.artists, .footer { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.songs { flex: 1; min-height: 0; }
.status { font-size: 14px; line-height: 1.6; }
.footer { justify-content: space-between; font-size: 13px; }
</style>
