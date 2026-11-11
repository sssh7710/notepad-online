import { useEffect, useLayoutEffect, useRef, useState } from 'react'

const REVEAL_MS = 5000
const MASK = navigator.userAgent.includes('Firefox') ? '●' : '•'

let measureContext = null

function maskWidth(font) {
  measureContext ??= document.createElement('canvas').getContext('2d')
  measureContext.font = font
  return measureContext.measureText(MASK).width
}

// The real <input type="password"> does the masking; only the character just
// typed is painted on top of its own dot, so at most one is ever visible.
export function PasswordInput({ value, onChange, onBlur, ...props }) {
  const inputRef = useRef(null)
  const timerRef = useRef(null)
  const [peek, setPeek] = useState(null)
  const [place, setPlace] = useState(null)

  function hide() {
    clearTimeout(timerRef.current)
    setPeek(null)
  }

  function handleChange(event) {
    onChange(event)
    const input = event.target
    const { inputType } = event.nativeEvent
    const caret = input.selectionEnd ?? input.value.length
    if ((inputType === 'insertText' || inputType === 'insertCompositionText') && caret > 0) {
      clearTimeout(timerRef.current)
      setPeek({ index: caret - 1, char: input.value[caret - 1] })
      timerRef.current = setTimeout(() => setPeek(null), REVEAL_MS)
    } else {
      hide()
    }
  }

  const visible = peek && value[peek.index] === peek.char ? peek : null

  useLayoutEffect(() => {
    const input = inputRef.current
    if (!visible || !input) {
      setPlace(null)
      return
    }
    const style = getComputedStyle(input)
    const font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
    const dot = maskWidth(font)
    const start = parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft)
    setPlace({
      left: input.offsetLeft + start + dot * visible.index - input.scrollLeft,
      minWidth: dot,
      font,
    })
  }, [visible, value])

  useEffect(() => () => clearTimeout(timerRef.current), [])

  return (
    <span className="password-field">
      <input
        {...props}
        ref={inputRef}
        type="password"
        value={value}
        onChange={handleChange}
        onBlur={(event) => {
          hide()
          onBlur?.(event)
        }}
      />
      {visible && place && (
        <span className="password-peek" style={place} aria-hidden="true">
          {visible.char}
        </span>
      )}
    </span>
  )
}

function isTypingTarget(element) {
  if (!element) return false
  if (element.isContentEditable) return true
  if (element.tagName === 'TEXTAREA') return true
  return element.tagName === 'INPUT' && ['text', 'search', 'email', 'password', 'url', 'tel', ''].includes(element.type)
}

const HANGUL = /[ㄱ-ㅎㅏ-ㅣ가-힣]/
const LATIN = /^[a-zA-Z]$/

// The 한/영 key reports differently per keyboard and IME (and the IME may
// swallow its keydown), so any of these signals counts as a toggle.
function isHanYoungKey(event) {
  if (event.key === 'HangulMode' || event.key === 'Hangul' || event.keyCode === 21) return true
  if (event.code === 'Lang1') return true
  return event.code === 'AltRight' && (event.key === 'Process' || event.key === 'Unidentified')
}

// Browsers don't expose the IME state, so the language is tracked from the
// 한/영 key and inferred from keystrokes.
export function KeyboardStatus() {
  const [focused, setFocused] = useState(() => isTypingTarget(document.activeElement))
  const [lang, setLang] = useState(null)
  const [caps, setCaps] = useState(null)
  const toggledOnDownRef = useRef(false)

  useEffect(() => {
    function readCaps(event) {
      if (typeof event.getModifierState === 'function') setCaps(event.getModifierState('CapsLock'))
    }
    function toggle() {
      setLang((current) => (current === 'ko' ? 'en' : 'ko'))
    }
    function handleKeyDown(event) {
      readCaps(event)
      if (isHanYoungKey(event)) {
        if (!event.repeat) toggle()
        toggledOnDownRef.current = true
        return
      }
      if (event.key === 'Process' || event.keyCode === 229 || HANGUL.test(event.key)) {
        setLang('ko')
        return
      }
      if (!LATIN.test(event.key)) return
      // Password fields ignore the IME, so Latin keys there say nothing about it.
      if (event.target?.type === 'password') setLang((current) => current ?? 'en')
      else setLang('en')
    }
    function handleKeyUp(event) {
      readCaps(event)
      if (!isHanYoungKey(event)) return
      if (!toggledOnDownRef.current) toggle()
      toggledOnDownRef.current = false
    }
    function syncFocus() {
      setFocused(isTypingTarget(document.activeElement))
    }
    function handleFocusOut() {
      setTimeout(syncFocus, 0)
    }
    document.addEventListener('keydown', handleKeyDown, true)
    document.addEventListener('keyup', handleKeyUp, true)
    document.addEventListener('mousedown', readCaps, true)
    document.addEventListener('focusin', syncFocus)
    document.addEventListener('focusout', handleFocusOut)
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true)
      document.removeEventListener('keyup', handleKeyUp, true)
      document.removeEventListener('mousedown', readCaps, true)
      document.removeEventListener('focusin', syncFocus)
      document.removeEventListener('focusout', handleFocusOut)
    }
  }, [])

  if (!focused) return null

  let label = '글자를 치거나 한/영 키를 누르면 표시돼요'
  if (lang === 'ko') label = '한글'
  else if (lang === 'en') label = caps ? '영어 대문자' : '영어 소문자'

  return (
    <div className="keyboard-status" role="status" aria-live="polite">
      <span className="keyboard-status-title">입력 언어</span>
      <strong className={`keyboard-status-lang${lang ? ` is-${lang}` : ''}`}>{label}</strong>
      {caps && <span className="keyboard-status-caps">Caps Lock 켜짐</span>}
    </div>
  )
}
