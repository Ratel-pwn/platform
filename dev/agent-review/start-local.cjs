// Windows helper: starts existing local images and never builds artifacts.
const fs = require('node:fs')
const path = require('node:path')
const { spawn, spawnSync } = require('node:child_process')
const { setTimeout: delay } = require('node:timers/promises')
const serviceDir = path.resolve(__dirname, '../../services/agent-review')
const composeFile = path.join(__dirname, 'huly.compose.local.json')
const bundleFile = path.join(serviceDir, 'bundle/bundle.js')
const processFile = path.join(__dirname, 'agent-process.local.json')
const stdoutLog = path.join(__dirname, 'agent-stdout.local.log')
const stderrLog = path.join(__dirname, 'agent-stderr.local.log')
const options = new Set(process.argv.slice(2))
function readJson (file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')) } catch {
    throw new Error('Missing or invalid JSON: ' + path.basename(file))
  }
}
function run (executable, args) {
  const result = spawnSync(executable, args, { cwd: serviceDir, stdio: 'inherit', windowsHide: true, timeout: 180000 })
  if (result.error || result.status !== 0) throw new Error('Command failed: ' + path.basename(executable) + ' ' + args[0])
}
function alive (pid) {
  try { process.kill(pid, 0); return true } catch (error) {
    if (error.code === 'ESRCH') return false
    throw new Error('Cannot verify the recorded Agent process; inspect it before retrying.')
  }
}
function openBrowser (url) {
  run('powershell.exe', ['-NoProfile', '-Command', "Start-Process -FilePath '" + url.replace(/'/g, "''") + "'"])
}
async function main () {
  if (process.platform !== 'win32') throw new Error('This helper requires Windows.')
  for (const option of options) {
    if (!['--open-browser', '--foreground'].includes(option)) throw new Error('Unknown option: ' + option)
  }
  for (const file of [composeFile, bundleFile]) {
    if (!fs.existsSync(file)) throw new Error('Missing ' + file + '; follow the local setup guide first.')
  }
  const runtime = readJson(path.join(serviceDir, 'runtime.config.local.json'))
  if (readJson(composeFile).name !== 'huly-chat-review') throw new Error('Expected isolated Compose project huly-chat-review.')
  const url = new URL(runtime.huly.url)
  if (url.hostname !== 'huly-review.local' || url.port !== '18087' || url.protocol !== 'http:' || url.username || url.password) {
    throw new Error('Expected local Huly URL http://huly-review.local:18087.')
  }
  if (fs.existsSync(processFile)) {
    const previous = readJson(processFile)
    if (!Number.isSafeInteger(previous.pid) || previous.pid <= 0) throw new Error('Invalid Agent PID record; inspect it before retrying.')
    if (alive(previous.pid)) throw new Error('Recorded PID ' + previous.pid + ' is active; inspect it before starting another Agent.')
  }
  run(process.execPath, ['scripts/preflight.cjs'])
  console.log('Starting isolated Huly containers...')
  run('docker', ['compose', '-f', composeFile, 'up', '-d', '--no-build', '--pull', 'never'])
  const deadline = Date.now() + 180000
  let ready = false
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5000) })
      ready = response.ok
      await response.body?.cancel()
      if (ready) break
    } catch {}
    await delay(3000)
  }
  if (!ready) throw new Error('Huly front did not respond within 180 seconds; inspect Compose logs.')
  run(process.execPath, ['bundle/check.js', '--huly'])
  const channelUrl = new URL('/workbench/' + encodeURIComponent(runtime.huly.workspace) + '/chunter/' + encodeURIComponent(runtime.huly.enabledChannels[0] + '|chunter:class:Channel'), url).href
  if (options.has('--foreground')) {
    if (options.has('--open-browser')) openBrowser(channelUrl)
    const child = spawn(process.execPath, [bundleFile], { cwd: serviceDir, stdio: 'inherit', windowsHide: true })
    child.on('error', () => { console.error('Agent launch failed.'); process.exitCode = 1 })
    child.on('exit', code => { process.exitCode = code ?? 1 })
    return
  }
  const output = fs.openSync(stdoutLog, 'a')
  const errors = fs.openSync(stderrLog, 'a')
  const offset = fs.statSync(stdoutLog).size
  let child
  try {
    child = spawn(process.execPath, [bundleFile], { cwd: serviceDir, detached: true, windowsHide: true, stdio: ['ignore', output, errors] })
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject) })
  } finally {
    fs.closeSync(output)
    fs.closeSync(errors)
  }
  try {
    fs.writeFileSync(processFile, JSON.stringify({ pid: child.pid, startedAt: new Date().toISOString(), script: bundleFile }, null, 2) + '\n')
    const deadline = Date.now() + 60000
    let started = false
    while (Date.now() < deadline) {
      if (child.exitCode !== null || child.signalCode !== null) break
      if (fs.readFileSync(stdoutLog).subarray(offset).toString('utf8').includes('agent-review started')) { started = true; break }
      await delay(1000)
    }
    if (!started) throw new Error('Agent did not confirm startup within 60 seconds; inspect local logs.')
  } catch (error) {
    if (child.exitCode === null && child.signalCode === null) child.kill()
    fs.rmSync(processFile, { force: true })
    throw error
  }
  child.unref()
  console.log('Agent ready (PID ' + child.pid + '). Logs: ' + stdoutLog + ' and ' + stderrLog)
  if (options.has('--open-browser')) openBrowser(channelUrl)
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
