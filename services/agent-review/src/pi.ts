import type { ApiConfig, ReviewStage } from './types'

export async function runPiPrompt (api: ApiConfig, prompt: string): Promise<string> {
  // Keep Pi external to the CommonJS bundle so Node loads its ESM distribution
  // together with the SDK's own assets and dependencies.
  const pi: any = await import('@earendil-works/pi-coding-agent')
  const provider = 'agent-review-configured'
  const credential = { type: 'api_key', key: api.apiKey }
  const modelRuntime = await pi.ModelRuntime.create({
    credentials: {
      read: async (id: string) => id === provider ? credential : undefined,
      list: async () => [{ providerId: provider, type: 'api_key' }],
      modify: async () => { throw new Error('评审会话不允许修改凭据') },
      delete: async () => { throw new Error('评审会话不允许删除凭据') }
    },
    modelsPath: null,
    allowModelNetwork: false,
    refreshOnCreate: false
  })
  const apiType = api.apiType === 'openai-compatible' ? 'openai-completions' : api.apiType
  modelRuntime.registerProvider(provider, {
    name: api.provider,
    baseUrl: api.baseUrl,
    api: apiType,
    authHeader: true,
    models: [{
      id: api.model,
      name: api.model,
      reasoning: false,
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: api.contextWindow ?? 32768,
      maxTokens: api.maxOutputTokens
    }]
  })
  const model = modelRuntime.getModel(provider, api.model)
  if (model === undefined) throw new Error('Pi 无法加载所配置的模型，请检查 apiType 和 model')
  const extensionsResult = { extensions: [], errors: [], runtime: pi.createExtensionRuntime() }
  const { session } = await pi.createAgentSession({
    model,
    modelRuntime,
    noTools: 'all',
    tools: [],
    sessionManager: pi.SessionManager.inMemory(),
    settingsManager: pi.SettingsManager.inMemory({
      compaction: { enabled: false },
      retry: { enabled: false, provider: { maxRetries: 0, timeoutMs: api.timeoutMs } },
      cacheWarming: 'off',
      enableAnalytics: false,
      enableInstallTelemetry: false
    }),
    resourceLoader: {
      getExtensions: () => extensionsResult,
      getSkills: () => ({ skills: [], diagnostics: [] }),
      getPrompts: () => ({ prompts: [], diagnostics: [] }),
      getThemes: () => ({ themes: [], diagnostics: [] }),
      getAgentsFiles: () => ({ agentsFiles: [] }),
      getSystemPrompt: () => '你是文档评审助手。只根据本次提供的需求、附件和参考资料作答。',
      getSystemPromptSource: () => undefined,
      getAppendSystemPrompt: () => [],
      getAppendSystemPromptSources: () => [],
      extendResources: () => {},
      reload: async () => {}
    }
  })
  session.agent.streamFn = async (requestModel: any, context: any, options: any) =>
    await modelRuntime.streamSimple(requestModel, context, {
      ...options, maxTokens: api.maxOutputTokens, timeoutMs: api.timeoutMs, maxRetries: 0
    })
  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    void session.abort()
  }, api.timeoutMs)
  try {
    await session.prompt(prompt)
    if (timedOut) throw new Error('模型请求超时，请检查接口或调整 timeoutMs 后发送新消息重试')
    const last = [...session.agent.state.messages].reverse().find((message: any) => message.role === 'assistant')
    if (last?.stopReason === 'error' || last?.stopReason === 'aborted') {
      throw new Error(String(last.errorMessage ?? '模型请求失败'))
    }
    if (last?.stopReason === 'length') throw new Error('模型输出达到限制，草稿不完整，请调整 maxOutputTokens 后重试')
    const output = String(session.getLastAssistantText() ?? '').trim()
    if (output.length === 0) throw new Error('模型没有返回可用文字')
    return output
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(message.split(api.apiKey).join('[redacted]'))
  } finally {
    clearTimeout(timeout)
    session.dispose()
  }
}

export async function runPi (api: ApiConfig, stage: ReviewStage, demand: string, input: string, references: string[]): Promise<string> {
  return await runPiPrompt(api, `你是 ${stage} 文档评审 Agent。需求：${demand}\n当前输入：\n${input}\n允许参考资料：\n${references.join('\n')}\n请输出可审阅的 Markdown 草稿，并区分事实、判断、假设和待确认项。`)
}
