/**
 * 推荐引擎 LLM IPC 参数校验（纯函数，无运行时副作用，可单测）。
 * 校验失败抛出人类可读中文 Error（mainHandle 的异常消息会被 renderer 侧展示为错误文案）。
 */
import type { RecommendLlmParams } from '@common/recommendation'

/** 短字段（apiKey / model / baseUrl）长度上限（防止异常超长输入进入 HTTP 请求）。 */
export const MAX_FIELD_LENGTH = 4096

/**
 * 单条 message.content 长度上限（按现役模型 1M 上下文对齐）。
 * T-B1 排序提示词 = RANK_SYSTEM（约 840 字符）+ 至多 48 条候选 JSON，实测约 1.8 万字符；
 * 旧上限 4096 会误杀 AI 排序消息导致静默回退本地排序；256_000 给足余量，
 * 现按用户要求与模型上下文能力对齐到 1_000_000。
 * apiKey / model / baseUrl 保持 4096 上限不变。
 */
export const MAX_MESSAGE_LENGTH = 1_000_000

const PROTOCOLS = ['openai-compatible', 'anthropic'] as const

const MESSAGE_ROLES = ['system', 'user', 'assistant'] as const

/** 非空且不超长的字符串校验（可选要求去除首尾空白后仍非空）。 */
const isValidText = (value: unknown, maxLength: number, requireNonBlank = false): value is string => {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) return false
  return !requireNonBlank || value.trim().length > 0
}

/** 校验可安全写入 HTTP 请求头的 API Key（禁止空串/纯空白/控制字符与非 Latin-1 字符）。 */
const isValidApiKey = (value: unknown): value is string => {
  if (!isValidText(value, MAX_FIELD_LENGTH, true)) return false
  // eslint-disable-next-line no-control-regex
  return !/[\x00-\x1F\x7F\u0100-\uFFFF]/.test(value)
}

/** 校验可选 baseUrl：允许空串，非空时须为合法 http(s) URL，不含内嵌凭据、查询参数或片段。 */
const isValidOptionalBaseUrl = (value: unknown): boolean => {
  if (value == null) return true
  if (typeof value !== 'string' || value.length > MAX_FIELD_LENGTH) return false
  const trimmed = value.trim()
  if (!trimmed) return true
  if (trimmed.includes('?') || trimmed.includes('#')) return false
  try {
    const parsed = new URL(trimmed)
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      !parsed.username &&
      !parsed.password &&
      !parsed.search &&
      !parsed.hash
    )
  } catch {
    return false
  }
}

/** 校验推荐引擎 LLM 调用参数；非法时抛中文 Error。 */
export const validateLlmParams = (params: unknown): void => {
  if (!params || typeof params !== 'object' || Array.isArray(params)) throw new Error('LLM 参数缺失')
  const p = params as Partial<RecommendLlmParams>
  if (!isValidApiKey(p.apiKey)) throw new Error('AI API Key 未配置或格式非法')
  if (!isValidText(p.model, MAX_FIELD_LENGTH, true)) throw new Error('LLM model 未配置或格式非法')
  if (!isValidOptionalBaseUrl(p.baseUrl)) throw new Error('LLM baseUrl 格式非法')
  if (p.protocol != null && !PROTOCOLS.includes(p.protocol)) throw new Error('LLM protocol 不支持')
  if (p.maxTokens != null && (!Number.isInteger(p.maxTokens) || p.maxTokens < 1 || p.maxTokens > 384_000)) throw new Error('LLM maxTokens 格式非法')
  if (!Array.isArray(p.messages) || !p.messages.length) throw new Error('LLM messages 不能为空')
  for (const message of p.messages) {
    if (!message || typeof message !== 'object' || Array.isArray(message) || !MESSAGE_ROLES.includes(message.role) || !isValidText(message.content, MAX_MESSAGE_LENGTH)) throw new Error('LLM message 格式非法')
  }
}
