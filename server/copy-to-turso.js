// 이 컴퓨터의 notepad.db에 있는 회원과 메모를 Turso로 옮긴다.
// 실행: TURSO_DATABASE_URL과 TURSO_AUTH_TOKEN을 설정한 뒤 npm run copy-to-turso
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@libsql/client'
import { db, initDatabase } from './db.js'

if (!process.env.TURSO_DATABASE_URL) {
  console.error('TURSO_DATABASE_URL이 설정되지 않았어요.')
  process.exit(1)
}

const localPath = join(fileURLToPath(new URL('./data/', import.meta.url)), 'notepad.db')
const local = createClient({ url: `file:${localPath}` })

await initDatabase()

const TABLES = {
  users: [
    'id', 'username', 'password_hash', 'created_at', 'is_admin', 'banned_at',
    'write_blocked_until', 'email', 'security_question', 'security_answer_hash',
  ],
  memos: ['id', 'user_id', 'title', 'content', 'color', 'pinned', 'created_at', 'updated_at'],
  deleted_memos: ['id', 'user_id'],
}

const statements = []
for (const [table, columns] of Object.entries(TABLES)) {
  const { rows } = await local.execute(`SELECT ${columns.join(', ')} FROM ${table}`)
  for (const row of rows) {
    statements.push([
      `INSERT OR REPLACE INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
      ...columns.map((column) => row[column] ?? null),
    ])
  }
  console.log(`${table}: ${rows.length}개`)
}

await db.batch(statements)
console.log('Turso로 옮기기를 마쳤어요.')
