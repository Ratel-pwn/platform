import { connect, connectStorage, type PlatformClient, type StorageClient } from '@hcengineering/api-client'
import activity from '@hcengineering/activity'
import attachment from '@hcengineering/attachment'
import contact, { formatName } from '@hcengineering/contact'
import chunter, { type ChatMessage, type ThreadMessage } from '@hcengineering/chunter'
import { jsonToMarkup } from '@hcengineering/text'
import { markdownToMarkup } from '@hcengineering/text-markdown'
import type { Doc, Ref } from '@hcengineering/core'
import type { BotCredential, ReviewMessage } from './types'
import type { AttachmentInput } from './attachments'
import { readAttachment } from './attachments'

export class HulyBotClient {
  private constructor (readonly client: PlatformClient, readonly storage: StorageClient, readonly name: string, readonly socialIds: Set<string>, readonly personId: string) {}

  static async connect (url: string, workspace: string, name: string, credentials: BotCredential): Promise<HulyBotClient> {
    const client = await connect(url, { workspace, email: credentials.email, password: credentials.password })
    const storage = await connectStorage(url, { workspace, email: credentials.email, password: credentials.password })
    const account = await client.getAccount()
    if (account.socialIds.length === 0) throw new Error(`机器人 ${name} 没有可用于结构化提及的身份`)
    const person = await client.findOne(contact.class.Person, { personUuid: account.uuid })
    if (person === undefined || (person.name !== name && formatName(person.name).trim() !== name)) throw new Error(`机器人账号与 ${name} 的人员身份不匹配`)
    return new HulyBotClient(client, storage, name, new Set(account.socialIds.map(String)), String(person._id))
  }

  async messages (channelId: Ref<Doc>, rootIds: Array<Ref<ChatMessage>>, after: number): Promise<ReviewMessage[]> {
    const attachedTo = rootIds.length > 0 ? { $in: [channelId, ...rootIds] } : channelId
    const messages = await this.client.findAll(activity.class.ActivityMessage, { attachedTo, createdOn: { $gt: after } }, { sort: { createdOn: 1 } })
    return messages.filter((message): message is ReviewMessage =>
      message._class === chunter.class.ChatMessage || message._class === chunter.class.ThreadMessage
    )
  }

  async reply (root: ChatMessage, message: string): Promise<Ref<ThreadMessage>> {
    return await this.client.addCollection(chunter.class.ThreadMessage, root.space, root._id, root._class, 'replies', {
      message: jsonToMarkup(markdownToMarkup(message, { refUrl: '', imageUrl: '' })),
      attachments: 0,
      objectId: root.attachedTo,
      objectClass: root.attachedToClass
    })
  }

  async replyWithDocuments (root: ChatMessage, markdown: string, docx: Buffer): Promise<Ref<ThreadMessage>> {
    const replyId = await this.reply(root, markdown)
    const markdownBlob = await this.storage.put(`${replyId}.md`, Buffer.from(markdown, 'utf8'), 'text/markdown')
    const docxBlob = await this.storage.put(`${replyId}.docx`, docx, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    for (const [name, blob, type] of [
      [`${root.reviewDemandTitle ?? 'review'}.md`, markdownBlob, 'text/markdown'],
      [`${root.reviewDemandTitle ?? 'review'}.docx`, docxBlob, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
    ] as const) {
      await this.client.addCollection(attachment.class.Attachment, root.space, replyId, chunter.class.ThreadMessage, 'attachments', {
        name,
        file: blob._id,
        size: blob.size,
        type,
        lastModified: Date.now()
      })
    }
    return replyId
  }

  async attachmentSnapshot (messageId: Ref<Doc>): Promise<Array<{ id: string, name: string, file: string, type: string }>> {
    const items = await this.client.findAll(attachment.class.Attachment, { attachedTo: messageId })
    return items.map((item) => ({ id: String(item._id), name: item.name, file: String(item.file), type: item.type }))
  }

  async readAttachments (items: Array<{ id: string, name: string, file: string, type: string }>): Promise<AttachmentInput[]> {
    const result: AttachmentInput[] = []
    for (const item of items) result.push(await readAttachment(this.storage, item))
    return result
  }
}
