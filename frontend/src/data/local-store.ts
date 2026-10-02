import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
// 结构升级（字段补齐、口径变更）时递增版本号，旧缓存整库作废、重新播种。
const STORAGE_KEY = 'geohazard-patrol:entries'
const VERSION_KEY = 'geohazard-patrol:version'
const STORAGE_VERSION = 2

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function seedStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    window.localStorage.setItem(VERSION_KEY, String(STORAGE_VERSION))
  }
  return fallback
}

function readStorage(): Record<string, EntryRow[]> {
  if (typeof window === 'undefined' || !window.localStorage) {
    return clone(SEED_ROWS)
  }
  if (window.localStorage.getItem(VERSION_KEY) !== String(STORAGE_VERSION)) {
    return seedStorage()
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    return seedStorage()
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    return { ...clone(SEED_ROWS), ...parsed }
  } catch {
    return seedStorage()
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
  saveMany({ [key]: rows })
}

// 跨模块的一次落库：多个模块合到同一次写入里，避免「工程写了一半、会商没回写」。
export function saveMany(entries: Record<string, EntryRow[]>): void {
  const next = { ...allRows(), ...entries }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    window.localStorage.setItem(VERSION_KEY, String(STORAGE_VERSION))
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
