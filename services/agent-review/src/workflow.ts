import { createHash } from 'node:crypto'
import chunter, { type ChatMessage, type ThreadMessage } from '@hcengineering/chunter'
import type { AgentName, ReviewMessage, ReviewStage, ReviewTrigger } from './types'

export function stageForAgent (agent: AgentName): ReviewStage {
  if (agent === '技术评估Agent') return 'technical'
  if (agent === '方案Agent') return 'solution'
  return 'contract'
}

export function rootIdForMessage (message: ReviewMessage): string {
  return message._class === chunter.class.ThreadMessage
    ? String((message as ThreadMessage).attachedTo)
    : String((message as ChatMessage)._id)
}

export function hashInput (parts: Array<string | Uint8Array>): string {
  const hash = createHash('sha256')
  for (const part of parts) hash.update(part)
  return hash.digest('hex')
}

export function validateTrigger (trigger: ReviewTrigger, availableStages: Set<ReviewStage>): void {
  if (!availableStages.has(trigger.stage)) throw new Error(`阶段 ${trigger.stage} 尚未具备可确认的上游定稿`)
  if (trigger.message.attachments === undefined || trigger.message.attachments === 0) throw new Error('交接必须附带一份 DOCX 或 Markdown 定稿文件')
}
