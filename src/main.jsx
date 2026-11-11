import { StrictMode, useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { AdminPanel } from './admin.jsx'
import { fetchMe, fetchMemos, login, logout, saveMemos, signup, withdraw } from './api.js'
import { KeyboardStatus, PasswordInput } from './password.jsx'
import {
  AccountDialog,
  FindUsernameForm,
  RecoveryFields,
  ResetPasswordForm,
  emptyRecovery,
  toRecoveryPayload,
} from './recovery.jsx'
import {
  COLOR_LABELS,
  NOTE_COLORS,
  cancelEdit,
  changeMemo,
  createInitialState,
  createMemo,
  deleteMemo,
  memoReducer,
  saveMemo,
  selectEditingCount,
  selectPinnedCount,
  selectSavedMemos,
  selectVisibleMemos,
  setColor,
  setSearch,
  startEdit,
  togglePin,
} from './memo.js'
import './styles.css'

function formatToday() {
  return new Intl.DateTimeFormat('ko-KR', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(new Date())
}

function formatDate(timestamp) {
  return new Intl.DateTimeFormat('ko-KR', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(timestamp)
}

function pinClass(color) {
  if (color === 'mint' || color === 'sky') return 'pin pin-blue'
  if (color === 'peach' || color === 'lilac') return 'pin pin-white'
  return 'pin pin-red'
}

function Header({
  search,
  onSearch,
  onCreate,
  resultCount,
  totalCount,
  editingCount,
  pinnedCount,
  saveStatus,
  user,
  view,
  writeBlocked,
  onToggleAdmin,
  onLogout,
  onWithdraw,
  onAccount,
}) {
  const searching = search.trim().length > 0
  const inAdmin = view === 'admin'

  return (
    <header className="toolbar">
      <div className="brand">
        <span className="brand-pin" aria-hidden="true" />
        <div>
          <p className="eyebrow">{formatToday()}</p>
          <h1>{inAdmin ? '관리자' : '메모장'}</h1>
        </div>
      </div>

      {inAdmin ? null : (
        <label className="search-field">
          <span className="search-label">메모 검색</span>
          <input
            id="memo-search"
            type="search"
            value={search}
            placeholder="제목이나 내용으로 찾기"
            onChange={(event) => onSearch(event.target.value)}
          />
        </label>
      )}

      <div className="toolbar-side">
        <p className="stats">
          {inAdmin ? null : (
            <>
              <span>{searching ? `검색 ${resultCount}` : `메모 ${totalCount}`}</span>
              {pinnedCount > 0 ? <span>고정 {pinnedCount}</span> : null}
              {editingCount > 0 ? <span>수정 중 {editingCount}</span> : null}
            </>
          )}
          {saveStatus === 'saving' ? <span>저장 중…</span> : null}
          {saveStatus === 'error' ? <span className="stat-error">저장 실패</span> : null}
        </p>
        {inAdmin || writeBlocked ? null : (
          <button className="create-btn" type="button" onClick={onCreate}>
            새 메모
          </button>
        )}
        <div className="user-box">
          <span className="user-name">{user.username}님</span>
          {user.isAdmin ? (
            <button className="edit-btn admin-toggle" type="button" onClick={onToggleAdmin}>
              {inAdmin ? '메모장으로' : '관리자 모드'}
            </button>
          ) : null}
          <button className="edit-btn" type="button" onClick={onLogout}>
            로그아웃
          </button>
          <button className="tool-btn" type="button" onClick={onAccount}>
            내 정보
          </button>
          <button className="tool-btn danger" type="button" onClick={onWithdraw}>
            회원 탈퇴
          </button>
        </div>
      </div>
    </header>
  )
}

function WithdrawDialog({ username, memoCount, onCancel, onConfirm }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    function onKeyDown(event) {
      if (event.key === 'Escape' && !busy) onCancel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [busy, onCancel])

  async function onSubmit(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await onConfirm(password)
    } catch (requestError) {
      setError(requestError.message)
      setBusy(false)
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation" onClick={busy ? undefined : onCancel}>
      <form
        className="auth-note withdraw-note"
        role="dialog"
        aria-modal="true"
        aria-labelledby="withdraw-title"
        onSubmit={onSubmit}
        onClick={(event) => event.stopPropagation()}
      >
        <span className="pin pin-red" aria-hidden="true" />
        <h1 id="withdraw-title">회원 탈퇴</h1>
        <p className="auth-hint">
          <strong>{username}</strong> 계정과 메모 {memoCount}개가 모두 삭제되고, 되돌릴 수 없어요.
        </p>
        <label className="auth-field">
          <span>비밀번호 확인</span>
          <PasswordInput
            value={password}
            autoComplete="current-password"
            autoFocus
            required
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {error ? <p className="auth-error">{error}</p> : null}
        <button className="save-btn auth-submit withdraw-submit" type="submit" disabled={busy}>
          {busy ? '탈퇴하는 중…' : '탈퇴하기'}
        </button>
        <button className="auth-switch" type="button" onClick={onCancel} disabled={busy}>
          취소
        </button>
      </form>
    </div>
  )
}

function MemoCard({ memo, dispatch, writeBlocked }) {
  const titleRef = useRef(null)
  const [askingDelete, setAskingDelete] = useState(false)

  useEffect(() => {
    if (memo.isEditing && titleRef.current) {
      titleRef.current.focus()
    }
  }, [memo.isEditing])

  useEffect(() => {
    if (!memo.isEditing) return undefined

    function onKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault()
        dispatch(cancelEdit(memo.id))
        return
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        dispatch(saveMemo(memo.id))
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [dispatch, memo.id, memo.isEditing])

  return (
    <article
      className={`memo memo-${memo.color} ${memo.isEditing ? 'is-editing' : ''} ${memo.pinned ? 'is-pinned' : ''}`}
    >
      <span className={pinClass(memo.color)} aria-hidden="true" />
      <div className="memo-tools">
        <button
          className={`tool-btn ${memo.pinned ? 'is-on' : ''}`}
          type="button"
          onClick={() => dispatch(togglePin(memo.id))}
        >
          {memo.pinned ? '고정됨' : '고정'}
        </button>
        <div className="color-dots" role="group" aria-label="메모 색">
          {NOTE_COLORS.map((color) => (
            <button
              key={color}
              className={`color-dot memo-${color} ${memo.color === color ? 'is-selected' : ''}`}
              type="button"
              aria-label={COLOR_LABELS[color]}
              title={COLOR_LABELS[color]}
              onClick={() => dispatch(setColor(memo.id, color))}
            />
          ))}
        </div>
        {askingDelete ? (
          <span className="delete-ask">
            지울까요?
            <button
              className="tool-btn danger is-on"
              type="button"
              onClick={() => dispatch(deleteMemo(memo.id))}
            >
              지우기
            </button>
            <button className="tool-btn" type="button" onClick={() => setAskingDelete(false)}>
              아니요
            </button>
          </span>
        ) : (
          <button className="tool-btn danger" type="button" onClick={() => setAskingDelete(true)}>
            삭제
          </button>
        )}
      </div>

      {memo.isEditing ? (
        <>
          <input
            ref={titleRef}
            className="memo-title-input"
            value={memo.title}
            maxLength={500}
            placeholder="제목을 입력하세요"
            onChange={(event) => dispatch(changeMemo(memo.id, 'title', event.target.value))}
          />
          <textarea
            className="memo-content-input"
            value={memo.content}
            maxLength={50000}
            placeholder="내용을 입력하세요"
            rows={6}
            onChange={(event) => dispatch(changeMemo(memo.id, 'content', event.target.value))}
          />
        </>
      ) : (
        <>
          <h2>{memo.title}</h2>
          <p className="memo-body">{memo.content || '내용 없음'}</p>
        </>
      )}

      <footer className="memo-footer">
        <time dateTime={new Date(memo.updatedAt).toISOString()}>{formatDate(memo.updatedAt)}</time>
        {memo.isEditing ? (
          <div className="memo-actions">
            <button className="edit-btn" type="button" onClick={() => dispatch(cancelEdit(memo.id))}>
              취소
            </button>
            <button className="save-btn" type="button" onClick={() => dispatch(saveMemo(memo.id))}>
              저장
            </button>
          </div>
        ) : writeBlocked ? null : (
          <button className="edit-btn" type="button" onClick={() => dispatch(startEdit(memo.id))}>
            수정
          </button>
        )}
      </footer>
    </article>
  )
}

function WriteBlockNotice({ until }) {
  const date = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'long' }).format(until)
  return (
    <p className="write-block-notice">
      관리자가 {date}까지 글쓰기를 제한했어요. 그동안은 메모를 보거나 지우는 것만 할 수 있어요.
    </p>
  )
}

function MemoBoard({ memos, dispatch, search, onCreate, writeBlocked }) {
  const searching = search.trim().length > 0
  const canCreate = !searching && !writeBlocked

  if (memos.length === 0) {
    return (
      <div className="empty-board">
        <article className="empty-note">
          <span className="pin pin-red" aria-hidden="true" />
          <h2>{searching ? '찾는 메모가 없어요' : '아직 붙여 둔 메모가 없어요'}</h2>
          <p>
            {searching
              ? '다른 단어로 검색하거나, 검색어를 지워 전체 메모를 보세요.'
              : '빈 종이를 붙이면 바로 적을 수 있어요.'}
          </p>
          {canCreate ? (
            <button className="save-btn" type="button" onClick={onCreate}>
              새 메모
            </button>
          ) : null}
        </article>
      </div>
    )
  }

  return (
    <section className="board">
      {canCreate ? (
        <button className="add-tile" type="button" onClick={onCreate}>
          <span className="add-plus">+</span>
          <strong>새 메모 붙이기</strong>
          <span>빈 종이를 붙이면 바로 수정 모드로 열려요</span>
        </button>
      ) : null}
      {memos.map((memo) => (
        <MemoCard key={memo.id} memo={memo} dispatch={dispatch} writeBlocked={writeBlocked} />
      ))}
    </section>
  )
}

function AuthScreen({ notice, onAuthenticated }) {
  const [mode, setMode] = useState('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [recovery, setRecovery] = useState(emptyRecovery)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [busy, setBusy] = useState(false)
  const isSignup = mode === 'signup'

  function changeMode(nextMode) {
    setMode(nextMode)
    setPassword('')
    setPasswordConfirm('')
    setError('')
    setInfo('')
  }

  function switchMode() {
    changeMode(isSignup ? 'login' : 'signup')
  }

  function backToLogin(foundUsername, message = '') {
    changeMode('login')
    if (foundUsername) setUsername(foundUsername)
    setInfo(message)
  }

  if (mode === 'findId' || mode === 'findPw') {
    return (
      <div className="desk">
        <main className="corkboard auth-board">
          {mode === 'findId' ? (
            <FindUsernameForm onBack={() => backToLogin()} onFound={(found) => backToLogin(found)} />
          ) : (
            <ResetPasswordForm
              onBack={() => backToLogin()}
              onDone={(found) => backToLogin(found, '비밀번호를 바꿨어요. 새 비밀번호로 로그인해 주세요.')}
            />
          )}
        </main>
      </div>
    )
  }

  async function onSubmit(event) {
    event.preventDefault()
    if (isSignup && password !== passwordConfirm) {
      setError('비밀번호 확인이 일치하지 않아요.')
      return
    }

    setBusy(true)
    setError('')
    try {
      const { user } = isSignup
        ? await signup(username, password, toRecoveryPayload(recovery))
        : await login(username, password)
      await onAuthenticated(user)
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="desk">
      <main className="corkboard auth-board">
        <form className="auth-note" onSubmit={onSubmit}>
          <span className="pin pin-red" aria-hidden="true" />
          <p className="eyebrow">{formatToday()}</p>
          <h1>{isSignup ? '회원가입' : '로그인'}</h1>
          <p className="auth-hint">
            {isSignup ? '아이디를 만들면 메모가 내 계정에 저장돼요.' : '로그인하고 내 메모를 열어 보세요.'}
          </p>

          <label className="auth-field">
            <span>아이디</span>
            <input
              value={username}
              autoComplete="username"
              placeholder="3~20자 한글, 영문, 숫자, _"
              required
              onChange={(event) => setUsername(event.target.value)}
            />
          </label>
          <label className="auth-field">
            <span>비밀번호</span>
            <PasswordInput
              value={password}
              autoComplete={isSignup ? 'new-password' : 'current-password'}
              placeholder={isSignup ? '8자 이상' : ''}
              required
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {isSignup ? (
            <label className="auth-field">
              <span>비밀번호 확인</span>
              <PasswordInput
                value={passwordConfirm}
                autoComplete="new-password"
                required
                onChange={(event) => setPasswordConfirm(event.target.value)}
              />
            </label>
          ) : null}
          {isSignup ? <RecoveryFields value={recovery} onChange={setRecovery} /> : null}

          {error || notice ? <p className="auth-error">{error || notice}</p> : null}
          {info && !error ? <p className="auth-info">{info}</p> : null}

          <button className="save-btn auth-submit" type="submit" disabled={busy}>
            {busy ? '잠시만요…' : isSignup ? '가입하기' : '로그인'}
          </button>
          {isSignup ? null : (
            <p className="auth-links">
              <button className="auth-switch" type="button" onClick={() => changeMode('findId')}>
                아이디 찾기
              </button>
              <span aria-hidden="true">·</span>
              <button className="auth-switch" type="button" onClick={() => changeMode('findPw')}>
                비밀번호 찾기
              </button>
            </p>
          )}
          <button className="auth-switch" type="button" onClick={switchMode}>
            {isSignup ? '이미 계정이 있어요 · 로그인' : '처음이에요 · 회원가입'}
          </button>
        </form>
      </main>
    </div>
  )
}

function MemoApp({ user, initialMemos, onLogout, onSessionExpired, onWithdrawn, onUserChange }) {
  const [state, dispatch] = useReducer(memoReducer, initialMemos, createInitialState)
  const [saveStatus, setSaveStatus] = useState('saved')
  const [view, setView] = useState('memos')
  const [withdrawing, setWithdrawing] = useState(false)
  const [accountTab, setAccountTab] = useState(null)
  const leavingRef = useRef(false)
  const writeBlocked = Boolean(user.writeBlockedUntil && user.writeBlockedUntil > Date.now())
  const visibleMemos = selectVisibleMemos(state)
  const editingCount = selectEditingCount(state)
  const pinnedCount = selectPinnedCount(state)
  const payload = JSON.stringify(selectSavedMemos(state))
  const lastSentRef = useRef(payload)
  const queueRef = useRef(Promise.resolve())

  const persist = useCallback(
    (nextPayload) => {
      if (leavingRef.current) return queueRef.current
      lastSentRef.current = nextPayload
      queueRef.current = queueRef.current
        .then(() => saveMemos(JSON.parse(nextPayload)))
        .then(() => {
          if (lastSentRef.current === nextPayload) setSaveStatus('saved')
        })
        .catch((error) => {
          if (error.status === 401) {
            onSessionExpired()
            return
          }
          lastSentRef.current = null
          setSaveStatus('error')
        })
      return queueRef.current
    },
    [onSessionExpired],
  )

  useEffect(() => {
    if (payload === lastSentRef.current) return undefined
    setSaveStatus('saving')
    const timer = setTimeout(() => persist(payload), 500)
    return () => clearTimeout(timer)
  }, [payload, persist])

  async function handleLogout() {
    if (payload !== lastSentRef.current) persist(payload)
    await queueRef.current
    await onLogout()
  }

  const closeWithdraw = useCallback(() => setWithdrawing(false), [])
  const closeAccount = useCallback(() => setAccountTab(null), [])

  async function handleWithdraw(password) {
    leavingRef.current = true
    await queueRef.current
    try {
      await withdraw(password)
    } catch (error) {
      leavingRef.current = false
      throw error
    }
    onWithdrawn()
  }

  return (
    <div className="desk">
      <Header
        search={state.search}
        onSearch={(query) => dispatch(setSearch(query))}
        onCreate={() => dispatch(createMemo())}
        resultCount={visibleMemos.length}
        totalCount={state.memos.length}
        editingCount={editingCount}
        pinnedCount={pinnedCount}
        saveStatus={saveStatus}
        user={user}
        view={view}
        writeBlocked={writeBlocked}
        onToggleAdmin={() => setView(view === 'admin' ? 'memos' : 'admin')}
        onLogout={handleLogout}
        onWithdraw={() => setWithdrawing(true)}
        onAccount={() => setAccountTab('password')}
      />
      {accountTab ? (
        <AccountDialog user={user} initialTab={accountTab} onClose={closeAccount} onUserChange={onUserChange} />
      ) : null}
      {withdrawing ? (
        <WithdrawDialog
          username={user.username}
          memoCount={selectSavedMemos(state).length}
          onCancel={closeWithdraw}
          onConfirm={handleWithdraw}
        />
      ) : null}
      <main className="corkboard">
        {view === 'admin' ? (
          <AdminPanel currentUser={user} onSessionExpired={onSessionExpired} />
        ) : (
          <>
            {user.hasRecovery ? null : (
              <p className="recovery-banner">
                아이디·비밀번호를 잊었을 때 찾을 수 있도록 이메일과 보안 질문을 등록해 주세요.
                <button className="tool-btn is-on" type="button" onClick={() => setAccountTab('recovery')}>
                  지금 등록
                </button>
              </p>
            )}
            {writeBlocked ? <WriteBlockNotice until={user.writeBlockedUntil} /> : null}
            <MemoBoard
              memos={visibleMemos}
              dispatch={dispatch}
              search={state.search}
              writeBlocked={writeBlocked}
              onCreate={() => dispatch(createMemo())}
            />
          </>
        )}
      </main>
    </div>
  )
}

function App() {
  const [session, setSession] = useState({ status: 'loading' })

  const enter = useCallback(async (user) => {
    try {
      const { memos } = await fetchMemos()
      setSession({ status: 'ready', user, memos })
    } catch (error) {
      setSession({ status: 'guest', notice: error.message })
    }
  }, [])

  const handleSessionExpired = useCallback(() => {
    setSession({ status: 'guest', notice: '로그인이 만료됐어요. 다시 로그인해 주세요.' })
  }, [])

  const handleWithdrawn = useCallback(() => {
    setSession({ status: 'guest', notice: '회원 탈퇴가 완료됐어요. 그동안 이용해 주셔서 고마워요.' })
  }, [])

  async function handleLogout() {
    try {
      await logout()
      setSession({ status: 'guest' })
    } catch (error) {
      setSession({ status: 'guest', notice: error.message })
    }
  }

  useEffect(() => {
    fetchMe()
      .then(({ user }) => (user ? enter(user) : setSession({ status: 'guest' })))
      .catch((error) => setSession({ status: 'guest', notice: error.message }))
  }, [enter])

  if (session.status === 'loading') {
    return (
      <div className="desk">
        <main className="corkboard auth-board">
          <p className="auth-loading">메모장을 여는 중…</p>
        </main>
      </div>
    )
  }

  if (session.status === 'guest') {
    return <AuthScreen notice={session.notice} onAuthenticated={enter} />
  }

  return (
    <MemoApp
      key={session.user.id}
      user={session.user}
      initialMemos={session.memos}
      onLogout={handleLogout}
      onSessionExpired={handleSessionExpired}
      onWithdrawn={handleWithdrawn}
      onUserChange={(user) => setSession((current) => ({ ...current, user }))}
    />
  )
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
    <KeyboardStatus />
  </StrictMode>,
)
