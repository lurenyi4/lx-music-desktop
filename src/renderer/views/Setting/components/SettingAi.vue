<template lang="pug">
dt#ai {{ $t('setting__ai') }}
dd
  h3#recommend_default {{ $t('setting__recommend') }}
  div
    .p.small
      | {{ $t('setting__recommend_tip') }}
    .p
      label(for="setting_recommend_engine") {{ $t('setting__recommend_engine') }}
      select#setting_recommend_engine.gap-left(:class="$style.nativeSelect" :value="recommendEngine" :aria-label="$t('setting__recommend_engine')" @change="setRecommendEngine($event.target.value)")
        option(v-for="item in engineList" :key="item.id" :value="item.id") {{ item.name }}
    template(v-if="isPlatformEngine")
      .p(:class="$style.subLabel") {{ $t('setting__recommend_providers') }}
      .p(:class="$style.providerGroup")
        base-checkbox(id="setting_recommend_provider_wy" :model-value="appSetting['recommend.providers.wy']" :label="$t('setting__recommend_provider_wy')" @update:model-value="updateSetting({ 'recommend.providers.wy': $event })")
      .p(:class="$style.providerGroup")
        base-checkbox(id="setting_recommend_provider_tx" :model-value="appSetting['recommend.providers.tx']" :label="$t('setting__recommend_provider_tx')" @update:model-value="updateSetting({ 'recommend.providers.tx': $event })")
      .p(:class="$style.providerGroup")
        base-checkbox(id="setting_recommend_provider_ytm" :model-value="appSetting['recommend.ytm.enable']" :label="$t('setting__recommend_provider_ytm')" @update:model-value="updateSetting({ 'recommend.ytm.enable': $event })")
    div(:class="$style.ytmBox")
      .p
        base-checkbox(id="setting_recommend_ytm_proxy_enable" :model-value="appSetting['recommend.ytm.proxy.enable']" :label="$t('setting__recommend_ytm_proxy_enable')" @update:model-value="updateSetting({ 'recommend.ytm.proxy.enable': $event })")
      .p(v-if="appSetting['recommend.ytm.proxy.enable']" :class="$style.proxyRow")
        label(for="setting_recommend_ytm_proxy_host") {{ $t('setting__recommend_ytm_proxy_host') }}
        base-input#setting_recommend_ytm_proxy_host.gap-left(:class="$style.hostInput" :model-value="ytmProxyHost" placeholder="127.0.0.1" @update:model-value="handleYtmProxyHostInput")
        label.gap-left(for="setting_recommend_ytm_proxy_port") {{ $t('setting__recommend_ytm_proxy_port') }}
        base-input#setting_recommend_ytm_proxy_port.gap-left(:class="$style.portInput" :model-value="ytmProxyPort" placeholder="7890" @update:model-value="handleYtmProxyPortInput")
      .p.small {{ $t('setting__recommend_ytm_proxy_tip') }}
      .p
        base-btn.btn(min :disabled="ytmTestState === 'testing'" @click="handleTestYtm") {{ $t('setting__recommend_ytm_test_btn') }}
        span.gap-left(:class="{ [$style.testing]: ytmTestState === 'testing', [$style.ok]: ytmTestState === 'ok', [$style.fail]: ytmTestState === 'fail' || ytmTestState === 'region-blocked' }") {{ ytmTestText }}
    .p(v-if="!isPlatformEngine")
      | {{ $t('setting__recommend_radius') }}
      base-slider-bar.gap-left(:class="$style.radiusSlider" :value="radiusDraft" :min="10" :max="90" :step="5" @change="setRadius")
      span.gap-left {{ radiusDraft }}
    .p
      base-checkbox(id="setting_recommend_auto_refill" :model-value="appSetting['recommend.autoRefill']" :label="$t('setting__recommend_auto_refill')" @update:model-value="updateSetting({ 'recommend.autoRefill': $event })")
    .p
      base-checkbox(id="setting_recommend_radio" :model-value="appSetting['recommend.radio']" :label="$t('setting__recommend_radio')" @update:model-value="updateSetting({ 'recommend.radio': $event })")

  h3#ai_optional {{ $t('setting__ai') }}
  div
    .p
      base-checkbox(id="setting_ai_enable" :model-value="appSetting['ai.enable']" :label="$t('setting__ai_enable')" @update:model-value="updateSetting({ 'ai.enable': $event })")
    .p
      | {{ $t('setting__ai_provider') }}
      span.select
        base-selection(:model-value="appSetting['ai.provider']" :list="providerList" item-key="id" item-name="name" @update:model-value="updateSetting({ 'ai.provider': $event })")
    .p
      | {{ $t('setting__ai_base_url') }}
      base-input.gap-left(:model-value="aiBaseUrl" :placeholder="$t('setting__ai_base_url_tip')" @update:model-value="setBaseUrl")
    .p
      | {{ $t('setting__ai_api_key') }}
      base-input.gap-left(:model-value="aiApiKey" type="password" :placeholder="$t('setting__ai_api_key_tip')" @update:model-value="setApiKey")
    .p
      | {{ $t('setting__ai_model') }}
      base-input.gap-left(:model-value="aiModel" :placeholder="$t('setting__ai_model_tip')" @update:model-value="setModel")
    .p
      | {{ $t('setting__ai_concurrency') }}
      span.select
        base-selection#setting_ai_concurrency(:model-value="concurrency" :list="concurrencyList" item-key="id" item-name="name" @update:model-value="setConcurrency")
    .p.small {{ $t('setting__ai_concurrency_tip') }}
    .p
      base-btn.btn(min :disabled="aiTestState === 'testing'" @click="handleTestConnect") {{ $t('setting__ai_test_btn') }}
      span.gap-left(:class="{ [$style.testing]: aiTestState === 'testing', [$style.ok]: aiTestState === 'ok', [$style.fail]: aiTestState === 'fail' || aiTestState === 'needConfig' }") {{ aiTestText }}
    .p.small
      | {{ $t('setting__ai_tip') }}
</template>

<script>
import { appSetting, updateSetting } from '@renderer/store/setting'
import { proxy } from '@renderer/store'
import { debounce } from '@common/utils'
import { computed, ref, watch } from '@common/utils/vueTools'
import { useI18n } from '@renderer/plugins/i18n'
import { LLM_MAX_CONCURRENCY, normalizeLlmConcurrency, normalizeRecommendEngine } from '@common/recommendationConfig'
import { llmComplete } from '@renderer/core/recommend/llm'
import { testYtmConnection } from '@renderer/core/recommend/ytmAdapter'
import { parseProxyAddress, resolveEffectiveYtmProxy } from '@renderer/core/recommend/ytmProxy'
import { sharedYtmRegionCache } from '@renderer/utils/musicSdk/ytm/regionCache'

export default {
  name: 'SettingAi',
  setup() {
    const t = useI18n()
    const providerList = [
      { id: 'openai-compatible', name: 'OpenAI-compatible' },
      { id: 'anthropic', name: 'Anthropic' },
    ]
    const engineList = computed(() => [
      { id: 'platform', name: t('setting__recommend_engine_platform') },
      { id: 'ai', name: t('setting__recommend_engine_ai') },
      { id: 'local', name: t('setting__recommend_engine_local') },
    ])
    const recommendEngine = computed(() => normalizeRecommendEngine(appSetting['recommend.engine']))
    const setRecommendEngine = value => { updateSetting({ 'recommend.engine': normalizeRecommendEngine(value) }) }
    const concurrency = computed(() => normalizeLlmConcurrency(appSetting['ai.maxConcurrentRequests']))
    const isPlatformEngine = computed(() => recommendEngine.value === 'platform')
    const concurrencyList = Array.from({ length: LLM_MAX_CONCURRENCY }, (_, i) => ({ id: i + 1, name: String(i + 1) }))
    const setConcurrency = value => { updateSetting({ 'ai.maxConcurrentRequests': normalizeLlmConcurrency(value) }) }
    const createDraftField = (settingKey, delay = 500) => {
      const readSetting = () => String(appSetting[settingKey] ?? '')
      const draft = ref(readSetting())
      let dirty = false
      let pendingCommit = null
      watch(() => appSetting[settingKey], value => {
        const incoming = String(value ?? '')
        if (pendingCommit !== null) {
          if (incoming === pendingCommit) {
            pendingCommit = null
            if (draft.value.trim() === incoming) {
              dirty = false
              draft.value = incoming
            }
          }
          return
        }
        if (dirty) return
        draft.value = incoming
      })
      const commit = debounce(value => {
        const trimmed = String(value ?? '').trim()
        if (trimmed !== draft.value.trim()) return
        if (trimmed !== readSetting() || (pendingCommit !== null && pendingCommit !== trimmed)) {
          pendingCommit = trimmed
          updateSetting({ [settingKey]: trimmed })
          return
        }
        if (pendingCommit === null) dirty = false
      }, delay)
      const onInput = value => {
        dirty = true
        draft.value = String(value ?? '')
        commit(draft.value)
      }
      const flush = () => {
        const trimmed = draft.value.trim()
        if (trimmed !== readSetting() || (pendingCommit !== null && pendingCommit !== trimmed)) {
          pendingCommit = trimmed
          return { [settingKey]: trimmed }
        }
        if (pendingCommit === null) dirty = false
        return null
      }
      return { draft, onInput, flush }
    }
    const baseUrlDraft = createDraftField('ai.baseUrl', 500)
    const apiKeyDraft = createDraftField('ai.apiKey', 500)
    const modelDraft = createDraftField('ai.model', 500)
    const aiBaseUrl = baseUrlDraft.draft
    const aiApiKey = apiKeyDraft.draft
    const aiModel = modelDraft.draft
    const setBaseUrl = baseUrlDraft.onInput
    const setApiKey = apiKeyDraft.onInput
    const setModel = modelDraft.onInput
    const radiusDraft = ref(appSetting['recommend.radius'])
    watch(() => appSetting['recommend.radius'], value => {
      radiusDraft.value = value
    })
    const commitRadius = debounce(value => {
      updateSetting({ 'recommend.radius': Number(value) })
    }, 300)
    const setRadius = value => {
      const next = Number(value)
      radiusDraft.value = next
      commitRadius(next)
    }
    // YTM 代理本地受控草稿：复用统一草稿状态机，实时同步并防止陈旧异步 IPC 回显覆盖
    const ytmHostDraft = createDraftField('recommend.ytm.proxy.host', 400)
    const ytmPortDraft = createDraftField('recommend.ytm.proxy.port', 400)
    const ytmProxyHost = ytmHostDraft.draft
    const ytmProxyPort = ytmPortDraft.draft
    const handleYtmProxyHostInput = ytmHostDraft.onInput
    const handleYtmProxyPortInput = ytmPortDraft.onInput

    // AI 测试连接状态五态（带序号防陈旧响应覆盖）
    const aiTestState = ref('idle')
    const aiTestMessage = ref('')
    let aiTestSeq = 0

    const aiConfigSignature = computed(() => JSON.stringify([
      appSetting['ai.provider'],
      aiBaseUrl.value.trim(),
      aiApiKey.value.trim(),
      aiModel.value.trim(),
    ]))

    watch(aiConfigSignature, () => {
      aiTestSeq++
      aiTestState.value = 'idle'
      aiTestMessage.value = ''
    })

    const aiTestText = computed(() => {
      switch (aiTestState.value) {
        case 'testing':
          return t('setting__ai_testing')
        case 'ok':
          return t('setting__ai_test_ok')
        case 'needConfig':
          return t('setting__ai_test_need_config')
        case 'fail':
          return `${t('setting__ai_test_fail_prefix')}${aiTestMessage.value}`
        default:
          return ''
      }
    })

    const handleTestConnect = async() => {
      if (aiTestState.value === 'testing') return
      const patch = {
        ...baseUrlDraft.flush(),
        ...apiKeyDraft.flush(),
        ...modelDraft.flush(),
      }
      if (Object.keys(patch).length) updateSetting(patch)
      const apiKey = aiApiKey.value.trim()
      const model = aiModel.value.trim()
      const baseUrl = aiBaseUrl.value.trim()
      if (!apiKey || !model) {
        aiTestState.value = 'needConfig'
        aiTestMessage.value = ''
        return
      }
      const seq = ++aiTestSeq
      aiTestState.value = 'testing'
      aiTestMessage.value = ''
      try {
        await llmComplete({
          protocol: appSetting['ai.provider'],
          baseUrl,
          apiKey,
          model,
          messages: [{ role: 'user', content: '请只回复：OK' }],
        })
        if (seq !== aiTestSeq) return
        aiTestState.value = 'ok'
      } catch (err) {
        if (seq !== aiTestSeq) return
        aiTestState.value = 'fail'
        aiTestMessage.value = String(err?.message ?? err).slice(0, 300)
      }
    }

    // YouTube Music 连通性测试状态（带序号防陈旧响应覆盖）
    const ytmTestState = ref('idle')
    const ytmTestMessage = ref('')
    let ytmTestSeq = 0

    const ytmProxySignature = computed(() => JSON.stringify([
      Boolean(appSetting['recommend.ytm.proxy.enable']),
      ytmProxyHost.value.trim(),
      ytmProxyPort.value.trim(),
      Boolean(appSetting['network.proxy.enable']),
      String(appSetting['network.proxy.host'] ?? '').trim(),
      String(appSetting['network.proxy.port'] ?? '').trim(),
    ]))

    watch(ytmProxySignature, () => {
      ytmTestSeq++
      ytmTestState.value = 'idle'
      ytmTestMessage.value = ''
    })

    const ytmTestText = computed(() => {
      switch (ytmTestState.value) {
        case 'testing':
          return t('setting__recommend_ytm_testing')
        case 'ok':
          return t('setting__recommend_ytm_test_ok')
        case 'region-blocked':
          return t('setting__recommend_ytm_test_region_blocked')
        case 'fail':
          return `${t('setting__recommend_ytm_test_fail_prefix')}${ytmTestMessage.value}`
        default:
          return ''
      }
    })

    const handleTestYtm = async() => {
      if (ytmTestState.value === 'testing') return
      const patch = {
        ...ytmHostDraft.flush(),
        ...ytmPortDraft.flush(),
      }
      if (Object.keys(patch).length) updateSetting(patch)
      const trimmedHost = ytmProxyHost.value.trim()
      const trimmedPort = ytmProxyPort.value.trim()
      // 启用了独立代理但主机或端口非法时直接提示配置错误，绝不静默走直连/全局回退误报“连接正常”
      if (appSetting['recommend.ytm.proxy.enable'] && !parseProxyAddress(trimmedHost, trimmedPort)) {
        ytmTestState.value = 'fail'
        ytmTestMessage.value = t('setting__recommend_ytm_proxy_tip')
        return
      }
      const seq = ++ytmTestSeq
      ytmTestState.value = 'testing'
      ytmTestMessage.value = ''
      const snapshot = {
        ...appSetting,
        'recommend.ytm.proxy.host': trimmedHost,
        'recommend.ytm.proxy.port': trimmedPort,
      }
      const effective = resolveEffectiveYtmProxy(snapshot, proxy)
      try {
        const res = await testYtmConnection(effective.proxyOverride)
        if (seq !== ytmTestSeq) return
        if (res.ok) {
          sharedYtmRegionCache.set(effective.contextKey, false)
          ytmTestState.value = 'ok'
        } else if (res.status === 'region-blocked') {
          sharedYtmRegionCache.set(effective.contextKey, true)
          ytmTestState.value = 'region-blocked'
          ytmTestMessage.value = res.message
        } else {
          ytmTestState.value = 'fail'
          ytmTestMessage.value = res.message
        }
      } catch (err) {
        if (seq !== ytmTestSeq) return
        ytmTestState.value = 'fail'
        ytmTestMessage.value = String(err?.message ?? err).slice(0, 300)
      }
    }

    return {
      appSetting,
      updateSetting,
      t,
      providerList,
      engineList,
      recommendEngine,
      setRecommendEngine,
      concurrency,
      isPlatformEngine,
      concurrencyList,
      setConcurrency,
      aiBaseUrl,
      aiApiKey,
      aiModel,
      setBaseUrl,
      setApiKey,
      setModel,
      radiusDraft,
      setRadius,
      ytmProxyHost,
      ytmProxyPort,
      handleYtmProxyHostInput,
      handleYtmProxyPortInput,
      aiTestState,
      aiTestText,
      handleTestConnect,
      ytmTestState,
      ytmTestText,
      handleTestYtm,
    }
  },
}
</script>

<style lang="less" module>
@import '@renderer/assets/styles/layout.less';
.radiusSlider {
  vertical-align: middle;
  display: inline-block;
  width: 160px;
}
.nativeSelect {
  min-width: 180px;
  height: 30px;
  padding: 0 10px;
  border-radius: var(--ui-radius-sm, 6px);
  border: 1px solid var(--ui-border-subtle);
  background-color: var(--ui-surface-elevated);
  color: var(--color-font);
  font-size: 13px;
  cursor: pointer;
  outline: none;
  transition: border-color @transition-fast, background-color @transition-fast;
  &:hover {
    border-color: var(--ui-border-strong);
  }
  &:focus-visible {
    outline: 2px solid var(--color-primary);
    outline-offset: 2px;
  }
  option {
    background-color: var(--color-content-background);
    color: var(--color-font);
  }
}
.subLabel {
  margin-top: 10px;
  font-weight: 500;
  color: var(--color-font);
}
.providerGroup {
  padding-left: 4px;
}
.ytmBox {
  margin: 8px 0 12px 16px;
  padding: 12px 14px;
  border-radius: 10px;
  background-color: var(--ui-surface-card);
  border: 1px solid var(--ui-border-subtle);
}
.proxyRow {
  display: flex;
  flex-flow: row wrap;
  align-items: center;
  gap: 6px;
}
.hostInput {
  width: 170px;
}
.portInput {
  width: 88px;
}
.testing {
  color: var(--color-font-label);
}
.ok {
  color: var(--color-primary);
}
.fail {
  color: var(--color-badge-secondary);
}
</style>
