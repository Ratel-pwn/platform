import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { ReviewTask, TaskStatus } from './types'

// Node 22.19 supplies node:sqlite. Keeping the import dynamic lets the service
// report a clear startup error on older runtimes without leaking credentials.
export class ReviewDb {
  private readonly db: any

  constructor (path: string) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: new (path: string) => any }
    this.db = new DatabaseSync(path)
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS scan_cursor (channel_id TEXT PRIMARY KEY, created_on INTEGER NOT NULL DEFAULT 0, message_id TEXT);
      CREATE TABLE IF NOT EXISTS review_task (
        id TEXT PRIMARY KEY, root_id TEXT NOT NULL, channel_id TEXT NOT NULL, trigger_id TEXT NOT NULL UNIQUE,
        sender TEXT NOT NULL, agent TEXT NOT NULL, stage TEXT NOT NULL, input_hash TEXT NOT NULL,
        status TEXT NOT NULL, output_message_id TEXT, error TEXT, created_on INTEGER NOT NULL DEFAULT (unixepoch())
      );
      CREATE TABLE IF NOT EXISTS input_snapshot (task_id TEXT NOT NULL, attachment_id TEXT NOT NULL, sha256 TEXT NOT NULL, name TEXT NOT NULL, PRIMARY KEY(task_id, attachment_id));
      CREATE TABLE IF NOT EXISTS human_confirmation (task_id TEXT NOT NULL, sender TEXT NOT NULL, confirmed_on INTEGER NOT NULL, attachment_id TEXT, sha256 TEXT);
    `)
  }

  getCursor (channelId: string): { createdOn: number, messageId?: string } {
    const row = this.db.prepare('SELECT created_on as createdOn, message_id as messageId FROM scan_cursor WHERE channel_id = ?').get(channelId)
    return row ?? { createdOn: 0 }
  }

  setCursor (channelId: string, createdOn: number, messageId: string): void {
    this.db.prepare('INSERT INTO scan_cursor(channel_id, created_on, message_id) VALUES (?, ?, ?) ON CONFLICT(channel_id) DO UPDATE SET created_on=excluded.created_on, message_id=excluded.message_id').run(channelId, createdOn, messageId)
  }

  insertTask (task: ReviewTask): boolean {
    const result = this.db.prepare('INSERT OR IGNORE INTO review_task(id, root_id, channel_id, trigger_id, sender, agent, stage, input_hash, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(task.id, task.rootId, task.channelId, task.triggerId, task.sender, task.agent, task.stage, task.inputHash, task.status)
    return Number(result.changes) === 1
  }

  findReusableTask (rootId: string, stage: string, inputHash: string): ReviewTask | undefined {
    const row = this.db.prepare(`
      SELECT id, root_id as rootId, channel_id as channelId, trigger_id as triggerId,
        sender, agent, stage, input_hash as inputHash, status,
        output_message_id as outputMessageId, error
      FROM review_task
      WHERE root_id = ? AND stage = ? AND input_hash = ?
        AND status IN ('queued', 'running', 'awaiting-human', 'completed')
      ORDER BY created_on DESC LIMIT 1
    `).get(rootId, stage, inputHash)
    return row as ReviewTask | undefined
  }

  updateStatus (id: string, status: TaskStatus, error?: string, outputMessageId?: string): void {
    this.db.prepare('UPDATE review_task SET status = ?, error = ?, output_message_id = COALESCE(?, output_message_id) WHERE id = ?').run(status, error ?? null, outputMessageId ?? null, id)
  }

  insertSnapshots (taskId: string, snapshots: Array<{ id: string, name: string, sha256: string }>): void {
    const statement = this.db.prepare('INSERT OR REPLACE INTO input_snapshot(task_id, attachment_id, sha256, name) VALUES (?, ?, ?, ?)')
    for (const snapshot of snapshots) statement.run(taskId, snapshot.id, snapshot.sha256, snapshot.name)
  }

  recordConfirmation (taskId: string, sender: string, attachmentId: string | undefined, sha256: string | undefined): void {
    this.db.prepare('INSERT INTO human_confirmation(task_id, sender, confirmed_on, attachment_id, sha256) VALUES (?, ?, ?, ?, ?)').run(taskId, sender, Date.now(), attachmentId ?? null, sha256 ?? null)
  }

  hasReadyStage (rootId: string, stage: string): boolean {
    const previous = stage === 'solution' ? 'technical' : stage === 'contract' ? 'solution' : undefined
    if (previous === undefined) return true
    const row = this.db.prepare("SELECT 1 FROM review_task WHERE root_id = ? AND stage = ? AND status IN ('awaiting-human', 'completed') LIMIT 1").get(rootId, previous)
    return row !== undefined
  }

  latestTaskId (rootId: string, stage: string): string | undefined {
    const row = this.db.prepare("SELECT id FROM review_task WHERE root_id = ? AND stage = ? AND status = 'awaiting-human' ORDER BY created_on DESC LIMIT 1").get(rootId, stage)
    return row?.id as string | undefined
  }

  close (): void { this.db.close() }
}

export async function openReviewDb (dataDir: string): Promise<ReviewDb> {
  await mkdir(dirname(dataDir), { recursive: true })
  return new ReviewDb(dataDir)
}
