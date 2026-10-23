import { AgentReviewService } from './service'

const service = new AgentReviewService()
void service.start().catch((error) => {
  console.error('agent-review failed to start:', error instanceof Error ? error.message : error)
  process.exitCode = 1
})

process.once('SIGINT', () => { void service.stop() })
process.once('SIGTERM', () => { void service.stop() })

export * from './types'
export * from './workflow'
