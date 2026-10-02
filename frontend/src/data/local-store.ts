import { SEED_ROWS } from './seed'
import type { DisbursementTodo, EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
// v2：工程记录归一化（同编号去重、字段补齐、金额落库为唯一数值）+ 待核拨付台账。
const STORAGE_KEY = 'geohazard-patrol:entries:v2'
const DISBURSEMENT_KEY = 'geohazard-patrol:disbursement:v1'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    return { ...fallback, ...parsed }
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}

// ── 待核拨付台账：批复提交成功后追加，专家会商清单从这里读，两处读同一份。 ──────────────

let todoCache: DisbursementTodo[] | null = null

export function listDisbursementTodos(): DisbursementTodo[] {
  if (todoCache !== null) {
    return todoCache
  }
  if (typeof window === 'undefined' || !window.localStorage) {
    todoCache = []
    return todoCache
  }
  try {
    todoCache = JSON.parse(window.localStorage.getItem(DISBURSEMENT_KEY) ?? '[]') as DisbursementTodo[]
  } catch {
    todoCache = []
  }
  return todoCache
}

export function appendDisbursementTodo(todo: DisbursementTodo): void {
  const next = [...listDisbursementTodos().filter((item) => item.key !== todo.key), todo]
  todoCache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(DISBURSEMENT_KEY, JSON.stringify(next))
  }
}

export function hasDisbursementTodo(key: string): boolean {
  return listDisbursementTodos().some((item) => item.key === key)
}
