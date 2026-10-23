import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import chunter, { type ChatMessage } from '@hcengineering/chunter'
import contact from '@hcengineering/contact'
import { loadConfig } from './config'
import { openReviewDb, type ReviewDb } from './db'
import { HulyBotClient } from './huly'
import { structuralAgents } from './mentions'
import { runPi } from './pi'
import { loadReferenceMaterials } from './references'
import { Document, Packer, Paragraph } from 'docx'
import { markupToText } from '@hcengineering/text'
import { AGENTS, type AgentName, type RuntimeConfig, type ReviewMessage } from './types'
import { hashInput, rootIdForMessage, stageForAgent } from './workflow'

export class AgentReviewService {
  private readonly clients = new Map<AgentName, HulyBotClient>()
  private timer: NodeJS.Timeout | undefined
  private running = 0
  private polling = false
  private db!: ReviewDb

  async start (): Promise<void> {
    const config = await loadConfig()
    this.db = await openReviewDb(join(config.runtime.dataDir, 'agent-review.sqlite'))
    for (const name of AGENTS) this.clients.set(name, await HulyBotClient.connect(config.runtime.huly.url, config.runtime.huly.workspace, name, config.runtime.bots[name]))
    console.info('agent-review started', { channels: config.runtime.huly.enabledChannels.length, maxConcurrency: config.runtime.maxConcurrency })
    this.timer = setInterval(() => { void this.poll(config.runtime).catch((error) => console.error('agent-review poll failed:', error instanceof Error ? error.message : error)) }, config.runtime.huly.pollIntervalMs)
    await this.poll(config.runtime)
  }

  async stop (): Promise<void> {
    if (this.timer !== undefined) clearInterval(this.timer)
    this.db?.close()
    for (const client of this.clients.values()) await client.client.close()
  }

  private async poll (runtime: RuntimeConfig): Promise<void> {
    if (this.polling || this.running >= runtime.maxConcurrency) return
    this.polling = true
    try {
      for (const channelId of runtime.huly.enabledChannels) {
        const reader = this.clients.get('技术评估Agent')
        if (reader === undefined) continue
        const cursor = this.db.getCursor(channelId)
        const roots = (await reader.client.findAll<ChatMessage>(chunter.class.ChatMessage, {
          attachedTo: channelId
        })).filter((root) => root.reviewDemandTitle !== undefined)
        const messages = await reader.messages(channelId, roots.map((root) => root._id), cursor.createdOn)
        for (const message of messages) {
          const accepted = await this.dispatch(runtime, channelId, message)
          if (!accepted) break
          this.db.setCursor(channelId, message.createdOn ?? cursor.createdOn, String(message._id))
        }
      }
    } finally {
      this.polling = false
    }
  }

  private async dispatch (runtime: RuntimeConfig, channelId: string, message: ReviewMessage): Promise<boolean> {
    if (this.running >= runtime.maxConcurrency) return false
    if (message.createdBy === undefined || [...this.clients.values()].some((client) => client.socialIds.has(String(message.createdBy)))) return true
    const reader = this.clients.get('技术评估Agent')
    if (reader === undefined) return true
    const identity = await reader.client.findOne(contact.class.SocialIdentity, { _id: message.createdBy })
    const sender = identity === undefined
      ? undefined
      : await reader.client.findOne(contact.class.Person, { _id: identity.attachedTo })
    const channel = await reader.client.findOne(chunter.class.Channel, { _id: channelId as any })
    if (sender?.personUuid === undefined || channel === undefined || !channel.members.includes(sender.personUuid)) return true
    const rootId = rootIdForMessage(message)
    const root = await reader.client.findOne<ChatMessage>(chunter.class.ChatMessage, { _id: rootId as any })
    if (root === undefined || root.reviewDemandTitle === undefined) return true
    const agents = await structuralAgents(reader.client, message.message, new Map([...this.clients].map(([name, bot]) => [bot.personId, name])))
    if (agents.length === 0) return true
    if (agents.length > 1) {
      await reader.reply(root, '请一次只 @ 一个文档评审 Agent；本条消息未启动评审。')
      return true
    }
    const agent = agents[0]
    const stage = stageForAgent(agent)
    if (!this.db.hasReadyStage(rootId, stage)) {
      await reader.reply(root, `当前还没有可确认的上游定稿，无法启动${agent}。`)
      return true
    }
    const taskId = randomUUID()
    let snapshots: Array<{ id: string, name: string, file: string, type: string }>
    let inputs: Array<{ name: string, text: string, sha256: string }>
    try {
      snapshots = await reader.attachmentSnapshot(message._id)
      if (agent !== '技术评估Agent' && snapshots.length === 0) {
        await reader.reply(root, '交接未启动：请附上一份 DOCX 或 Markdown 定稿文件。')
        return true
      }
      const allowed = agent === '技术评估Agent' ? /\.(docx|md|markdown|pdf)$/i : /\.(docx|md|markdown)$/i
      if (snapshots.some((file) => !allowed.test(file.name))) {
        await reader.reply(root, agent === '技术评估Agent' ? '评审未启动：首版只接受 DOCX、文字 PDF 或 Markdown 附件。' : '交接未启动：首版只接受 DOCX 或 Markdown 定稿文件。')
        return true
      }
      inputs = agent === '技术评估Agent' || snapshots.length > 0 ? await reader.readAttachments(snapshots) : []
    } catch (error: any) {
      await reader.reply(root, `附件读取失败：${error instanceof Error ? error.message : String(error)}`)
      return true
    }
    if (agent === '合同Agent' && message.message.includes('确认定稿')) {
      const contractTask = this.db.latestTaskId(rootId, 'contract')
      if (contractTask === undefined) {
        await reader.reply(root, '还没有可确认的合同草稿。')
        return true
      }
      this.db.recordConfirmation(contractTask, String(message.createdBy), inputs[0]?.name, inputs[0]?.sha256)
      this.db.updateStatus(contractTask, 'completed')
      await reader.reply(root, '合同定稿已记录，文档评审完成。')
      return true
    }
    const inputHash = hashInput([message.message, ...inputs.flatMap((file) => [file.sha256, file.name])])
    const reusable = message.message.includes('重新运行') || message.message.includes('重跑')
      ? undefined
      : this.db.findReusableTask(rootId, stage, inputHash)
    if (reusable !== undefined) {
      await reader.reply(root, `相同输入已存在评审任务（${reusable.status}），本次提交复用已有记录。`)
      return true
    }
    if (this.running >= runtime.maxConcurrency) return false
    const inserted = this.db.insertTask({ id: taskId, rootId, channelId, triggerId: String(message._id), sender: String(message.createdBy), agent, stage, inputHash, status: 'queued' })
    if (!inserted) return true
    this.db.insertSnapshots(taskId, inputs.map((input, index) => ({ id: snapshots[index].id, name: input.name, sha256: input.sha256 })))
    this.running++
    void this.runTask(runtime, taskId, root, message, agent, inputs)
      .catch(() => { console.error('任务结果或错误消息回写失败，请检查 Huly 连接；本任务需要人工复核。') })
      .finally(() => { this.running-- })
    return true
  }

  private async runTask (runtime: RuntimeConfig, taskId: string, root: ChatMessage, trigger: ReviewMessage, agent: AgentName, inputs: Array<{ name: string, text: string, sha256: string }>): Promise<void> {
    const reader = this.clients.get(agent)
    if (reader === undefined) return
    const stage = stageForAgent(agent)
    this.db.updateStatus(taskId, 'running')
    try {
      const inputText = [
        `原始需求：${markupToText(root.message)}`,
        `本次指令：${markupToText(trigger.message)}`,
        ...inputs.map((input) => `\n附件：${input.name}\n${input.text}`)
      ].join('\n')
      const references = await loadReferenceMaterials(runtime.references[stage])
      const output = await runPi((await loadConfig()).api, stage, root.reviewDemandTitle ?? '', inputText, [references])
      const docx = await Packer.toBuffer(new Document({ sections: [{ children: output.split(/\r?\n/).map((line) => new Paragraph(line)) }] }))
      const outputId = await reader.replyWithDocuments(root, output, docx)
      this.db.updateStatus(taskId, 'awaiting-human', undefined, String(outputId))
    } catch (error: any) {
      this.db.updateStatus(taskId, 'failed', error instanceof Error ? error.message : String(error))
      await reader.reply(root, `评审执行失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }
}
