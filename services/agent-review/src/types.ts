import type { Doc, Ref } from '@hcengineering/core'
import type { ChatMessage, ThreadMessage } from '@hcengineering/chunter'

export const AGENTS = ['技术评估Agent', '方案Agent', '合同Agent'] as const
export type AgentName = (typeof AGENTS)[number]
export type ReviewStage = 'technical' | 'solution' | 'contract'
export type TaskStatus = 'queued' | 'running' | 'awaiting-human' | 'failed' | 'completed'

export interface ApiConfig {
  provider: string
  apiType: string
  baseUrl: string
  model: string
  apiKey: string
  timeoutMs: number
  maxOutputTokens: number
  contextWindow?: number
}

export interface BotCredential {
  email: string
  password: string
}

export interface RuntimeConfig {
  huly: {
    url: string
    workspace: string
    pollIntervalMs: number
    enabledChannels: Array<Ref<Doc>>
  }
  bots: Record<AgentName, BotCredential>
  references: Record<ReviewStage, string[]>
  dataDir: string
  maxConcurrency: number
}

export type DocLike = Doc
export type ReviewRoot = ChatMessage & { reviewDemandTitle: string }
export type ReviewMessage = ChatMessage | ThreadMessage

export interface ReviewTrigger {
  workspace: string
  channelId: Ref<Doc>
  rootId: Ref<ChatMessage>
  message: ReviewMessage
  sender: string
  agent: AgentName
  stage: ReviewStage
}

export interface ReviewTask {
  id: string
  rootId: string
  channelId: string
  triggerId: string
  sender: string
  agent: AgentName
  stage: ReviewStage
  inputHash: string
  status: TaskStatus
  outputMessageId?: string
  error?: string
}
