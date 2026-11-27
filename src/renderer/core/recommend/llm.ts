/** 推荐 LLM 通道：共享并发上限，按单次请求重试（含输出校验），不重跑已成功的批次。 */
import { RECOMMENDATION_EVENT_NAME } from '@common/ipcNames'
import { appSetting } from '@renderer/store/setting'
import { watch } from '@common/utils/vueTools'
import { normalizeLlmConcurrency } from '@common/recommendationConfig'
import { rendererInvoke } from '@common/rendererIpc'
import type { RecommendLlmParams, RecommendLlmResult } from '@common/recommendation'

/** n 次重试 = 初始请求 + n 次；HTTP 层不再叠加重试。 */
export const LLM_MAX_RETRIES = 2
const RETRY_DELAY_MS = 800
const DEFAULT_MAX_TOKENS = 384_000
const TOKEN_LIMIT_LADDER = [8192, 4096, 2048, 1024] as const
// 模型不支持高输出预算时记住正整数降档结果，后续批次不再重复发送必失败的请求。
const tokenLimits = new Map<string, number>()

/** 仅从主进程 assertOk / Electron IPC 错误头提取 HTTP 状态码，避免把 `:443` 端口号误判为 4xx。 */
const extractHttpStatus = (err: unknown): string | null => {
  const message = String((err as Error)?.message ?? err)
  const match = message.match(/(?:^|Error:\s*)(4\d\d|5\d\d)\b/)
  return match ? match[1] : null
}

const isTokenLimitError = (err: unknown): boolean => {
  const status = extractHttpStatus(err)
  if (status !== '400' && status !== '422') return false
  const message = String((err as Error)?.message ?? err).toLowerCase()
  return /max_(?:completion_)?tokens/.test(message) &&
    ['exceed', 'greater', 'larger', 'invalid', 'maximum', 'limit', 'less than', 'unsupported', 'range', 'between', 'must be', 'should be', '过大', '超出', '无效', '超限', '范围'].some(hint => message.includes(hint))
}

const parseReportedMaxTokens = (err: unknown): number | null => {
  const message = String((err as Error)?.message ?? err)
  const rangeMatch = message.match(/\[\s*\d+\s*,\s*(\d{3,6})\s*\]/)
  if (rangeMatch) return Number(rangeMatch[1])
  const maxMatch = message.match(/(?:maximum|max(?:imum)?\s+(?:value|allowed|limit)|<=|at\s+most|less\s+than(?:\s+or\s+equal\s+to)?)\D{0,12}(\d{3,6})/i)
  if (maxMatch) return Number(maxMatch[1])
  return null
}

const nextTokenLimit = (current: number, err: unknown): { hasNext: boolean, value: number } => {
  const reported = parseReportedMaxTokens(err)
  if (reported != null && Number.isFinite(reported) && reported >= 256 && reported < current) {
    return { hasNext: true, value: Math.min(reported, 8192) }
  }
  const nextStep = TOKEN_LIMIT_LADDER.find(step => step < current)
  if (nextStep !== undefined) return { hasNext: true, value: nextStep }
  return { hasNext: false, value: current }
}

interface Waiter {
  resolve: (acquired: boolean) => void
  isCancelled?: () => boolean
}

let active = 0
const waiting: Waiter[] = []
const drain = (): void => {
  const limit = normalizeLlmConcurrency(appSetting['ai.maxConcurrentRequests'])
  while (waiting.length) {
    if (waiting[0].isCancelled?.()) {
      waiting.shift()!.resolve(false)
      continue
    }
    if (active >= limit) break
    active++
    waiting.shift()!.resolve(true)
  }
}
// 调大立即放行等待请求；调小不打断在途请求，等它们完成后再按新上限放行。
watch(() => appSetting['ai.maxConcurrentRequests'], drain)

export interface LlmCallOptions {
  isCancelled?: () => boolean
}

const checkCancelled = (options: LlmCallOptions): void => {
  if (options.isCancelled?.()) throw new Error('推荐计划已取消')
}

const invoke = async(params: RecommendLlmParams, options: LlmCallOptions): Promise<RecommendLlmResult> => {
  checkCancelled(options)
  const acquired = await new Promise<boolean>(resolve => {
    waiting.push({ isCancelled: options.isCancelled, resolve })
    drain()
  })
  try {
    checkCancelled(options)
    return await rendererInvoke<RecommendLlmParams, RecommendLlmResult>(RECOMMENDATION_EVENT_NAME.llm_complete, params)
  } finally {
    if (acquired) {
      active--
      drain()
    }
  }
}

/** IPC 会把主进程异常包装为文本，因此从错误头状态码识别不可重试的配置/认证错误。 */
export const isPermanentLlmError = (err: unknown): boolean => {
  const status = extractHttpStatus(err)
  return status != null && status.startsWith('4') && !['408', '409', '425', '429'].includes(status)
}

/** 不可重试 4xx 或 429 限流：上游已明确拒收/限流，避免紧接着扇出多批排序请求放大失败。 */
export const isLlmServiceBlockedError = (err: unknown): boolean => {
  const status = extractHttpStatus(err)
  return status === '429' || isPermanentLlmError(err)
}

export const llmCompleteWithValidation = async<T>(
  params: RecommendLlmParams,
  validate: (result: RecommendLlmResult) => T,
  options: LlmCallOptions = {},
): Promise<T> => {
  const modelKey = JSON.stringify([params.protocol, params.baseUrl, params.model])
  const initialMaxTokens = params.maxTokens ?? tokenLimits.get(modelKey) ?? DEFAULT_MAX_TOKENS
  const request: RecommendLlmParams = { ...params, maxTokens: initialMaxTokens }

  for (let attempt = 0, tokenDowngrades = 0; ;) {
    checkCancelled(options)
    try {
      const result = await invoke({ ...request }, options)
      checkCancelled(options)
      if (!result?.content?.trim()) throw new Error('LLM 返回空内容')
      return validate(result)
    } catch (err) {
      checkCancelled(options)
      if (isTokenLimitError(err)) {
        if (tokenDowngrades >= TOKEN_LIMIT_LADDER.length) throw err
        const next = nextTokenLimit(request.maxTokens ?? DEFAULT_MAX_TOKENS, err)
        if (!next.hasNext) throw err
        const delay = RETRY_DELAY_MS * 2 ** Math.min(tokenDowngrades, LLM_MAX_RETRIES)
        tokenDowngrades++
        request.maxTokens = next.value
        tokenLimits.set(modelKey, next.value)
        await new Promise(resolve => setTimeout(resolve, delay))
        continue
      }
      if (attempt >= LLM_MAX_RETRIES) throw err
      if (isPermanentLlmError(err)) throw err
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS * 2 ** attempt))
      attempt++
    }
  }
}

export const llmComplete = async(params: RecommendLlmParams): Promise<RecommendLlmResult> => {
  return llmCompleteWithValidation(params, result => result)
}
