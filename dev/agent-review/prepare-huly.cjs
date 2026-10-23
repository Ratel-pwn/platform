// Generates an isolated test Compose file from the repository's own dev stack.
// It does not build images, install dependencies, start containers or read .env.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const root = path.resolve(__dirname, '../..')
const project = 'huly-chat-review'
const host = 'huly-review.local'
const applications = {
  account: 'pods/account',
  workspace_cockroach: 'pods/workspace',
  collaborator: 'pods/collaborator',
  front: 'pods/front',
  transactor_cockroach: 'pods/server',
  stats: 'pods/stats',
  datalake: 'services/datalake/pod-datalake',
  'process-service': 'services/process',
  'events-processor': 'services/notification/pod-events-processor',
  'time-machine': 'services/worker',
  rating_cockroach: 'services/rating',
  fulltext_cockroach: 'pods/fulltext',
  hulylake: 'foundations/hulylake',
  hulypulse: 'foundations/hulypulse'
}
const infrastructure = ['cockroach', 'redpanda', 'minio', 'redis', 'elastic']
const selected = new Set([...Object.keys(applications), ...infrastructure])
const sourcePath = path.join(__dirname, 'huly-base.local.json')
const revisionPath = path.join(__dirname, 'huly-revision.local.txt')
if (!fs.existsSync(sourcePath) || !fs.existsSync(revisionPath)) throw new Error('请先按本地操作说明导出 Compose 基线与 Git 提交号')
const base = JSON.parse(fs.readFileSync(sourcePath, 'utf8').replace(/^\uFEFF/, ''))
const revision = fs.readFileSync(revisionPath, 'utf8').trim()
if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error('Git 提交号无效')
const sourceHash = crypto.createHash('sha256')
for (const file of ['plugins/chunter/src/index.ts', 'models/chunter/src/types.ts', 'plugins/chunter-resources/src/components/Channel.svelte', 'plugins/chunter-resources/src/components/chat-message/ChatMessageInput.svelte', 'plugins/chunter-resources/src/reviewDemand.ts']) {
  sourceHash.update(file).update(fs.readFileSync(path.join(root, file)))
}
const patchHash = sourceHash.digest('hex')
const stamp = `${revision.slice(0, 12)}-${patchHash.slice(0, 8)}`
const variables = {
  DB_CR_URL: 'postgresql://root@cockroach:26257/defaultdb?sslmode=disable',
  QUEUE_CONFIG: 'redpanda:9092',
  STORAGE_CONFIG: 'datalake|http://datalake:4030',
  BACKUP_STORAGE_CONFIG: 'minio|minio:9000?accessKey=minioadmin&secretKey=minioadmin',
  BACKUP_BUCKET_NAME: 'backups',
  PLATFORM_ADMIN_EMAILS: ''
}
const portServices = {
  3000: 'account', 3332: 'transactor_cockroach', 4030: 'datalake',
  4900: 'stats', 8096: 'hulylake', 8099: 'hulypulse', 3078: 'collaborator',
  4702: 'fulltext_cockroach', 9200: 'elastic'
}
function rewrite (value, external) {
  if (typeof value !== 'string') return value
  const expanded = value.replace(/\$\{([^}]+)\}/g, (_, key) => {
    if (!(key in variables)) throw new Error(`未定义的环境占位符：${key}`)
    return variables[key]
  })
  return expanded.replace(/huly\.local:(\d+)/g, (_, port) =>
    !external && portServices[port] ? `${portServices[port]}:${port}` : `${host}:${Number(port) + 10000}`)
}
const services = {}
const volumes = {}
for (const name of selected) {
  const service = base.services[name]
  if (!service) throw new Error(`dev 配置缺少服务：${name}`)
  delete service.container_name
  delete service.links
  delete service.profiles
  service.restart = 'unless-stopped'
  service.networks = { default: null }
  service.extra_hosts = [`${host}:host-gateway`]
  if (service.depends_on) service.depends_on = Object.fromEntries(Object.entries(service.depends_on).filter(([dep]) => selected.has(dep)))
  // Infrastructure remains private. Only endpoints needed by browser/API clients
  // are published, under distinct test ports.
  if (infrastructure.includes(name)) delete service.ports
  else if (service.ports) service.ports = service.ports.slice(0, 1).map((port) => ({
    target: port.target, published: String(Number(port.published) + 10000), host_ip: '127.0.0.1', protocol: 'tcp'
  }))
  if (service.environment) {
    const entries = Array.isArray(service.environment)
      ? service.environment.map((entry) => {
        const separator = entry.indexOf('=')
        if (separator < 1) throw new Error(`服务 ${name} 有无值环境变量，不能用于独立测试配置`)
        return [entry.slice(0, separator), entry.slice(separator + 1)]
      })
      : Object.entries(service.environment)
    service.environment = Object.fromEntries(entries.map(([key, value]) => [
      key, rewrite(value, name === 'front' || (name === 'account' && ['TRANSACTOR_URL', 'FRONT_URL'].includes(key)))
    ]))
  }
  if (service.environment) delete service.environment.OTEL_EXPORTER_OTLP_ENDPOINT
  if (service.volumes) {
    for (const mount of service.volumes) {
      if (mount.type === 'volume') volumes[mount.source] = { name: `${project}-${mount.source}` }
      else mount.read_only = true
    }
  }
  if (applications[name]) {
    service.build = { context: path.join(root, applications[name]), dockerfile: 'Dockerfile' }
    service.image = `huly-chat-review/${name.replaceAll('_', '-')}:${stamp}`
    service.pull_policy = 'never'
  }
  services[name] = service
}
// Both official container registries reject the old dev image. Wrap an official
// release binary verified by prepare-minio.ps1; no host executable is installed.
services.minio.build = { context: path.join(__dirname, 'minio'), dockerfile: 'Dockerfile' }
services.minio.image = 'huly-chat-review/minio:RELEASE.2025-09-07T16-13-09Z'
services.minio.pull_policy = 'never'
services.minio.healthcheck.test = ['CMD', 'curl', '--fail', '--silent', 'http://localhost:9000/minio/health/live']
// The dev stack's health probe sends SASL credentials to an unauthenticated
// broker and reports a false failure. Probe the isolated internal listener.
services.redpanda.healthcheck.test = ['CMD', 'rpk', 'cluster', 'info', '--brokers', 'redpanda:9092']
// Search is required for the current editor's structural @Person picker.
// These endpoints are internal; the browser does not connect to Elasticsearch.
delete services.fulltext_cockroach.ports
// The local workspace worker performs initialization only; no backup service is
// part of this bounded chat test environment.
services.workspace_cockroach.environment.WS_OPERATION = 'all'
const compose = { name: project, services, volumes, networks: { default: { name: `${project}-network` } } }
const output = path.join(__dirname, 'huly.compose.local.json')
fs.writeFileSync(output, JSON.stringify(compose, null, 2) + '\n')
fs.writeFileSync(path.join(__dirname, 'huly-source.local.json'), JSON.stringify({ revision, stamp, generatedAt: new Date().toISOString(), chatSourceHash: patchHash }, null, 2) + '\n')
console.log(`已生成独立测试配置：${output}`)
console.log('前端端口 18087；容器、网络、卷均使用 huly-chat-review 前缀。未构建或启动。')

// Rush's frontend package script uses Unix utilities. Copy its prepared assets
// natively on Windows only after the user has run the documented package step.
if (process.argv.includes('--copy-front')) {
  const sourceDist = path.join(root, 'dev/prod/dist')
  if (!fs.existsSync(sourceDist)) throw new Error('请先手动执行 prod package，缺少 dev/prod/dist')
  const destination = path.join(root, 'pods/front/dist')
  fs.cpSync(sourceDist, destination, { recursive: true })
  fs.cpSync(path.join(root, 'dev/prod/public'), destination, { recursive: true })
  const configFile = path.join(destination, 'config.json')
  if (fs.existsSync(configFile)) fs.unlinkSync(configFile)
  console.log('已复制本次构建的前端资源到 pods/front/dist。')
}
