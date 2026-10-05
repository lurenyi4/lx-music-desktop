<template>
  <main>
    <h1>Catalog / queue component verification</h1>
    <button id="open-catalog" @click="catalogState.show = true">Open catalog</button>
    <PlaybackQueue />
    <MusicCatalogModal />
    <p>Real production Vue components and queue mutations; deterministic song data, no audio or provider network.</p>
  </main>
</template>
<script setup lang="ts">
import PlaybackQueue from '../../src/renderer/components/layout/PlayBar/PlaybackQueue.vue'
import MusicCatalogModal from '../../src/renderer/components/common/MusicCatalogModal.vue'
import { catalogState } from './mocks'
</script>
