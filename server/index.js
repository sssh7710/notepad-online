import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { db, deleteUserStatements, initDatabase } from './db.js'

const PORT = Number(process.env.PORT) || 3001
const SESSION_COOKIE = 'notepad_session'
const SESSION_MS = 1000 * 60 * 60 * 24 * 7
const USERNAME_PATTERN = /^[a-zA-Z0-9_가-힣]{3,20}$/
const MIN_PASSWORD = 8
const NOTE_COLORS = new Set(['butter', 'mint', 'peach', 'sky', 'lilac'])

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':')
  const expected = Buffer.from(hash, 'hex')
  const actual = scryptSync(password, salt, expected.length)
  return timingSafeEqual(expected, actual)
}

function readCookie(req, name) {
  const header = req.headers.cookie ?? ''
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return decodeURIComponent(rest.join('='))
  }
  return null
}

async function startSession(req, res, userId) {
  const token = randomBytes(32).toString('hex')
  await db.run(
    'INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)',
    token,
    userId,
    Date.now() + SESSION_MS,
  )
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure,
    maxAge: SESSION_MS,
    path: '/',
  })
}

async function currentUser(req) {
  const token = readCookie(req, SESSION_COOKIE)
  if (!token) return null
  const row = await db.get(
    `SELECT users.id, users.username, users.is_admin, users.banned_at, users.write_blocked_until,
            users.email, users.security_answer_hash, sessions.expires_at
     FROM sessions JOIN users ON users.id = sessions.user_id
     WHERE sessions.token = ?`,
    token,
  )
  if (!row) return null
  if (row.expires_at < Date.now() || row.banned_at) {
    await db.run('DELETE FROM sessions WHERE token = ?', token)
    return null
  }
  return toSessionUser(row)
}

function activeWriteBlock(row) {
  return row.write_blocked_until && row.write_blocked_until > Date.now() ? row.write_blocked_until : null
}

function toPublicUser(row) {
  return {
    id: row.id,
    username: row.username,
    isAdmin: Boolean(row.is_admin),
    writeBlockedUntil: activeWriteBlock(row),
  }
}

function formatBlockDate(timestamp) {
  return new Intl.DateTimeFormat('ko-KR', { dateStyle: 'long', timeZone: 'Asia/Seoul' }).format(timestamp)
}

async function requireUser(req, res, next) {
  const user = await currentUser(req)
  if (!user) {
    res.status(401).json({ error: '로그인이 필요해요.' })
    return
  }
  req.user = user
  next()
}

async function requireAdmin(req, res, next) {
  await requireUser(req, res, () => {
    if (!req.user.isAdmin) {
      res.status(403).json({ error: '관리자만 사용할 수 있어요.' })
      return
    }
    next()
  })
}

function toMemoResponse(row) {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    color: row.color,
    pinned: Boolean(row.pinned),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

async function selectMemos(userId) {
  const rows = await db.all(
    `SELECT id, title, content, color, pinned, created_at, updated_at
     FROM memos WHERE user_id = ? ORDER BY updated_at DESC`,
    userId,
  )
  return rows.map(toMemoResponse)
}

async function findTargetUser(req, res) {
  const id = Number(req.params.id)
  const user = Number.isInteger(id)
    ? await db.get('SELECT id, username, is_admin, banned_at, write_blocked_until FROM users WHERE id = ?', id)
    : undefined
  if (!user) res.status(404).json({ error: '회원을 찾을 수 없어요.' })
  return user
}

function readCredentials(body) {
  const username = typeof body?.username === 'string' ? body.username.trim() : ''
  const password = typeof body?.password === 'string' ? body.password : ''
  return { username, password }
}

function toSessionUser(row) {
  return {
    ...toPublicUser(row),
    email: row.email ?? null,
    hasRecovery: Boolean(row.email && row.security_answer_hash),
  }
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

// 대소문자와 띄어쓰기 차이로 답이 틀렸다고 나오지 않도록 비교 전에 맞춘다.
function normalizeAnswer(value) {
  return typeof value === 'string' ? value.toLowerCase().replace(/\s+/g, '') : ''
}

// 회원가입과 찾기 정보 변경에서 쓰는 이메일·보안 질문·답변 검사. 문제가 있으면 오류 문구를 돌려준다.
async function readRecoveryInfo(body, userId = null) {
  const email = normalizeEmail(body?.email)
  const question = typeof body?.securityQuestion === 'string' ? body.securityQuestion.trim() : ''
  const answer = normalizeAnswer(body?.securityAnswer)
  if (!EMAIL_PATTERN.test(email) || email.length > 100) return { error: '이메일 주소를 올바르게 입력해 주세요.' }
  if (question.length < 2 || question.length > 60) return { error: '보안 질문을 골라 주세요.' }
  if (answer.length < 1 || answer.length > 60) return { error: '보안 질문의 답을 입력해 주세요.' }
  const taken = await db.get('SELECT id FROM users WHERE email = ?', email)
  if (taken && taken.id !== userId) return { error: '이미 다른 계정에 등록된 이메일이에요.', status: 409 }
  return { email, question, answerHash: hashPassword(answer) }
}

const RECOVERY_MAX_TRIES = 5
const RECOVERY_LOCK_MS = 1000 * 60 * 10
const recoveryTries = new Map()

function recoveryLocked(userId) {
  const entry = recoveryTries.get(userId)
  return Boolean(entry?.lockedUntil && entry.lockedUntil > Date.now())
}

function recordRecoveryFailure(userId) {
  const entry = recoveryTries.get(userId) ?? { count: 0, lockedUntil: 0 }
  entry.count += 1
  if (entry.count >= RECOVERY_MAX_TRIES) {
    entry.count = 0
    entry.lockedUntil = Date.now() + RECOVERY_LOCK_MS
  }
  recoveryTries.set(userId, entry)
}

const RECOVERY_LOCKED_MESSAGE = '답을 여러 번 틀려서 10분 동안 찾기를 할 수 없어요. 잠시 후 다시 시도해 주세요.'
const RECOVERY_NOT_FOUND_MESSAGE = '입력한 정보와 일치하는 계정이 없어요.'

// 아이디 찾기는 이메일만, 비밀번호 찾기는 아이디와 이메일을 함께 받아 계정을 찾는다.
async function findRecoveryUser(body) {
  const email = normalizeEmail(body?.email)
  if (!email) return null
  const row = await db.get(
    'SELECT id, username, security_question, security_answer_hash FROM users WHERE email = ?',
    email,
  )
  if (!row) return null
  if ('username' in (body ?? {})) {
    const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : ''
    if (row.username.toLowerCase() !== username) return null
  }
  return row
}

const RECOVERY_NO_QUESTION_MESSAGE =
  '이 계정은 보안 질문이 등록되지 않아 찾기를 할 수 없어요. 로그인한 뒤 "찾기 정보"에서 보안 질문을 등록해 주세요.'

async function findRecoveryUserOrFail(req, res) {
  const user = await findRecoveryUser(req.body)
  if (!user) {
    res.status(404).json({ error: RECOVERY_NOT_FOUND_MESSAGE })
    return null
  }
  if (!user.security_answer_hash) {
    res.status(400).json({ error: RECOVERY_NO_QUESTION_MESSAGE })
    return null
  }
  return user
}

async function checkRecoveryAnswer(req, res) {
  const user = await findRecoveryUserOrFail(req, res)
  if (!user) return null
  if (recoveryLocked(user.id)) {
    res.status(429).json({ error: RECOVERY_LOCKED_MESSAGE })
    return null
  }
  if (!verifyPassword(normalizeAnswer(req.body?.securityAnswer), user.security_answer_hash)) {
    recordRecoveryFailure(user.id)
    res.status(400).json({
      error: recoveryLocked(user.id) ? RECOVERY_LOCKED_MESSAGE : '보안 질문의 답이 맞지 않아요.',
    })
    return null
  }
  recoveryTries.delete(user.id)
  return user
}

const app = express()
// Render 같은 호스팅은 앞단 프록시가 https를 처리하므로, 그 정보를 믿어야 secure 쿠키가 붙는다.
app.set('trust proxy', 1)
app.use(express.json({ limit: '1mb' }))

app.post('/api/signup', async (req, res) => {
  const { username, password } = readCredentials(req.body)
  if (!USERNAME_PATTERN.test(username)) {
    res.status(400).json({ error: '아이디는 3~20자의 한글, 영문, 숫자, _ 만 쓸 수 있어요.' })
    return
  }
  if (password.length < MIN_PASSWORD) {
    res.status(400).json({ error: `비밀번호는 ${MIN_PASSWORD}자 이상이어야 해요.` })
    return
  }
  if (await db.get('SELECT 1 FROM users WHERE username = ?', username)) {
    res.status(409).json({ error: '이미 사용 중인 아이디예요.' })
    return
  }
  const recovery = await readRecoveryInfo(req.body)
  if (recovery.error) {
    res.status(recovery.status ?? 400).json({ error: recovery.error })
    return
  }

  const isAdmin = (await db.get('SELECT 1 FROM users WHERE is_admin = 1')) ? 0 : 1
  const result = await db.run(
    `INSERT INTO users (username, password_hash, created_at, is_admin, email, security_question, security_answer_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    username,
    hashPassword(password),
    Date.now(),
    isAdmin,
    recovery.email,
    recovery.question,
    recovery.answerHash,
  )
  const userId = result.lastInsertRowid
  await startSession(req, res, userId)
  res.status(201).json({
    user: {
      id: userId,
      username,
      isAdmin: Boolean(isAdmin),
      writeBlockedUntil: null,
      email: recovery.email,
      hasRecovery: true,
    },
  })
})

app.post('/api/login', async (req, res) => {
  const { username, password } = readCredentials(req.body)
  const user = await db.get(
    `SELECT id, username, password_hash, is_admin, banned_at, write_blocked_until,
            email, security_answer_hash
     FROM users WHERE username = ?`,
    username,
  )
  if (!user || !verifyPassword(password, user.password_hash)) {
    res.status(401).json({ error: '아이디 또는 비밀번호가 맞지 않아요.' })
    return
  }
  if (user.banned_at) {
    res.status(403).json({ error: '관리자에 의해 강퇴된 계정이에요.' })
    return
  }
  await startSession(req, res, user.id)
  res.json({ user: toSessionUser(user) })
})

app.post('/api/logout', async (req, res) => {
  const token = readCookie(req, SESSION_COOKIE)
  if (token) await db.run('DELETE FROM sessions WHERE token = ?', token)
  res.clearCookie(SESSION_COOKIE, { path: '/' })
  res.json({ ok: true })
})

app.post('/api/recovery/question', async (req, res) => {
  const user = await findRecoveryUserOrFail(req, res)
  if (!user) return
  res.json({ question: user.security_question })
})

app.post('/api/recovery/username', async (req, res) => {
  const user = await checkRecoveryAnswer(req, res)
  if (!user) return
  res.json({ username: user.username })
})

app.post('/api/recovery/password', async (req, res) => {
  const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : ''
  if (newPassword.length < MIN_PASSWORD) {
    res.status(400).json({ error: `새 비밀번호는 ${MIN_PASSWORD}자 이상이어야 해요.` })
    return
  }
  const user = await checkRecoveryAnswer(req, res)
  if (!user) return
  await db.batch([
    ['UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(newPassword), user.id],
    ['DELETE FROM sessions WHERE user_id = ?', user.id],
  ])
  res.json({ username: user.username })
})

app.get('/api/me', async (req, res) => {
  res.json({ user: await currentUser(req) })
})

async function checkCurrentPassword(req, res) {
  const password = typeof req.body?.password === 'string' ? req.body.password : ''
  const row = await db.get('SELECT password_hash FROM users WHERE id = ?', req.user.id)
  if (!verifyPassword(password, row.password_hash)) {
    res.status(400).json({ error: '현재 비밀번호가 맞지 않아요.' })
    return false
  }
  return true
}

app.put('/api/me/recovery', requireUser, async (req, res) => {
  if (!(await checkCurrentPassword(req, res))) return
  const recovery = await readRecoveryInfo(req.body, req.user.id)
  if (recovery.error) {
    res.status(recovery.status ?? 400).json({ error: recovery.error })
    return
  }
  await db.run(
    'UPDATE users SET email = ?, security_question = ?, security_answer_hash = ? WHERE id = ?',
    recovery.email,
    recovery.question,
    recovery.answerHash,
    req.user.id,
  )
  res.json({ user: { ...req.user, email: recovery.email, hasRecovery: true } })
})

app.put('/api/me/password', requireUser, async (req, res) => {
  const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : ''
  if (newPassword.length < MIN_PASSWORD) {
    res.status(400).json({ error: `새 비밀번호는 ${MIN_PASSWORD}자 이상이어야 해요.` })
    return
  }
  if (!(await checkCurrentPassword(req, res))) return
  if (newPassword === req.body.password) {
    res.status(400).json({ error: '새 비밀번호가 현재 비밀번호와 같아요.' })
    return
  }
  await db.batch([
    ['UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(newPassword), req.user.id],
    ['DELETE FROM sessions WHERE user_id = ? AND token != ?', req.user.id, readCookie(req, SESSION_COOKIE)],
  ])
  res.json({ ok: true })
})

app.put('/api/me/email', requireUser, async (req, res) => {
  const email = normalizeEmail(req.body?.email)
  if (!EMAIL_PATTERN.test(email) || email.length > 100) {
    res.status(400).json({ error: '이메일 주소를 올바르게 입력해 주세요.' })
    return
  }
  if (!(await checkCurrentPassword(req, res))) return
  const taken = await db.get('SELECT id FROM users WHERE email = ?', email)
  if (taken && taken.id !== req.user.id) {
    res.status(409).json({ error: '이미 다른 계정에 등록된 이메일이에요.' })
    return
  }
  await db.run('UPDATE users SET email = ? WHERE id = ?', email, req.user.id)
  res.json({ user: { ...req.user, email } })
})

app.delete('/api/me', requireUser, async (req, res) => {
  const password = typeof req.body?.password === 'string' ? req.body.password : ''
  const row = await db.get('SELECT password_hash FROM users WHERE id = ?', req.user.id)
  if (!verifyPassword(password, row.password_hash)) {
    res.status(400).json({ error: '비밀번호가 맞지 않아요.' })
    return
  }
  if (req.user.isAdmin) {
    const otherAdmin = await db.get('SELECT 1 FROM users WHERE is_admin = 1 AND id != ?', req.user.id)
    const otherUser = await db.get('SELECT 1 FROM users WHERE id != ?', req.user.id)
    if (!otherAdmin && otherUser) {
      res.status(400).json({ error: '마지막 관리자는 탈퇴할 수 없어요. 다른 회원을 관리자로 지정한 뒤 탈퇴해 주세요.' })
      return
    }
  }

  await db.batch(deleteUserStatements(req.user.id))
  res.clearCookie(SESSION_COOKIE, { path: '/' })
  res.json({ ok: true })
})

app.get('/api/memos', requireUser, async (req, res) => {
  res.json({ memos: await selectMemos(req.user.id) })
})

app.put('/api/memos', requireUser, async (req, res) => {
  const memos = req.body?.memos
  if (!Array.isArray(memos)) {
    res.status(400).json({ error: '메모 목록 형식이 올바르지 않아요.' })
    return
  }

  const now = Date.now()
  const removedRows = await db.all('SELECT id FROM deleted_memos WHERE user_id = ?', req.user.id)
  const removedByAdmin = new Set(removedRows.map((row) => row.id))
  const incoming = memos.filter(
    (memo) => typeof memo?.id === 'string' && memo.id && !removedByAdmin.has(memo.id),
  )

  if (req.user.writeBlockedUntil) {
    const rows = await db.all('SELECT id, title, content FROM memos WHERE user_id = ?', req.user.id)
    const existing = new Map(rows.map((row) => [row.id, row]))
    const writes = incoming.some((memo) => {
      const before = existing.get(memo.id)
      return !before || before.title !== String(memo.title ?? '') || before.content !== String(memo.content ?? '')
    })
    if (writes) {
      res.status(403).json({
        error: `${formatBlockDate(req.user.writeBlockedUntil)}까지 글쓰기가 제한된 계정이에요.`,
      })
      return
    }
  }

  await db.batch([
    ['DELETE FROM memos WHERE user_id = ?', req.user.id],
    ...incoming.map((memo) => [
      `INSERT INTO memos (id, user_id, title, content, color, pinned, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      memo.id,
      req.user.id,
      String(memo.title ?? ''),
      String(memo.content ?? ''),
      NOTE_COLORS.has(memo.color) ? memo.color : 'butter',
      memo.pinned ? 1 : 0,
      Number(memo.createdAt) || now,
      Number(memo.updatedAt) || now,
    ]),
  ])

  res.json({ ok: true })
})

app.get('/api/admin/users', requireAdmin, async (req, res) => {
  const rows = await db.all(
    `SELECT users.id, users.username, users.is_admin, users.created_at, users.banned_at,
            users.write_blocked_until,
            COUNT(memos.id) AS memo_count, MAX(memos.updated_at) AS last_memo_at
     FROM users LEFT JOIN memos ON memos.user_id = users.id
     GROUP BY users.id
     ORDER BY users.id`,
  )
  res.json({
    users: rows.map((row) => ({
      ...toPublicUser(row),
      createdAt: row.created_at,
      bannedAt: row.banned_at,
      memoCount: row.memo_count,
      lastMemoAt: row.last_memo_at,
    })),
  })
})

app.get('/api/admin/users/:id/memos', requireAdmin, async (req, res) => {
  const user = await findTargetUser(req, res)
  if (!user) return
  res.json({ user: toPublicUser(user), memos: await selectMemos(user.id) })
})

app.delete('/api/admin/users/:id/memos/:memoId', requireAdmin, async (req, res) => {
  const user = await findTargetUser(req, res)
  if (!user) return
  const result = await db.run('DELETE FROM memos WHERE user_id = ? AND id = ?', user.id, req.params.memoId)
  if (result.changes === 0) {
    res.status(404).json({ error: '메모를 찾을 수 없어요.' })
    return
  }
  // 회원 화면에 남아 있던 메모가 다음 저장 때 되살아나지 않도록 기록해 둔다.
  await db.run('INSERT OR IGNORE INTO deleted_memos (id, user_id) VALUES (?, ?)', req.params.memoId, user.id)
  res.json({ ok: true })
})

// body에 들어온 항목만 바꾼다: isAdmin, username, password, banned, writeBlockedUntil(타임스탬프 또는 null)
app.patch('/api/admin/users/:id', requireAdmin, async (req, res) => {
  const user = await findTargetUser(req, res)
  if (!user) return
  const body = req.body ?? {}
  const isMe = user.id === req.user.id
  const updates = []
  const fail = (message) => res.status(400).json({ error: message })

  if ('isAdmin' in body) {
    if (typeof body.isAdmin !== 'boolean') return fail('변경할 권한 값이 올바르지 않아요.')
    if (isMe && !body.isAdmin) return fail('내 관리자 권한은 직접 뺄 수 없어요.')
    updates.push(['is_admin', body.isAdmin ? 1 : 0])
  }

  if ('username' in body) {
    const username = typeof body.username === 'string' ? body.username.trim() : ''
    if (!USERNAME_PATTERN.test(username)) {
      return fail('아이디는 3~20자의 한글, 영문, 숫자, _ 만 쓸 수 있어요.')
    }
    if (await db.get('SELECT 1 FROM users WHERE username = ? AND id != ?', username, user.id)) {
      res.status(409).json({ error: '이미 사용 중인 아이디예요.' })
      return
    }
    updates.push(['username', username])
  }

  if ('password' in body) {
    if (typeof body.password !== 'string' || body.password.length < MIN_PASSWORD) {
      return fail(`비밀번호는 ${MIN_PASSWORD}자 이상이어야 해요.`)
    }
    updates.push(['password_hash', hashPassword(body.password)])
  }

  if ('banned' in body) {
    if (typeof body.banned !== 'boolean') return fail('강퇴 값이 올바르지 않아요.')
    if (body.banned && isMe) return fail('내 계정은 강퇴할 수 없어요.')
    const willBeAdmin = 'isAdmin' in body ? body.isAdmin : Boolean(user.is_admin)
    if (body.banned && willBeAdmin) return fail('관리자는 강퇴할 수 없어요. 먼저 관리자 해제를 해 주세요.')
    updates.push(['banned_at', body.banned ? user.banned_at || Date.now() : null])
  }

  if ('writeBlockedUntil' in body) {
    const until = body.writeBlockedUntil
    if (until !== null && !(Number.isFinite(until) && until > Date.now())) {
      return fail('글쓰기 제한 날짜는 오늘 이후로 골라 주세요.')
    }
    updates.push(['write_blocked_until', until])
  }

  if (updates.length === 0) return fail('바꿀 내용이 없어요.')

  const statements = [
    [
      `UPDATE users SET ${updates.map(([column]) => `${column} = ?`).join(', ')} WHERE id = ?`,
      ...updates.map(([, value]) => value),
      user.id,
    ],
  ]
  const signOut = (body.banned === true || 'password' in body) && !isMe
  if (signOut) statements.push(['DELETE FROM sessions WHERE user_id = ?', user.id])
  await db.batch(statements)

  const updated = await db.get(
    'SELECT id, username, is_admin, banned_at, write_blocked_until FROM users WHERE id = ?',
    user.id,
  )
  res.json({ user: { ...toPublicUser(updated), bannedAt: updated.banned_at } })
})

app.delete('/api/admin/users/:id', requireAdmin, async (req, res) => {
  const user = await findTargetUser(req, res)
  if (!user) return
  if (user.id === req.user.id) {
    res.status(400).json({ error: '내 계정은 관리자 화면에서 삭제할 수 없어요.' })
    return
  }
  await db.batch(deleteUserStatements(user.id))
  res.json({ ok: true })
})

// 배포 환경에서는 빌드된 화면(dist)도 이 서버가 함께 보여 준다. 개발 중에는 Vite가 맡는다.
const distDir = fileURLToPath(new URL('../dist/', import.meta.url))
if (existsSync(distDir)) {
  app.use('/my-notepad', express.static(distDir))
  app.get('/', (req, res) => res.redirect('/my-notepad/'))
}

await initDatabase()

app.listen(PORT, () => {
  console.log(`메모장 서버: http://localhost:${PORT}`)
})
