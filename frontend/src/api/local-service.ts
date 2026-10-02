import { MODULE_BY_KEY } from '@/data/modules'
import {
  appendDisbursementTodo,
  listDisbursementTodos,
  listRows,
  resetRows,
  saveRows,
  allRows,
} from '@/data/local-store'
import {
  AMOUNT_FIELD,
  APPROVAL_DATE_FIELD,
  APPROVAL_REQUIRED_FIELDS,
  CODE_FIELD,
  CONTRACTOR_FIELD,
  PROJECT_ACTIONS,
  PROJECT_KEY,
  PROJECT_STATUSES,
  canonicalCode,
  canonicalizeProjects,
  checkAmount,
  nextProjectStatus,
  parseAmount,
} from '@/data/project-domain'
import type {
  ActionResult,
  DisbursementTodo,
  EntryRow,
  ModuleMeta,
  OverviewResult,
  PageResult,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

/**
 * 治理工程读取入口（唯一）：读出后先做一次归一化并回写——
 * 同一工程编号合并成一条、缺失字段补齐、金额裁定为唯一数值。
 * 侧栏、详情、弹窗都走这一条，读出来的批复金额不可能两样。
 */
function readProjects(): EntryRow[] {
  const raw = listRows(PROJECT_KEY)
  const { rows, deduped } = canonicalizeProjects(raw)
  if (deduped > 0 || JSON.stringify(rows) !== JSON.stringify(raw)) {
    saveRows(PROJECT_KEY, rows)
  }
  return rows
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const rows = key === PROJECT_KEY ? readProjects() : listRows(key)
  const matched = filterRows(rows, filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

/** 严格状态机：只允许推进到 statuses 中相邻的下一个态；回退、跳级一律拦下。 */
function strictNextStatus(meta: ModuleMeta, current: string): string | null {
  const index = meta.statuses.indexOf(current)
  if (index < 0 || index >= meta.statuses.length - 1) {
    return null
  }
  return meta.statuses[index + 1]
}

/** 通用动作：strict 模块只能顺序推进；其余模块沿用原目标态流转。 */
export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  if (key === PROJECT_KEY) {
    return runProjectAction(id, action)
  }
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (meta.strict) {
    const allowed = strictNextStatus(meta, current)
    if (allowed === null) {
      return { ok: false, message: `${meta.entity}已到「${current}」，没有可继续推进的状态` }
    }
    if (allowed !== target) {
      return { ok: false, message: `状态只能顺着 ${meta.statuses.join('→')} 推进，不能从「${current}」直接「${action}」` }
    }
  } else if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

// ── 治理工程专属流转 ─────────────────────────────────────────────────────────

/** 进行中的提交：连续点两次（含双击）第二次直接拦下，只落库一次。 */
const inFlight = new Set<string>()
const inFlightClear = new Map<string, ReturnType<typeof setTimeout>>()

function lock(key: string, action: string): boolean {
  const token = `${key}:${action}`
  if (inFlight.has(token)) {
    return false
  }
  inFlight.add(token)
  inFlightClear.set(
    token,
    setTimeout(() => {
      inFlight.delete(token)
      inFlightClear.delete(token)
    }, 4000),
  )
  return true
}

function unlock(key: string, action: string): void {
  const token = `${key}:${action}`
  inFlight.delete(token)
  const timer = inFlightClear.get(token)
  if (timer) {
    clearTimeout(timer)
    inFlightClear.delete(token)
  }
}

function runProjectAction(id: number, action: string): ActionResult {
  if (!PROJECT_ACTIONS.includes(action as (typeof PROJECT_ACTIONS)[number])) {
    return { ok: false, message: `治理工程没有登记「${action}」这个动作` }
  }
  if (!lock(String(id), action)) {
    return { ok: false, message: '上一次提交仍在处理，请勿连续点击（本次未重复记账）' }
  }
  try {
    const rows = readProjects()
    const index = rows.findIndex((row) => Number(row.id) === id)
    if (index < 0) {
      return { ok: false, message: `没有找到编号为 ${id} 的治理工程` }
    }
    const current = String(rows[index].status)
    const target = nextProjectStatus(current)
    if (target === null) {
      return { ok: false, message: `工程已到「${current}」，没有可继续推进的状态` }
    }
    const expectedAction =
      current === PROJECT_STATUSES[0]
        ? '提交批复'
        : current === PROJECT_STATUSES[1]
          ? '开始施工'
          : '确认竣工'
    if (action !== expectedAction) {
      return {
        ok: false,
        message: `状态只能顺着 ${PROJECT_STATUSES.join('→')} 推进，「${current}」时只能「${expectedAction}」，不能直接「${action}」`,
      }
    }

    const updated: EntryRow = {
      ...rows[index],
      status: target,
      pending: target !== PROJECT_STATUSES[PROJECT_STATUSES.length - 1],
    }
    const next = [...rows]
    next[index] = updated
    saveRows(PROJECT_KEY, next)

    // 提交批复成功：批复结果回写到专家会商清单（待核拨付台账，按工程幂等只追加一次）。
    if (action === '提交批复') {
      writeBackDisbursement(updated)
    }
    return { ok: true, message: `工程已${action}，当前状态「${target}」` }
  } finally {
    unlock(String(id), action)
  }
}

export type ApprovalPayload = {
  工程编号?: string
  批复日期?: string
  批复金额?: string | number
  承建单位?: string
}

export type SubmitApprovalResult = ActionResult & { todo?: DisbursementTodo }

/** 登记治理工程：所有批复字段一次落库，金额越界当场挡回。 */
export function createProject(payload: ApprovalPayload): SubmitApprovalResult {
  const code = canonicalCode(payload[CODE_FIELD])
  if (!code) {
    return { ok: false, message: '工程编号不能为空' }
  }
  for (const field of APPROVAL_REQUIRED_FIELDS) {
    const raw = field === CODE_FIELD ? code : payload[field]
    if (String(raw ?? '').trim() === '') {
      return { ok: false, message: `请把字段一次填齐：缺少「${field}」` }
    }
  }
  const amount = checkAmount(payload[AMOUNT_FIELD])
  if (!amount.valid) {
    return { ok: false, message: amount.reason }
  }
  const rows = readProjects()
  if (rows.some((row) => canonicalCode(row[CODE_FIELD]) === code)) {
    return { ok: false, message: `工程编号 ${code} 已存在，请勿重复登记（弹窗里不再出现两份）` }
  }
  const nextId = rows.reduce((max, row) => Math.max(max, Number(row.id)), 0) + 1
  const row: EntryRow = {
    id: nextId,
    status: '待批复',
    pending: true,
    abnormal: false,
    [CODE_FIELD]: code,
    所属隐患点: '',
    工程类型: '',
    [APPROVAL_DATE_FIELD]: String(payload[APPROVAL_DATE_FIELD]).trim(),
    [AMOUNT_FIELD]: amount.value as number,
    [CONTRACTOR_FIELD]: String(payload[CONTRACTOR_FIELD]).trim(),
    完工日期: '',
  }
  const next = [...rows, row]
  saveRows(PROJECT_KEY, next)
  return { ok: true, message: `工程 ${code} 已登记，状态「待批复」` }
}

/**
 * 提交批复（弹窗表单）：
 * 1. 编号/批复日期/批复金额/承建单位必须一次落库，不接受只写一半；
 * 2. 批复金额越界（≤0 或 > AMOUNT_MAX_INCLUSIVE 万元）当场挡回，状态不流转；
 * 3. 同一工程连续点两次只记一次（进行中锁 + 待核拨付台账按编号幂等）；
 * 4. 批复结果回写专家会商清单，新增一条「待核拨付」；
 * 5. 侧栏与详情读的都是这里落库的同一个数值。
 */
export function submitApproval(id: number, payload: ApprovalPayload): SubmitApprovalResult {
  if (!lock(String(id), '提交批复')) {
    return { ok: false, message: '批复正在提交，请勿连续点击（只记一次）' }
  }
  try {
    const rows = readProjects()
    const index = rows.findIndex((row) => Number(row.id) === id)
    if (index < 0) {
      return { ok: false, message: `没有找到编号为 ${id} 的治理工程` }
    }
    const current = rows[index]
    if (String(current.status) !== '待批复') {
      return { ok: false, message: `只有「待批复」工程能提交批复，当前为「${current.status}」` }
    }

    const code = canonicalCode(payload[CODE_FIELD] ?? current[CODE_FIELD])
    if (!code) {
      return { ok: false, message: '工程编号不能为空' }
    }
    if (rows.some((row, rowIndex) => rowIndex !== index && canonicalCode(row[CODE_FIELD]) === code)) {
      return { ok: false, message: `工程编号 ${code} 已有另一条记录，请先合并重复条目` }
    }
    // 全字段一次落库：任何一项缺失都挡回，不写半成品。
    const merged: ApprovalPayload = {
      [CODE_FIELD]: code,
      [APPROVAL_DATE_FIELD]: String(payload[APPROVAL_DATE_FIELD] ?? current[APPROVAL_DATE_FIELD] ?? ''),
      [AMOUNT_FIELD]: (payload[AMOUNT_FIELD] ?? current[AMOUNT_FIELD] ?? '') as string | number,
      [CONTRACTOR_FIELD]: String(payload[CONTRACTOR_FIELD] ?? current[CONTRACTOR_FIELD] ?? ''),
    }
    for (const field of APPROVAL_REQUIRED_FIELDS) {
      if (String(merged[field] ?? '').trim() === '') {
        return { ok: false, message: `批复字段需一次填齐：缺少「${field}」` }
      }
    }
    // 越界值挑出来挡回：状态不变、字段不落库。
    const amount = checkAmount(merged[AMOUNT_FIELD])
    if (!amount.valid) {
      return { ok: false, message: amount.reason }
    }

    const approved: EntryRow = {
      ...current,
      [CODE_FIELD]: code,
      [APPROVAL_DATE_FIELD]: String(merged[APPROVAL_DATE_FIELD]).trim(),
      [AMOUNT_FIELD]: amount.value as number,
      [CONTRACTOR_FIELD]: String(merged[CONTRACTOR_FIELD]).trim(),
      status: '已批复',
      pending: true,
      abnormal: false,
    }
    const next = [...rows]
    next[index] = approved
    saveRows(PROJECT_KEY, next)

    const todo = writeBackDisbursement(approved)
    return { ok: true, todo, message: `工程 ${code} 已批复，批复金额 ${amount.value} 万元，结果已回写专家会商清单（待核拨付）` }
  } finally {
    unlock(String(id), '提交批复')
  }
}

/**
 * 批复结果回写专家会商清单：在「待核拨付」台账中按工程编号幂等地记一项。
 * 台账就是专家会商页「待核拨付清单」的数据源，工程页与会商页两条路径读同一份金额。
 */
function writeBackDisbursement(row: EntryRow): DisbursementTodo {
  const code = canonicalCode(row[CODE_FIELD])
  const amount = parseAmount(row[AMOUNT_FIELD]) ?? 0
  const todo: DisbursementTodo = {
    key: code,
    projectId: Number(row.id),
    projectCode: code,
    amount,
    contractor: String(row[CONTRACTOR_FIELD] ?? '').trim(),
    approvalDate: String(row[APPROVAL_DATE_FIELD] ?? '').trim(),
    createdAt: new Date().toISOString(),
  }
  appendDisbursementTodo(todo)
  return todo
}

export function disbursementTodos(): DisbursementTodo[] {
  return listDisbursementTodos()
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const rows = key === PROJECT_KEY ? readProjects() : listRows(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of rows) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `﻿${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
