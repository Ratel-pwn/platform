const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
let failures = 0
function check (label, ok) {
  console.log(`${ok ? 'PASS' : 'PENDING'}：${label}`)
  if (!ok) failures++
}
function readConfig (name) {
  const filename = path.join(root, name)
  if (!fs.existsSync(filename)) { check(`${name} 已存在`, false); return }
  try { return JSON.parse(fs.readFileSync(filename, 'utf8').replace(/^\uFEFF/, '')) } catch {
    check(`${name} 是有效 JSON（未输出内容）`, false)
  }
}

const nodeVersion = process.versions.node.split('.').map(Number)
check('Node.js 至少为 22.19.0', nodeVersion[0] > 22 || (nodeVersion[0] === 22 && nodeVersion[1] >= 19))
const api = readConfig('api.config.local.json')
if (api) {
  check('API 必填字段齐全（不显示密钥）', ['provider', 'apiType', 'baseUrl', 'model', 'apiKey'].every((key) => typeof api[key] === 'string' && api[key].trim().length > 0) && !api.baseUrl?.includes('example.invalid'))
  check('API 超时和输出限制为正整数', ['timeoutMs', 'maxOutputTokens'].every((key) => Number.isSafeInteger(api[key]) && api[key] > 0))
}
if (!process.argv.includes('--api-only')) {
  const runtime = readConfig('runtime.config.local.json')
  if (runtime) {
    check('Huly 地址和工作区已填写', typeof runtime.huly?.url === 'string' && /^https?:\/\//.test(runtime.huly.url) && typeof runtime.huly.workspace === 'string' && runtime.huly.workspace.length > 0 && !runtime.huly.workspace.includes('填写'))
    check('至少填写一个字符串频道 ID', Array.isArray(runtime.huly?.enabledChannels) && runtime.huly.enabledChannels.length > 0 && runtime.huly.enabledChannels.every((id) => typeof id === 'string' && id.length > 0))
    check('三个机器人登录信息已填写', ['技术评估Agent', '方案Agent', '合同Agent'].every((name) => ['email', 'password'].every((key) => typeof runtime.bots?.[name]?.[key] === 'string' && runtime.bots[name][key].length > 0 && !runtime.bots[name][key].includes('填写'))))
    check('轮询间隔和并发数为正整数', Number.isSafeInteger(runtime.huly?.pollIntervalMs) && runtime.huly.pollIntervalMs > 0 && Number.isSafeInteger(runtime.maxConcurrency) && runtime.maxConcurrency > 0)
    const references = ['technical', 'solution', 'contract'].flatMap((stage) => Array.isArray(runtime.references?.[stage]) ? runtime.references[stage] : [])
    check('三个阶段都有参考文件清单', ['technical', 'solution', 'contract'].every((stage) => Array.isArray(runtime.references?.[stage]) && runtime.references[stage].length > 0))
    check('参考文件可访问（Docker 的 /app 路径按挂载检查）', references.length > 0 && references.every((file) => {
      if (typeof file !== 'string') return false
      let source = file
      if (file === '/app/方案编写参考.md') source = path.resolve(root, '../../方案编写参考.md')
      if (file === '/app/references/技术评估案例.docx') source = 'D:/零律/企业内部知识库问答系统技术评估案例-v1.0.docx'
      if (file.startsWith('/app/references/software-development-contract/')) source = path.join('D:/零律/合同 skill/software-development-contract', file.slice('/app/references/software-development-contract/'.length))
      try { return fs.statSync(path.resolve(root, source)).isFile() } catch { return false }
    }))
  }
  check('服务依赖已安装', fs.existsSync(path.join(root, 'node_modules/@earendil-works/pi-coding-agent/package.json')))
  check('服务和检查入口已打包', ['bundle/bundle.js', 'bundle/check.js'].every((file) => fs.existsSync(path.join(root, file))))
}
console.log('此检查没有调用模型、连接 Huly、安装依赖或执行构建。')
process.exitCode = failures > 0 ? 1 : 0
