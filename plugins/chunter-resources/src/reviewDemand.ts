import type { ChatMessage } from '@hcengineering/chunter'
import contact, { formatName, type Person } from '@hcengineering/contact'
import { getClient, getCurrentWorkspaceUuid } from '@hcengineering/presentation'
import { markupToJSON } from '@hcengineering/text'
import { extractReferences } from '@hcengineering/text-core'
import type { Doc, Ref } from '@hcengineering/core'
import { getCurrentAccount } from '@hcengineering/core'
import { writable, type Readable, type Writable } from 'svelte/store'

export const REVIEW_AGENT_NAMES = ['技术评估Agent', '方案Agent', '合同Agent'] as const
export type ReviewAgentName = (typeof REVIEW_AGENT_NAMES)[number]

export interface ReviewDemandContext {
  channelId: Ref<Doc>
  rootId: Ref<ChatMessage>
  title: string
}

const contexts = new Map<string, Writable<ReviewDemandContext | undefined>>()

function key (channelId: Ref<Doc>): string {
  return `huly.review-demand.${getCurrentAccount().uuid}.${getCurrentWorkspaceUuid()}.${channelId}`
}

function getStore (channelId: Ref<Doc>): Writable<ReviewDemandContext | undefined> {
  const contextKey = key(channelId)
  let store = contexts.get(contextKey)
  if (store === undefined) {
    let initial: ReviewDemandContext | undefined
    try {
      const value = localStorage.getItem(key(channelId))
      if (value != null) initial = JSON.parse(value) as ReviewDemandContext
    } catch {
      // Storage is optional (SSR/private browsing); the channel still works.
    }
    store = writable(initial)
    contexts.set(contextKey, store)
  }
  return store
}

export function reviewDemandStore (channelId: Ref<Doc>): Readable<ReviewDemandContext | undefined> {
  return getStore(channelId)
}

export function setReviewDemand (context: ReviewDemandContext): void {
  const store = getStore(context.channelId)
  store.set(context)
  try {
    localStorage.setItem(key(context.channelId), JSON.stringify(context))
  } catch {
    // A missing localStorage must not block sending a message.
  }
}

export function clearReviewDemand (channelId: Ref<Doc>): void {
  getStore(channelId).set(undefined)
  try {
    localStorage.removeItem(key(channelId))
  } catch {
    // See setReviewDemand.
  }
}

export function isReviewAgentName (name: string): name is ReviewAgentName {
  return (REVIEW_AGENT_NAMES as readonly string[]).includes(name)
}

/**
 * Resolve only structural Person references. Text such as "@方案Agent" without
 * a reference node is deliberately ignored.
 */
export async function findMentionedReviewAgents (message: string): Promise<Array<{ name: ReviewAgentName, person: Person }>> {
  const references = extractReferences(markupToJSON(message))
  const result: Array<{ name: ReviewAgentName, person: Person }> = []
  const client = getClient()
  for (const reference of references) {
    if (!client.getHierarchy().isDerived(reference.objectClass, contact.class.Person)) continue
    const person = await client.findOne(contact.class.Person, { _id: reference.objectId as Ref<Person> })
    const name = person === undefined ? undefined : (isReviewAgentName(person.name) ? person.name : formatName(person.name).trim())
    if (person !== undefined && name !== undefined && isReviewAgentName(name)) {
      result.push({ name, person })
    }
  }
  return result
}
