<template>
  <material-modal :show="catalogState.show" width="88%" max-width="1000px" height="82%" max-height="90%" bg-close @close="catalogActions.close">
    <section :class="$style.catalog" aria-label="音乐目录">
      <h2>{{ catalogState.title }}</h2>
      <div v-if="catalogState.targets.length > 1" :class="$style.artists" aria-label="选择艺人">
        <span>选择艺人：</span>
        <base-btn v-for="target in catalogState.targets" :key="target.id" :aria-pressed="catalogState.target?.id === target.id" @click="catalogActions.select(target)">{{ target.name }}</base-btn>
      </div>
      <p v-if="catalogState.error" :class="$style.status" role="alert">{{ catalogState.error }} <base-btn :disabled="catalogState.loading" @click="catalogActions.retry">重试</base-btn></p>
      <p v-if="catalogState.loading" :class="$style.status" role="status">正在加载目录…</p>
      <div v-if="catalogState.target" :class="$style.songs">
        <material-online-list
          :key="`${catalogState.target.source}:${catalogState.target.kind}:${catalogState.target.id}`"
          :list="catalogState.list" :page="1" :limit="Math.max(1, catalogState.list.length)" :total="catalogState.list.length"
          :no-item="!catalogState.loading && !catalogState.error && !catalogState.list.length ? '提供方未返回歌曲' : ''"
          check-api-source @play-list="playCatalogSong"
        />
      </div>
      <footer v-if="catalogState.target" :class="$style.footer">
        <span>已加载 {{ catalogState.list.length }} 首<span v-if="catalogState.total !== null"> · 提供方目录 {{ catalogState.total }} 首</span></span>
        <base-btn v-if="catalogState.hasMore" :disabled="catalogState.loading" @click="catalogActions.loadMore">加载更多</base-btn>
        <span v-else-if="!catalogState.loading && !catalogState.error">{{ catalogState.total === null ? '提供方未返回更多歌曲' : catalogState.list.length < catalogState.total ? '提供方分页结束，部分歌曲未返回' : '已到目录末尾' }}</span>
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
