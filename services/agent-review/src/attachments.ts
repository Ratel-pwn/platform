import { createHash } from 'node:crypto'
import type { StorageClient } from '@hcengineering/api-client'

export interface AttachmentInput {
  id: string
  name: string
  file: string
  type: string
  sha256: string
  text: string
}

export async function readAttachment (storage: StorageClient, item: { id: string, name: string, file: string, type: string }): Promise<AttachmentInput> {
  const stream = await storage.get(item.file)
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  const buffer = Buffer.concat(chunks)
  const sha256 = createHash('sha256').update(buffer).digest('hex')
  const lower = item.name.toLowerCase()
  let text: string
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) {
    text = buffer.toString('utf8')
  } else if (lower.endsWith('.pdf')) {
    const pdf = await import('pdf-parse')
    text = (await pdf.default(buffer)).text
    if (text.trim().length === 0) throw new Error(`${item.name} 是扫描件或没有可提取文字，首版不支持`)
  } else if (lower.endsWith('.docx')) {
    const mammoth = await import('mammoth')
    const result = await mammoth.extractRawText({ buffer })
    text = result.value
    if (/<w:(ins|del)\b|word\/comments\.xml/.test(buffer.toString('utf8'))) {
      text += '\n\n[提示：文档可能包含未处理的修订或批注，请人工核对。]'
    }
  } else {
    throw new Error(`${item.name} 不是支持的 DOCX、文字 PDF 或 Markdown 附件`)
  }
  return { ...item, sha256, text }
}
