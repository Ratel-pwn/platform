// Creates accounts only in this repository's isolated local test environment.
// Credentials are saved to an ignored local file, never printed.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const target = path.join(__dirname, 'test-accounts.local.json')
const endpoint = 'http://huly-review.local:13000'
const definitions = [
  ['owner', 'review-owner@huly.test', '验收成员A'],
  ['member', 'review-member@huly.test', '验收成员B'],
  ['technical', 'review-technical@huly.test', '技术评估Agent'],
  ['solution', 'review-solution@huly.test', '方案Agent'],
  ['contract', 'review-contract@huly.test', '合同Agent']
]
const state = fs.existsSync(target) ? JSON.parse(fs.readFileSync(target, 'utf8')) : { url: 'http://huly-review.local:18087', accounts: {} }
function save () { fs.writeFileSync(target, JSON.stringify(state, null, 2) + '\n') }
async function rpc (method, params, token) {
  const response = await fetch(endpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ method, params }), signal: AbortSignal.timeout(45000)
  })
  if (!response.ok) throw new Error(`${method}: HTTP ${response.status}`)
  const data = await response.json()
  if (data.error) throw new Error(`${method}: ${data.error.code ?? 'RPC error'}`)
  return data.result
}
async function main () {
  const [key, email, name] = definitions[0]
  if (!state.accounts[key]) { state.accounts[key] = { email, name, password: crypto.randomBytes(24).toString('base64url') }; save() }
  const owner = state.accounts[key]
  if (!owner.created) { await rpc('signUp', { email, password: owner.password, firstName: name, lastName: '' }); owner.created = true; save(); console.log('PASS: local test owner created') }
  const login = await rpc('login', { email: owner.email, password: owner.password })
  if (!state.workspaceUrl) {
    const workspaces = await rpc('getUserWorkspaces', {}, login.token)
    const existing = workspaces.find(ws => ws.name === 'Agent 文档评审测试')
    const workspace = existing ?? await rpc('createWorkspace', { workspaceName: 'Agent 文档评审测试', region: 'cockroach' }, login.token)
    state.workspaceUrl = workspace.workspaceUrl ?? workspace.url
    state.workspace = workspace.workspace ?? workspace.uuid
    if (!state.workspaceUrl) throw new Error('Missing workspace URL')
    save()
    console.log('PASS: isolated review workspace requested')
  }
  const selected = await rpc('selectWorkspace', { workspaceUrl: state.workspaceUrl, kind: 'external' }, login.token)
  const info = await rpc('getWorkspaceInfo', {}, selected.token)
  const mode = info.mode ?? info.status?.mode
  console.log(`Workspace: ${state.workspaceUrl}; mode: ${mode}; progress: ${info.progress ?? info.status?.progress ?? 'unknown'}`)
  if (mode !== 'active') { console.log('Workspace initialization still running; rerun this script after it becomes active.'); return }
  for (const [id, memberEmail, memberName] of definitions.slice(1)) {
    if (!state.accounts[id]) { state.accounts[id] = { email: memberEmail, name: memberName, password: crypto.randomBytes(24).toString('base64url') }; save() }
    const account = state.accounts[id]
    if (account.created) continue
    const inviteId = await rpc('createInvite', { exp: 3600000, emailMask: memberEmail, limit: 1, role: 'USER' }, selected.token)
    await rpc('signUpJoin', { email: memberEmail, password: account.password, first: memberName, last: '', inviteId, workspaceUrl: state.workspaceUrl })
    account.created = true
    save()
    console.log(`PASS: ${memberName} joined local test workspace`)
  }
  console.log('PASS: local account setup complete; credentials saved in ignored test-accounts.local.json')
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
