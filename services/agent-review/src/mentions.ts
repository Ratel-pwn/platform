import contact from '@hcengineering/contact'
import { markupToJSON } from '@hcengineering/text'
import { extractReferences } from '@hcengineering/text-core'
import type { PlatformClient } from '@hcengineering/api-client'
import type { AgentName } from './types'

export async function structuralAgents (client: PlatformClient, message: string, identities: ReadonlyMap<string, AgentName>): Promise<AgentName[]> {
  const result: AgentName[] = []
  for (const reference of extractReferences(markupToJSON(message))) {
    if (!client.getHierarchy().isDerived(reference.objectClass, contact.class.Person)) continue
    const agent = identities.get(String(reference.objectId))
    if (agent !== undefined) result.push(agent)
  }
  return [...new Set(result)]
}
