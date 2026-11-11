export const ACTION_TYPES = {
  CREATE_MEMO: 'CREATE_MEMO',
  START_EDIT: 'START_EDIT',
  CHANGE_MEMO: 'CHANGE_MEMO',
  SAVE_MEMO: 'SAVE_MEMO',
  CANCEL_EDIT: 'CANCEL_EDIT',
  DELETE_MEMO: 'DELETE_MEMO',
  SET_COLOR: 'SET_COLOR',
  TOGGLE_PIN: 'TOGGLE_PIN',
  SET_SEARCH: 'SET_SEARCH',
}

export const NOTE_COLORS = ['butter', 'mint', 'peach', 'sky', 'lilac']

export const COLOR_LABELS = {
  butter: '노랑',
  mint: '민트',
  peach: '복숭아',
  sky: '하늘',
  lilac: '보라',
}

function pickColor() {
  return NOTE_COLORS[Math.floor(Math.random() * NOTE_COLORS.length)]
}

export function createMemo() {
  const now = Date.now()
  return {
    type: ACTION_TYPES.CREATE_MEMO,
    payload: {
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
      color: pickColor(),
    },
  }
}

export function startEdit(id) {
  return {
    type: ACTION_TYPES.START_EDIT,
    payload: { id },
  }
}

export function changeMemo(id, field, value) {
  return {
    type: ACTION_TYPES.CHANGE_MEMO,
    payload: { id, field, value },
  }
}

export function saveMemo(id) {
  return {
    type: ACTION_TYPES.SAVE_MEMO,
    payload: { id, updatedAt: Date.now() },
  }
}

export function cancelEdit(id) {
  return {
    type: ACTION_TYPES.CANCEL_EDIT,
    payload: { id },
  }
}

export function deleteMemo(id) {
  return {
    type: ACTION_TYPES.DELETE_MEMO,
    payload: { id },
  }
}

export function setColor(id, color) {
  return {
    type: ACTION_TYPES.SET_COLOR,
    payload: { id, color, updatedAt: Date.now() },
  }
}

export function togglePin(id) {
  return {
    type: ACTION_TYPES.TOGGLE_PIN,
    payload: { id },
  }
}

export function setSearch(query) {
  return {
    type: ACTION_TYPES.SET_SEARCH,
    payload: { query },
  }
}

function snapshot(memo) {
  return {
    title: memo.title,
    content: memo.content,
    color: memo.color,
  }
}

function restore(memo) {
  if (!memo.backup) {
    return { ...memo, isEditing: false, backup: undefined }
  }
  return {
    ...memo,
    title: memo.backup.title,
    content: memo.backup.content,
    color: memo.backup.color,
    isEditing: false,
    backup: undefined,
  }
}

function closeOtherEdits(memos, keepId) {
  return memos.flatMap((memo) => {
    if (memo.id === keepId || !memo.isEditing) return [memo]
    if (memo.isNew) return []
    return [restore(memo)]
  })
}

export function memoReducer(state, action) {
  switch (action.type) {
    case ACTION_TYPES.CREATE_MEMO: {
      const memo = {
        id: action.payload.id,
        title: '',
        content: '',
        isEditing: true,
        isNew: true,
        pinned: false,
        color: action.payload.color,
        createdAt: action.payload.createdAt,
        updatedAt: action.payload.updatedAt,
        backup: { title: '', content: '', color: action.payload.color },
      }
      return {
        ...state,
        memos: [memo, ...closeOtherEdits(state.memos)],
      }
    }

    case ACTION_TYPES.START_EDIT:
      return {
        ...state,
        memos: closeOtherEdits(state.memos, action.payload.id).map((memo) =>
          memo.id === action.payload.id
            ? { ...memo, isEditing: true, backup: snapshot(memo) }
            : memo,
        ),
      }

    case ACTION_TYPES.CHANGE_MEMO:
      return {
        ...state,
        memos: state.memos.map((memo) => {
          if (memo.id !== action.payload.id || !memo.isEditing) return memo
          return { ...memo, [action.payload.field]: action.payload.value }
        }),
      }

    case ACTION_TYPES.SAVE_MEMO:
      return {
        ...state,
        memos: state.memos.map((memo) => {
          if (memo.id !== action.payload.id || !memo.isEditing) return memo
          const title = memo.title.trim() || '새 메모'
          return {
            ...memo,
            title,
            content: memo.content.trim(),
            isEditing: false,
            isNew: false,
            backup: undefined,
            updatedAt: action.payload.updatedAt,
          }
        }),
      }

    case ACTION_TYPES.CANCEL_EDIT:
      return {
        ...state,
        memos: state.memos.flatMap((memo) => {
          if (memo.id !== action.payload.id || !memo.isEditing) return [memo]
          if (memo.isNew) return []
          return [restore(memo)]
        }),
      }

    case ACTION_TYPES.DELETE_MEMO:
      return {
        ...state,
        memos: state.memos.filter((memo) => memo.id !== action.payload.id),
      }

    case ACTION_TYPES.SET_COLOR:
      return {
        ...state,
        memos: state.memos.map((memo) => {
          if (memo.id !== action.payload.id) return memo
          return {
            ...memo,
            color: action.payload.color,
            updatedAt: memo.isEditing ? memo.updatedAt : action.payload.updatedAt,
          }
        }),
      }

    case ACTION_TYPES.TOGGLE_PIN:
      return {
        ...state,
        memos: state.memos.map((memo) =>
          memo.id === action.payload.id ? { ...memo, pinned: !memo.pinned } : memo,
        ),
      }

    case ACTION_TYPES.SET_SEARCH:
      return {
        ...state,
        search: action.payload.query,
      }

    default:
      return state
  }
}

export function selectVisibleMemos(state) {
  const query = state.search.trim().toLowerCase()
  const filtered = query
    ? state.memos.filter((memo) => {
        const title = memo.title.toLowerCase()
        const content = memo.content.toLowerCase()
        return title.includes(query) || content.includes(query)
      })
    : state.memos

  return filtered.slice().sort((a, b) => Number(b.pinned) - Number(a.pinned))
}

export function selectEditingCount(state) {
  return state.memos.filter((memo) => memo.isEditing).length
}

export function selectPinnedCount(state) {
  return state.memos.filter((memo) => memo.pinned).length
}

export function createInitialState(savedMemos) {
  return {
    search: '',
    memos: savedMemos.map((memo) => ({
      id: memo.id,
      title: memo.title ?? '',
      content: memo.content ?? '',
      color: memo.color ?? 'butter',
      pinned: Boolean(memo.pinned),
      isNew: false,
      isEditing: false,
      createdAt: memo.createdAt ?? Date.now(),
      updatedAt: memo.updatedAt ?? Date.now(),
    })),
  }
}

// 수정 중인 메모는 마지막으로 저장한 내용으로, 아직 저장하지 않은 새 메모는 빼고 서버에 보낸다.
export function selectSavedMemos(state) {
  return state.memos
    .filter((memo) => !memo.isNew)
    .map((memo) => {
      const saved = memo.isEditing && memo.backup ? { ...memo, ...memo.backup } : memo
      return {
        id: saved.id,
        title: saved.title,
        content: saved.content,
        color: saved.color,
        pinned: Boolean(saved.pinned),
        createdAt: saved.createdAt,
        updatedAt: saved.updatedAt,
      }
    })
}
