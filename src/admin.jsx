import { useCallback, useEffect, useState } from 'react'
import { deleteUser, deleteUserMemo, fetchAdminUserMemos, fetchAdminUsers, updateUser } from './api.js'
import { PasswordInput } from './password.jsx'

function formatDateTime(timestamp) {
  if (!timestamp) return '-'
  return new Intl.DateTimeFormat('ko-KR', {
    year: '2-digit',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(timestamp)
}

function formatDay(timestamp) {
  return new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric' }).format(timestamp)
}

function toDateInput(timestamp) {
  const date = new Date(timestamp)
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function endOfDay(dateInput) {
  return new Date(`${dateInput}T23:59:59.999`).getTime()
}

function daysFromToday(days) {
  return toDateInput(Date.now() + days * 24 * 60 * 60 * 1000)
}

function UserStatus({ user }) {
  if (user.bannedAt) return <span className="role-badge is-banned">강퇴됨</span>
  if (user.writeBlockedUntil) {
    return <span className="role-badge is-blocked">{formatDay(user.writeBlockedUntil)}까지 글쓰기 제한</span>
  }
  return <span className="role-badge">정상</span>
}

function UserMemos({ detail, onDeleteMemo, onClose }) {
  const [askingId, setAskingId] = useState(null)

  return (
    <section className="admin-paper">
      <div className="admin-head">
        <h2>{detail.user.username}님의 메모</h2>
        <button className="edit-btn" type="button" onClick={onClose}>
          닫기
        </button>
      </div>
      {detail.memos.length === 0 ? (
        <p className="admin-empty">작성한 메모가 없어요.</p>
      ) : (
        <div className="board admin-memos">
          {detail.memos.map((memo) => (
            <article key={memo.id} className={`memo memo-${memo.color} ${memo.pinned ? 'is-pinned' : ''}`}>
              <div className="memo-tools admin-memo-tools">
                {askingId === memo.id ? (
                  <span className="delete-ask">
                    이 글을 지울까요?
                    <button
                      className="tool-btn danger is-on"
                      type="button"
                      onClick={() => onDeleteMemo(memo.id)}
                    >
                      삭제
                    </button>
                    <button className="tool-btn" type="button" onClick={() => setAskingId(null)}>
                      아니요
                    </button>
                  </span>
                ) : (
                  <button className="tool-btn danger" type="button" onClick={() => setAskingId(memo.id)}>
                    글 삭제
                  </button>
                )}
              </div>
              <h2>{memo.title}</h2>
              <p className="memo-body">{memo.content || '내용 없음'}</p>
              <footer className="memo-footer">
                <time dateTime={new Date(memo.updatedAt).toISOString()}>{formatDateTime(memo.updatedAt)}</time>
              </footer>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}

function UserEditor({ user, isMe, onSave, onClose }) {
  const [username, setUsername] = useState(user.username)
  const [password, setPassword] = useState('')
  const [blockDate, setBlockDate] = useState(
    user.writeBlockedUntil ? toDateInput(user.writeBlockedUntil) : daysFromToday(7),
  )
  const [message, setMessage] = useState('')

  async function save(changes, doneMessage) {
    const ok = await onSave(user.id, changes)
    if (ok) setMessage(doneMessage)
    return ok
  }

  async function saveProfile(event) {
    event.preventDefault()
    const changes = {}
    if (username.trim() !== user.username) changes.username = username.trim()
    if (password) changes.password = password
    if (Object.keys(changes).length === 0) {
      setMessage('바뀐 내용이 없어요.')
      return
    }
    if (await save(changes, '가입 정보를 저장했어요.')) setPassword('')
  }

  return (
    <section className="admin-paper">
      <div className="admin-head">
        <h2>{user.username}님의 가입 정보</h2>
        <button className="edit-btn" type="button" onClick={onClose}>
          닫기
        </button>
      </div>

      <dl className="admin-info">
        <div>
          <dt>회원 번호</dt>
          <dd>{user.id}</dd>
        </div>
        <div>
          <dt>권한</dt>
          <dd>{user.isAdmin ? '관리자' : '회원'}</dd>
        </div>
        <div>
          <dt>가입일</dt>
          <dd>{formatDateTime(user.createdAt)}</dd>
        </div>
        <div>
          <dt>메모 수</dt>
          <dd>{user.memoCount}</dd>
        </div>
        <div>
          <dt>최근 활동</dt>
          <dd>{formatDateTime(user.lastMemoAt)}</dd>
        </div>
        <div>
          <dt>상태</dt>
          <dd>
            <UserStatus user={user} />
          </dd>
        </div>
      </dl>

      <form className="admin-form" onSubmit={saveProfile}>
        <h3>가입 정보 수정</h3>
        <label className="auth-field">
          <span>아이디</span>
          <input value={username} required onChange={(event) => setUsername(event.target.value)} />
        </label>
        <label className="auth-field">
          <span>새 비밀번호 (바꿀 때만 입력)</span>
          <PasswordInput
            value={password}
            autoComplete="new-password"
            placeholder="8자 이상"
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <button className="save-btn" type="submit">
          정보 저장
        </button>
      </form>

      {isMe ? null : (
        <div className="admin-form">
          <h3>글쓰기 제한</h3>
          <p className="admin-empty">
            고른 날짜가 끝날 때까지 새 메모를 쓰거나 내용을 고칠 수 없어요. 기존 메모 보기와 삭제는 할 수 있어요.
          </p>
          <div className="admin-block-row">
            <input
              className="admin-date"
              type="date"
              value={blockDate}
              min={toDateInput(Date.now())}
              onChange={(event) => setBlockDate(event.target.value)}
            />
            {[1, 7, 30].map((days) => (
              <button key={days} className="tool-btn" type="button" onClick={() => setBlockDate(daysFromToday(days))}>
                {days}일
              </button>
            ))}
          </div>
          <div className="admin-block-row">
            <button
              className="save-btn"
              type="button"
              disabled={!blockDate}
              onClick={() =>
                save({ writeBlockedUntil: endOfDay(blockDate) }, `${blockDate}까지 글쓰기를 제한했어요.`)
              }
            >
              제한 적용
            </button>
            {user.writeBlockedUntil ? (
              <button
                className="edit-btn"
                type="button"
                onClick={() => save({ writeBlockedUntil: null }, '글쓰기 제한을 풀었어요.')}
              >
                제한 해제
              </button>
            ) : null}
          </div>
        </div>
      )}

      {message ? <p className="admin-notice">{message}</p> : null}
    </section>
  )
}

export function AdminPanel({ currentUser, onSessionExpired }) {
  const [users, setUsers] = useState(null)
  const [error, setError] = useState('')
  const [asking, setAsking] = useState(null)
  const [detail, setDetail] = useState(null)
  const [editingId, setEditingId] = useState(null)

  const handleError = useCallback(
    (requestError) => {
      if (requestError.status === 401) {
        onSessionExpired()
        return
      }
      setError(requestError.message)
    },
    [onSessionExpired],
  )

  const loadUsers = useCallback(async () => {
    try {
      const data = await fetchAdminUsers()
      setUsers(data.users)
      setError('')
    } catch (requestError) {
      handleError(requestError)
    }
  }, [handleError])

  useEffect(() => {
    loadUsers()
  }, [loadUsers])

  async function showMemos(userId) {
    try {
      setDetail(await fetchAdminUserMemos(userId))
    } catch (requestError) {
      handleError(requestError)
    }
  }

  async function removeMemo(memoId) {
    try {
      await deleteUserMemo(detail.user.id, memoId)
      setDetail({ ...detail, memos: detail.memos.filter((memo) => memo.id !== memoId) })
      await loadUsers()
    } catch (requestError) {
      handleError(requestError)
    }
  }

  async function saveUser(userId, changes) {
    try {
      await updateUser(userId, changes)
      setAsking(null)
      await loadUsers()
      if (detail?.user.id === userId) await showMemos(userId)
      return true
    } catch (requestError) {
      handleError(requestError)
      return false
    }
  }

  async function removeUser(userId) {
    try {
      await deleteUser(userId)
      setAsking(null)
      if (detail?.user.id === userId) setDetail(null)
      if (editingId === userId) setEditingId(null)
      await loadUsers()
    } catch (requestError) {
      handleError(requestError)
    }
  }

  function confirmButton(user, kind, label, question, onConfirm) {
    if (asking?.id === user.id && asking.kind === kind) {
      return (
        <span className="delete-ask">
          {question}
          <button className="tool-btn danger is-on" type="button" onClick={onConfirm}>
            {label}
          </button>
          <button className="tool-btn" type="button" onClick={() => setAsking(null)}>
            아니요
          </button>
        </span>
      )
    }
    return (
      <button className="tool-btn danger" type="button" onClick={() => setAsking({ id: user.id, kind })}>
        {label}
      </button>
    )
  }

  const adminCount = users?.filter((user) => user.isAdmin).length ?? 0
  const bannedCount = users?.filter((user) => user.bannedAt).length ?? 0
  const memoCount = users?.reduce((sum, user) => sum + user.memoCount, 0) ?? 0
  const editingUser = users?.find((user) => user.id === editingId)

  return (
    <div className="admin">
      <section className="admin-paper">
        <div className="admin-head">
          <h2>관리자 모드</h2>
          <p className="stats">
            <span>회원 {users?.length ?? 0}</span>
            <span>관리자 {adminCount}</span>
            {bannedCount > 0 ? <span>강퇴 {bannedCount}</span> : null}
            <span>전체 메모 {memoCount}</span>
          </p>
        </div>

        {error ? <p className="auth-error">{error}</p> : null}

        {users === null ? (
          <p className="admin-empty">회원 목록을 불러오는 중…</p>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>아이디</th>
                  <th>권한</th>
                  <th>상태</th>
                  <th>가입일</th>
                  <th>메모</th>
                  <th>최근 메모</th>
                  <th>관리</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => {
                  const isMe = user.id === currentUser.id
                  return (
                    <tr key={user.id} className={user.bannedAt ? 'is-banned-row' : ''}>
                      <td>
                        {user.username}
                        {isMe ? <span className="admin-me">나</span> : null}
                      </td>
                      <td>
                        <span className={`role-badge ${user.isAdmin ? 'is-admin' : ''}`}>
                          {user.isAdmin ? '관리자' : '회원'}
                        </span>
                      </td>
                      <td>
                        <UserStatus user={user} />
                      </td>
                      <td>{formatDateTime(user.createdAt)}</td>
                      <td>{user.memoCount}</td>
                      <td>{formatDateTime(user.lastMemoAt)}</td>
                      <td>
                        <div className="admin-actions">
                          <button className="tool-btn" type="button" onClick={() => setEditingId(user.id)}>
                            정보 보기
                          </button>
                          <button className="tool-btn" type="button" onClick={() => showMemos(user.id)}>
                            메모 보기
                          </button>
                          {isMe || user.bannedAt ? null : (
                            <button
                              className="tool-btn"
                              type="button"
                              onClick={() => saveUser(user.id, { isAdmin: !user.isAdmin })}
                            >
                              {user.isAdmin ? '관리자 해제' : '관리자 지정'}
                            </button>
                          )}
                          {isMe || user.isAdmin ? null : user.bannedAt ? (
                            <button
                              className="tool-btn"
                              type="button"
                              onClick={() => saveUser(user.id, { banned: false })}
                            >
                              강퇴 해제
                            </button>
                          ) : (
                            confirmButton(user, 'ban', '강퇴', '로그인을 막을까요?', () =>
                              saveUser(user.id, { banned: true }),
                            )
                          )}
                          {isMe
                            ? null
                            : confirmButton(user, 'delete', '회원 삭제', '메모까지 지울까요?', () =>
                                removeUser(user.id),
                              )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {editingUser ? (
        <UserEditor
          key={editingUser.id}
          user={editingUser}
          isMe={editingUser.id === currentUser.id}
          onSave={saveUser}
          onClose={() => setEditingId(null)}
        />
      ) : null}

      {detail ? <UserMemos detail={detail} onDeleteMemo={removeMemo} onClose={() => setDetail(null)} /> : null}
    </div>
  )
}
