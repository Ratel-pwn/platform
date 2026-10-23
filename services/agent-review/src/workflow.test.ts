import { hashInput, rootIdForMessage, stageForAgent, validateTrigger } from './workflow'
import type { ReviewTrigger } from './types'

describe('agent review workflow', () => {
  it('maps the three bot identities to ordered stages', () => {
    expect(stageForAgent('技术评估Agent')).toBe('technical')
    expect(stageForAgent('方案Agent')).toBe('solution')
    expect(stageForAgent('合同Agent')).toBe('contract')
  })

  it('uses the native thread root and stable input hashes', () => {
    const root = { _id: 'root', _class: 'chunter:class:ChatMessage', attachedTo: 'channel' } as any
    const reply = { _id: 'reply', _class: 'chunter:class:ThreadMessage', attachedTo: 'root' } as any
    expect(rootIdForMessage(root)).toBe('root')
    expect(rootIdForMessage(reply)).toBe('root')
    expect(hashInput(['a', 'b'])).toBe(hashInput(['a', 'b']))
    expect(hashInput(['a', 'b'])).not.toBe(hashInput(['b', 'a']))
  })

  it('requires an attachment when a handoff trigger is validated', () => {
    const trigger = { stage: 'solution', message: { attachments: 0 } } as unknown as ReviewTrigger
    expect(() => validateTrigger(trigger, new Set(['solution']))).toThrow('定稿')
  })
})
