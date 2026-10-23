import { resolve } from 'node:path'
import { readFile } from 'node:fs/promises'
import chunter from '@hcengineering/chunter'
import { loadApiConfig } from './config'
import { HulyBotClient } from './huly'
import { runPiPrompt } from './pi'
import { AGENTS, type RuntimeConfig } from './types'

async function main (): Promise<void> {
  const configRoot = process.env.AGENT_REVIEW_CONFIG_DIR ?? resolve(__dirname, '..')
  const mode = process.argv[2]
  if (mode === '--model') {
    const api = await loadApiConfig(configRoot)
    console.info('正在通过 Pi 发出一条短请求；不读取参考资料，不发送 Huly 消息。')
    await runPiPrompt({ ...api, maxOutputTokens: Math.min(api.maxOutputTokens, 128) }, '请只回复：Pi 接入测试通过。')
    console.info('PASS：Pi 使用本地 API 配置返回了有效文字。')
    return
  }
  if (mode !== '--channels' && mode !== '--huly') {
    throw new Error('用法：node bundle/check.js --model | --channels | --huly')
  }
  const runtime: RuntimeConfig = JSON.parse(await readFile(resolve(configRoot, 'runtime.config.local.json'), 'utf8'))
  const names = mode === '--channels' ? [AGENTS[0]] : AGENTS
  if (mode === '--huly' && runtime.huly.enabledChannels.length === 0) throw new Error('请先填写 enabledChannels')
  for (const name of names) {
    const bot = await HulyBotClient.connect(runtime.huly.url, runtime.huly.workspace, name, runtime.bots[name])
    try {
      const account = await bot.client.getAccount()
      const channels = await bot.client.findAll(chunter.class.Channel, {})
      const joined = channels.filter((channel) => channel.members.includes(account.uuid))
      if (mode === '--channels') {
        console.table(joined.map((channel) => ({ channel: channel.name, id: String(channel._id) })))
        if (joined.length === 0) throw new Error('技术评估Agent 尚未加入任何频道')
      } else {
        for (const id of runtime.huly.enabledChannels) {
          if (!joined.some((channel) => String(channel._id) === String(id))) {
            throw new Error(`${name} 未加入某个启用频道，或配置的频道 ID 无效`)
          }
        }
        console.info(`PASS：${name} 身份匹配，并已加入启用频道。`)
      }
    } finally {
      await bot.client.close()
    }
  }
}

void main().catch(() => {
  // SDK/network errors can contain credentials or tokens; expose only a useful
  // category here. Keep terminal output safe to share during troubleshooting.
  console.error('FAIL：检查未通过。--model 请检查依赖/API 配置；--channels/--huly 请检查 Huly 地址、工作区 URL 名称、机器人身份和频道成员。')
  process.exitCode = 1
})
