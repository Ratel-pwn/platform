import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { ApiConfig, RuntimeConfig } from './types'

async function readJson<T> (path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T
}

export async function loadConfig (root = process.cwd()): Promise<{ api: ApiConfig, runtime: RuntimeConfig }> {
  const api = await loadApiConfig(root)
  const runtime = await readJson<RuntimeConfig>(resolve(root, 'runtime.config.local.json'))
  if (runtime.huly.enabledChannels.length === 0) {
    throw new Error('请在 runtime.config.local.json 中填写至少一个启用频道')
  }
  return { api, runtime }
}

export async function loadApiConfig (root = process.cwd()): Promise<ApiConfig> {
  const api = await readJson<ApiConfig>(resolve(root, 'api.config.local.json'))
  if (typeof api.apiKey !== 'string' || api.apiKey.trim().length === 0 || typeof api.baseUrl !== 'string' || api.baseUrl.includes('example.invalid')) {
    throw new Error('请先填写 services/agent-review/api.config.local.json')
  }
  for (const field of ['provider', 'apiType', 'model'] as const) {
    if (typeof api[field] !== 'string' || api[field].trim().length === 0) throw new Error(`API 配置缺少 ${field}`)
  }
  for (const field of ['timeoutMs', 'maxOutputTokens'] as const) {
    if (!Number.isSafeInteger(api[field]) || api[field] <= 0) throw new Error(`API 配置 ${field} 必须是正整数`)
  }
  return api
}

export function redactConfig (config: { api: ApiConfig, runtime: RuntimeConfig }): object {
  return {
    api: { ...config.api, apiKey: config.api.apiKey.length > 0 ? '[configured]' : '[empty]' },
    runtime: { ...config.runtime, bots: Object.fromEntries(Object.keys(config.runtime.bots).map((name) => [name, '[configured]'])) }
  }
}
