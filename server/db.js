import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@libsql/client'

// TURSO_DATABASE_URL이 있으면 Turso 클라우드 DB를, 없으면 이 컴퓨터의 notepad.db 파일을 쓴다.
function openClient() {
  if (process.env.TURSO_DATABASE_URL) {
    return createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN })
  }
  const dataDir = fileURLToPath(new URL('./data/', import.meta.url))
  mkdirSync(dataDir, { recursive: true })
  return createClient({ url: `file:${join(dataDir, 'notepad.db')}` })
}

const client = openClient()

export const db = {
  async get(sql, ...args) {
    const result = await client.execute({ sql, args })
    return result.rows[0]
  },
  async all(sql, ...args) {
    const result = await client.execute({ sql, args })
    return result.rows
  },
  async run(sql, ...args) {
    const result = await client.execute({ sql, args })
    return { changes: result.rowsAffected, lastInsertRowid: Number(result.lastInsertRowid) }
  },
  // 여러 문장을 한 번에 모두 반영하거나, 하나라도 실패하면 모두 취소한다.
  async batch(statements) {
    await client.batch(
      statements.map(([sql, ...args]) => ({ sql, args })),
      'write',
    )
  },
}

export async function initDatabase() {
  await client.executeMultiple(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS memos (
      id TEXT NOT NULL,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      color TEXT NOT NULL DEFAULT 'butter',
      pinned INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, id)
    );

    CREATE TABLE IF NOT EXISTS deleted_memos (
      id TEXT NOT NULL,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      PRIMARY KEY (user_id, id)
    );
  `)

  const userColumns = await db.all('PRAGMA table_info(users)')
  async function addUserColumn(name, definition) {
    if (!userColumns.some((column) => column.name === name)) {
      await client.execute(`ALTER TABLE users ADD COLUMN ${name} ${definition}`)
    }
  }
  await addUserColumn('is_admin', 'INTEGER NOT NULL DEFAULT 0')
  await addUserColumn('banned_at', 'INTEGER')
  await addUserColumn('write_blocked_until', 'INTEGER')
  await addUserColumn('email', 'TEXT')
  await addUserColumn('security_question', 'TEXT')
  await addUserColumn('security_answer_hash', 'TEXT')
  await client.execute('CREATE UNIQUE INDEX IF NOT EXISTS users_email ON users(email) WHERE email IS NOT NULL')

  // 관리자가 한 명도 없으면 가장 먼저 가입한 회원을 관리자로 지정한다.
  if (!(await db.get('SELECT 1 FROM users WHERE is_admin = 1'))) {
    await client.execute('UPDATE users SET is_admin = 1 WHERE id = (SELECT MIN(id) FROM users)')
  }
  await db.run('DELETE FROM sessions WHERE expires_at < ?', Date.now())
}

// 회원과 그 회원의 메모·로그인 기록·삭제 기록을 함께 지운다.
export function deleteUserStatements(userId) {
  return [
    ['DELETE FROM memos WHERE user_id = ?', userId],
    ['DELETE FROM sessions WHERE user_id = ?', userId],
    ['DELETE FROM deleted_memos WHERE user_id = ?', userId],
    ['DELETE FROM users WHERE id = ?', userId],
  ]
}
