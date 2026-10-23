// Completes local fixtures and runtime configuration without reading model keys.
const fs = require('node:fs')
const path = require('node:path')
const { createRequire } = require('node:module')
const serviceRoot = path.resolve(__dirname, '../../services/agent-review')
const serviceRequire = createRequire(path.join(serviceRoot, 'package.json'))
const { connect } = serviceRequire('@hcengineering/api-client')
const chunter = serviceRequire('@hcengineering/chunter').default
const core = serviceRequire('@hcengineering/core').default
const contactModule = serviceRequire('@hcengineering/contact')
const contact = contactModule.default
const statePath = path.join(__dirname, 'test-accounts.local.json')
const state = JSON.parse(fs.readFileSync(statePath, 'utf8'))
async function main () {
  const clients = []
  try {
    for (const account of Object.values(state.accounts)) {
      if (!account.created) throw new Error('Run prepare-accounts.cjs first')
      const client = await connect(state.url, { workspace: state.workspaceUrl, email: account.email, password: account.password, connectionTimeout: 30000 })
      clients.push(client)
      const identity = await client.getAccount()
      account.uuid = identity.uuid
      // The browser normally creates local Person/SocialIdentity/Employee on
      // first workspace login. The API client does not perform that UI step.
      let person = await client.findOne(contact.class.Person, { personUuid: identity.uuid })
      if (!person) {
        const personId = await client.createDoc(contact.class.Person, contact.space.Contacts, {
          personUuid: identity.uuid, name: contactModule.combineName(account.name, ''), city: '', avatarType: contactModule.AvatarType.COLOR
        })
        person = await client.findOne(contact.class.Person, { _id: personId })
      }
      for (const social of identity.fullSocialIds) {
        if (await client.findOne(contact.class.SocialIdentity, { _id: social._id })) continue
        await client.addCollection(contact.class.SocialIdentity, contact.space.Contacts, person._id, contact.class.Person, 'socialIds', {
          type: social.type, value: social.value, key: social.key, verifiedOn: social.verifiedOn, isDeleted: social.isDeleted ?? false
        }, social._id)
      }
      const employee = await client.findOne(contact.mixin.Employee, { _id: person._id })
      if (!employee || !serviceRequire('@hcengineering/core').Hierarchy.hasMixin(employee, contact.mixin.Employee) || !employee.active) {
        await client.createMixin(person._id, contact.class.Person, contact.space.Contacts, contact.mixin.Employee, { active: true, role: 'USER' })
      }
      console.log(`PASS: ${account.name} connected to local workspace`)
    }
    const owner = clients[0]
    const existing = await owner.findOne(chunter.class.Channel, { name: 'Agent 文档评审测试' })
    const members = Object.values(state.accounts).map(account => account.uuid)
    state.channelId = existing?._id ?? await owner.createDoc(chunter.class.Channel, core.space.Space, {
      name: 'Agent 文档评审测试', description: '独立本地测试频道', private: false,
      archived: false, members, owners: [state.accounts.owner.uuid], topic: '群聊 @Agent 文档评审验收', autoJoin: false
    })
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n')
    console.log(`PASS: test channel ready (${state.channelId})`)
    const runtimePath = path.join(serviceRoot, 'runtime.config.local.json')
    if (!fs.existsSync(runtimePath)) {
      const runtime = JSON.parse(fs.readFileSync(path.join(serviceRoot, 'runtime.config.example.json'), 'utf8'))
      runtime.huly.url = state.url
      runtime.huly.workspace = state.workspaceUrl
      runtime.huly.enabledChannels = [state.channelId]
      for (const id of ['technical', 'solution', 'contract']) {
        const account = state.accounts[id]
        runtime.bots[account.name] = { email: account.email, password: account.password }
      }
      runtime.dataDir = path.join(serviceRoot, 'data').replaceAll('\\', '/')
      runtime.maxConcurrency = 1
      fs.writeFileSync(runtimePath, JSON.stringify(runtime, null, 2) + '\n')
      console.log('PASS: ignored runtime.config.local.json created; model API file untouched')
    } else console.log('Existing runtime.config.local.json preserved')
  } finally { await Promise.allSettled(clients.map(client => client.close())) }
}
main().catch(() => { console.error('FAIL: local channel setup did not complete; check local endpoints and account setup'); process.exitCode = 1 })
