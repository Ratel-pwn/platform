// Read-only diagnostics for the isolated local test workspace. Never prints credentials.
const fs = require('node:fs')
const path = require('node:path')
const { createRequire } = require('node:module')
const { DatabaseSync } = require('node:sqlite')
const serviceRoot = path.resolve(__dirname, '../../services/agent-review')
const serviceRequire = createRequire(path.join(serviceRoot, 'package.json'))
const state = JSON.parse(fs.readFileSync(path.join(__dirname, 'test-accounts.local.json'), 'utf8'))
const print = console.log.bind(console)
const redact = (text) => String(text).replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[REDACTED_TOKEN]')
for (const key of ['log', 'info', 'warn', 'error']) console[key] = () => {}

async function main () {
  const { connect, connectStorage } = serviceRequire('@hcengineering/api-client')
  const chunter = serviceRequire('@hcengineering/chunter').default
  const attachment = serviceRequire('@hcengineering/attachment').default
  const { markupToText } = serviceRequire('@hcengineering/text')
  const login = { workspace: state.workspaceUrl, email: state.accounts.owner.email, password: state.accounts.owner.password, connectionTimeout: 30000 }
  const client = await connect(state.url, login)
  try {
    const roots = await client.findAll(chunter.class.ChatMessage, { attachedTo: state.channelId })
    const replies = roots.length === 0 ? [] : await client.findAll(chunter.class.ThreadMessage, { attachedTo: { $in: roots.map(root => root._id) } })
    const messages = [...roots, ...replies].sort((a, b) => a.createdOn - b.createdOn)
    const attachments = messages.length === 0 ? [] : await client.findAll(attachment.class.Attachment, { attachedTo: { $in: messages.map(message => message._id) } })
    const db = new DatabaseSync(path.join(serviceRoot, 'data/agent-review.sqlite'), { readOnly: true })
    const tasks = db.prepare('SELECT id, root_id, trigger_id, stage, status, output_message_id, error FROM review_task ORDER BY created_on').all()
    db.close()
    const summary = {
      messages: messages.map(message => ({ id: message._id, class: message._class, parent: message.attachedTo, space: message.space, title: message.reviewDemandTitle, text: markupToText(message.message).slice(0, 160), attachments: attachments.filter(item => item.attachedTo === message._id).map(item => ({ id: item._id, name: item.name, size: item.size })) })),
      tasks
    }
    if (process.argv.includes('--download')) {
      const storage = await connectStorage(state.url, login)
      const outputDirectory = path.join(serviceRoot, 'data/local-verification')
      fs.mkdirSync(outputDirectory, { recursive: true })
      summary.downloads = []
      for (const task of tasks.filter(task => task.output_message_id)) {
        for (const item of attachments.filter(item => item.attachedTo === task.output_message_id)) {
          const chunks = []
          for await (const chunk of await storage.get(item.file)) chunks.push(Buffer.from(chunk))
          const outputPath = path.join(outputDirectory, `${task.stage}-${task.id.slice(0, 8)}${path.extname(item.name)}`)
          fs.writeFileSync(outputPath, Buffer.concat(chunks))
          summary.downloads.push({ path: outputPath, bytes: Buffer.concat(chunks).length })
        }
      }
    }
    print(redact(JSON.stringify(summary, null, 2)))
  } finally { await client.close() }
}
main().catch(error => { print(redact(`FAIL: ${error.message}`)); process.exitCode = 1 })
