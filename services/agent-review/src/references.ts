import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'

export async function loadReferenceMaterials (paths: string[]): Promise<string> {
  const sections: string[] = []
  for (const path of paths) {
    const bytes = await readFile(path)
    const hash = createHash('sha256').update(bytes).digest('hex')
    let text = ''
    if (extname(path).toLowerCase() === '.docx') {
      const mammoth = await import('mammoth')
      text = (await mammoth.extractRawText({ buffer: bytes })).value
    } else {
      text = bytes.toString('utf8')
    }
    sections.push(`参考资料：${path}\n内容哈希：${hash}\n${text.slice(0, 120000)}`)
  }
  return sections.join('\n\n')
}
