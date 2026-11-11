import { useEffect, useState } from 'react'
import {
  changeEmail,
  changePassword,
  fetchRecoveryQuestion,
  findUsername,
  resetPassword,
  updateRecovery,
} from './api.js'
import { PasswordInput } from './password.jsx'

const SECURITY_QUESTIONS = [
  '내가 다닌 초등학교 이름은?',
  '어릴 적 가장 친했던 친구 이름은?',
  '처음 키운 반려동물 이름은?',
  '가장 좋아하는 음식은?',
  '태어난 도시는?',
]
const CUSTOM_QUESTION = 'custom'
const MIN_PASSWORD = 8

export const emptyRecovery = { email: '', question: SECURITY_QUESTIONS[0], customQuestion: '', answer: '' }

export function toRecoveryPayload(value) {
  return {
    email: value.email,
    securityQuestion: value.question === CUSTOM_QUESTION ? value.customQuestion : value.question,
    securityAnswer: value.answer,
  }
}

export function RecoveryFields({ value, onChange }) {
  const set = (field) => (event) => onChange({ ...value, [field]: event.target.value })

  return (
    <>
      <label className="auth-field">
        <span>이메일</span>
        <input
          type="email"
          value={value.email}
          autoComplete="email"
          placeholder="아이디 찾기에 사용해요"
          required
          onChange={set('email')}
        />
      </label>
      <label className="auth-field">
        <span>보안 질문</span>
        <select value={value.question} onChange={set('question')}>
          {SECURITY_QUESTIONS.map((question) => (
            <option key={question} value={question}>
              {question}
            </option>
          ))}
          <option value={CUSTOM_QUESTION}>직접 입력하기</option>
        </select>
      </label>
      {value.question === CUSTOM_QUESTION ? (
        <label className="auth-field">
          <span>내 질문</span>
          <input value={value.customQuestion} maxLength={60} required onChange={set('customQuestion')} />
        </label>
      ) : null}
      <label className="auth-field">
        <span>질문의 답</span>
        <input
          value={value.answer}
          maxLength={60}
          autoComplete="off"
          placeholder="띄어쓰기·대소문자는 구분하지 않아요"
          required
          onChange={set('answer')}
        />
      </label>
    </>
  )
}

function RecoveryNote({ title, hint, error, busy, submitLabel, onSubmit, onBack, children }) {
  return (
    <form className="auth-note" onSubmit={onSubmit}>
      <span className="pin pin-blue" aria-hidden="true" />
      <h1>{title}</h1>
      <p className="auth-hint">{hint}</p>
      {children}
      {error ? <p className="auth-error">{error}</p> : null}
      {submitLabel ? (
        <button className="save-btn auth-submit" type="submit" disabled={busy}>
          {busy ? '잠시만요…' : submitLabel}
        </button>
      ) : null}
      <button className="auth-switch" type="button" onClick={onBack}>
        로그인으로 돌아가기
      </button>
    </form>
  )
}

function useRequest() {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function run(task) {
    setBusy(true)
    setError('')
    try {
      await task()
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setBusy(false)
    }
  }

  return { error, busy, run }
}

export function FindUsernameForm({ onBack, onFound }) {
  const [email, setEmail] = useState('')
  const [question, setQuestion] = useState(null)
  const [answer, setAnswer] = useState('')
  const [found, setFound] = useState(null)
  const { error, busy, run } = useRequest()

  function onSubmit(event) {
    event.preventDefault()
    run(async () => {
      if (question === null) {
        setQuestion((await fetchRecoveryQuestion({ email })).question)
        return
      }
      setFound((await findUsername(email, answer)).username)
    })
  }

  if (found) {
    return (
      <RecoveryNote title="아이디 찾기" hint="가입하신 아이디를 찾았어요." onBack={onBack}>
        <p className="recovery-result">{found}</p>
        <button className="save-btn auth-submit" type="button" onClick={() => onFound(found)}>
          이 아이디로 로그인
        </button>
      </RecoveryNote>
    )
  }

  return (
    <RecoveryNote
      title="아이디 찾기"
      hint={question === null ? '가입할 때 등록한 이메일을 입력해 주세요.' : '보안 질문에 답해 주세요.'}
      error={error}
      busy={busy}
      submitLabel={question === null ? '다음' : '아이디 찾기'}
      onSubmit={onSubmit}
      onBack={onBack}
    >
      <label className="auth-field">
        <span>이메일</span>
        <input
          type="email"
          value={email}
          autoComplete="email"
          required
          disabled={question !== null}
          onChange={(event) => setEmail(event.target.value)}
        />
      </label>
      {question !== null ? (
        <label className="auth-field">
          <span>{question}</span>
          <input value={answer} autoComplete="off" autoFocus required onChange={(event) => setAnswer(event.target.value)} />
        </label>
      ) : null}
    </RecoveryNote>
  )
}

export function ResetPasswordForm({ onBack, onDone }) {
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [question, setQuestion] = useState(null)
  const [answer, setAnswer] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const { error, busy, run } = useRequest()

  function onSubmit(event) {
    event.preventDefault()
    run(async () => {
      if (question === null) {
        setQuestion((await fetchRecoveryQuestion({ username, email })).question)
        return
      }
      if (password.length < MIN_PASSWORD) throw new Error(`새 비밀번호는 ${MIN_PASSWORD}자 이상이어야 해요.`)
      if (password !== passwordConfirm) throw new Error('비밀번호 확인이 일치하지 않아요.')
      onDone((await resetPassword(username, email, answer, password)).username)
    })
  }

  return (
    <RecoveryNote
      title="비밀번호 찾기"
      hint={
        question === null
          ? '아이디와 가입할 때 등록한 이메일을 입력해 주세요.'
          : '보안 질문에 답하고 새 비밀번호를 정해 주세요.'
      }
      error={error}
      busy={busy}
      submitLabel={question === null ? '다음' : '비밀번호 바꾸기'}
      onSubmit={onSubmit}
      onBack={onBack}
    >
      <label className="auth-field">
        <span>아이디</span>
        <input
          value={username}
          autoComplete="username"
          required
          disabled={question !== null}
          onChange={(event) => setUsername(event.target.value)}
        />
      </label>
      <label className="auth-field">
        <span>이메일</span>
        <input
          type="email"
          value={email}
          autoComplete="email"
          required
          disabled={question !== null}
          onChange={(event) => setEmail(event.target.value)}
        />
      </label>
      {question !== null ? (
        <>
          <label className="auth-field">
            <span>{question}</span>
            <input value={answer} autoComplete="off" autoFocus required onChange={(event) => setAnswer(event.target.value)} />
          </label>
          <label className="auth-field">
            <span>새 비밀번호</span>
            <PasswordInput
              value={password}
              autoComplete="new-password"
              placeholder="8자 이상"
              required
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <label className="auth-field">
            <span>새 비밀번호 확인</span>
            <PasswordInput
              value={passwordConfirm}
              autoComplete="new-password"
              required
              onChange={(event) => setPasswordConfirm(event.target.value)}
            />
          </label>
        </>
      ) : null}
    </RecoveryNote>
  )
}

const ACCOUNT_TABS = [
  { id: 'password', label: '비밀번호 변경' },
  { id: 'email', label: '이메일 변경' },
  { id: 'recovery', label: '찾기 정보' },
]

const ACCOUNT_HINTS = {
  password: '비밀번호를 바꾸면 다른 기기에서는 로그아웃돼요.',
  email: '아이디 찾기와 연락에 쓰는 이메일이에요.',
  recovery: '아이디·비밀번호를 잊었을 때 이 이메일과 보안 질문으로 본인 확인을 해요.',
}

export function AccountDialog({ user, initialTab = 'password', onClose, onUserChange }) {
  const [tab, setTab] = useState(initialTab)
  const [password, setPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newPasswordConfirm, setNewPasswordConfirm] = useState('')
  const [email, setEmail] = useState(user.email ?? '')
  const [recovery, setRecovery] = useState({ ...emptyRecovery, email: user.email ?? '' })
  const [done, setDone] = useState('')
  const { error, busy, run } = useRequest()

  useEffect(() => {
    function onKeyDown(event) {
      if (event.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [busy, onClose])

  function switchTab(nextTab) {
    if (busy) return
    setTab(nextTab)
    setPassword('')
    setDone('')
  }

  function onSubmit(event) {
    event.preventDefault()
    setDone('')
    run(async () => {
      if (tab === 'password') {
        if (newPassword.length < MIN_PASSWORD) throw new Error(`새 비밀번호는 ${MIN_PASSWORD}자 이상이어야 해요.`)
        if (newPassword !== newPasswordConfirm) throw new Error('새 비밀번호 확인이 일치하지 않아요.')
        await changePassword(password, newPassword)
        setNewPassword('')
        setNewPasswordConfirm('')
        setDone('비밀번호를 바꿨어요.')
      } else if (tab === 'email') {
        const data = await changeEmail(password, email)
        onUserChange(data.user)
        setEmail(data.user.email)
        setDone('이메일을 바꿨어요.')
      } else {
        const data = await updateRecovery(password, toRecoveryPayload(recovery))
        onUserChange(data.user)
        setRecovery({ ...emptyRecovery, email: data.user.email })
        setDone('찾기 정보를 저장했어요.')
      }
      setPassword('')
    })
  }

  return (
    <div className="dialog-backdrop" role="presentation" onClick={busy ? undefined : onClose}>
      <form
        className="auth-note recovery-note"
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-title"
        onSubmit={onSubmit}
        onClick={(event) => event.stopPropagation()}
      >
        <span className="pin pin-blue" aria-hidden="true" />
        <h1 id="account-title">내 정보</h1>
        <div className="account-tabs" role="tablist">
          {ACCOUNT_TABS.map((item) => (
            <button
              key={item.id}
              className={`tool-btn ${tab === item.id ? 'is-on' : ''}`}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              onClick={() => switchTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <p className="auth-hint">{ACCOUNT_HINTS[tab]}</p>

        {tab === 'password' ? (
          <>
            <label className="auth-field">
              <span>새 비밀번호</span>
              <PasswordInput
                value={newPassword}
                autoComplete="new-password"
                placeholder="8자 이상"
                required
                onChange={(event) => setNewPassword(event.target.value)}
              />
            </label>
            <label className="auth-field">
              <span>새 비밀번호 확인</span>
              <PasswordInput
                value={newPasswordConfirm}
                autoComplete="new-password"
                required
                onChange={(event) => setNewPasswordConfirm(event.target.value)}
              />
            </label>
          </>
        ) : null}

        {tab === 'email' ? (
          <>
            <p className="account-current">현재 이메일: {user.email ?? '등록되지 않음'}</p>
            <label className="auth-field">
              <span>새 이메일</span>
              <input
                type="email"
                value={email}
                autoComplete="email"
                required
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
          </>
        ) : null}

        {tab === 'recovery' ? <RecoveryFields value={recovery} onChange={setRecovery} /> : null}

        <label className="auth-field">
          <span>현재 비밀번호</span>
          <PasswordInput
            value={password}
            autoComplete="current-password"
            required
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {error ? <p className="auth-error">{error}</p> : null}
        {done && !error ? <p className="auth-info">{done}</p> : null}
        <button className="save-btn auth-submit" type="submit" disabled={busy}>
          {busy ? '저장하는 중…' : '저장하기'}
        </button>
        <button className="auth-switch" type="button" onClick={onClose} disabled={busy}>
          닫기
        </button>
      </form>
    </div>
  )
}
