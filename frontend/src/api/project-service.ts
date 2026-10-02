import { listRows, saveMany } from '@/data/local-store'
import { moduleMeta } from './local-service'
import type { ActionResult, EntryRow } from '@/data/types'

// 治理工程域：批复登记、状态推进、金额口径、专家会商回写都在这一处收口，
// 侧栏、详情标签页、弹窗、会商清单只能读本文件的函数，不准各自再算一遍。

const PROJECT_KEY = 'project'
const CONSULT_KEY = 'consult'

export const PROJECT_FLOW = ['待批复', '已批复', '施工中', '已竣工'] as const
// 专家会商清单里新增的一档：批复结果回写后等待核拨资金。
export const PAYBACK_STATUS = '待核拨付'
// 批复金额单位为万元，业务上限按单工程 10 亿元（100000 万元）封顶。
export const AMOUNT_MIN_EXCLUSIVE = 0
export const AMOUNT_MAX_INCLUSIVE = 100000

const AMOUNT_FIELD = '批复金额'
const CONTRACTOR_AMOUNT_FIELD = '承建单位送审金额'
const PROJECT_CODE_FIELD = '工程编号'
const ROW_STATUS_FIELD = '工程状态'

export type ApprovalForm = {
  id: number | null
  工程编号: string
  所属隐患点: string
  工程类型: string
  批复日期: string
  批复金额: string
  // 承建单位报来的送审金额：仅登记参考，与批复金额冲突时以批复金额为准。
  承建单位送审金额: string
  承建单位: string
  完工日期: string
}

export type SaveOutcome = {
  ok: boolean
  message: string
  id?: number
}

const inFlight = new Set<number>()

export function projectMeta() {
  return moduleMeta(PROJECT_KEY)
}

export function listProjects(): EntryRow[] {
  return listRows(PROJECT_KEY)
}

export function findProject(id: number): EntryRow | undefined {
  return listProjects().find((row) => Number(row.id) === id)
}

// 侧栏与详情标签页走同一个金额入口：只认落库的「批复金额」，不重算、不换算。
export function formatApprovedAmount(row: EntryRow | undefined | null): string {
  if (!row) return '—'
  const value = parseAmount(row[AMOUNT_FIELD])
  return value === null ? '—' : `${value.toFixed(2)} 万元`
}

export function parseAmount(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  if (typeof raw === 'string' && raw.trim() !== '') {
    const value = Number(raw)
    return Number.isFinite(value) ? value : null
  }
  return null
}

export function amountInRange(amount: number | null): boolean {
  return amount !== null && amount > AMOUNT_MIN_EXCLUSIVE && amount <= AMOUNT_MAX_INCLUSIVE
}

export function amountRuleText(): string {
  return `批复金额须大于 ${AMOUNT_MIN_EXCLUSIVE}、不超过 ${AMOUNT_MAX_INCLUSIVE} 万元`
}

// 金额冲突的口径：批复金额是批复机关核定的唯一口径；承建单位送审金额只作参考，
// 任何页面都不得用送审金额回算、覆盖批复金额。
export function amountConflictRule(): string {
  return '以批复机关核定的「批复金额」为准；承建单位送审金额仅登记参考，不得回算或覆盖批复金额。'
}

export function invalidAmountRows(rows: EntryRow[] = listProjects()): EntryRow[] {
  return rows.filter((row) => !amountInRange(parseAmount(row[AMOUNT_FIELD])))
}

// 同一工程编号只允许一份：保存时按编号查重复行。
export function findDuplicateCode(code: string, exceptId: number | null): EntryRow | undefined {
  const target = code.trim()
  return listProjects().find(
    (row) => String(row[PROJECT_CODE_FIELD] ?? '').trim() === target && Number(row.id) !== exceptId,
  )
}

function nextId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

// 会商清单里的待核拨付项与工程编号一一对应，靠这个前缀反查。
function paybackCode(row: EntryRow): string {
  return `核拨-${String(row[PROJECT_CODE_FIELD] ?? '')}`
}

export function findPaybackEntry(row: EntryRow): EntryRow | undefined {
  const code = paybackCode(row)
  return listRows(CONSULT_KEY).find((item) => String(item['会商编号'] ?? '') === code)
}

// 专家会商清单里全部待核拨付项，用于工程页顶部统计。
export function listPaybackEntries(): EntryRow[] {
  return listRows(CONSULT_KEY).filter((item) => String(item.status) === PAYBACK_STATUS)
}

function buildPaybackEntry(id: number, row: EntryRow): EntryRow {
  const code = paybackCode(row)
  const date = String(row['批复日期'] ?? '')
  const theme = `${row[PROJECT_CODE_FIELD] ?? ''} 治理工程批复资金核拨`
  return {
    id,
    status: PAYBACK_STATUS,
    pending: true,
    abnormal: false,
    会商编号: code,
    会商主题: theme,
    参会专家: '资金核拨专班',
    会商日期: date,
    会商结论: `批复金额 ${formatApprovedAmount(row)}，待核拨。${amountConflictRule()}`,
    建议措施: '按批复金额核拨治理资金',
    纪要归档日: '',
    会商状态: PAYBACK_STATUS,
    关联工程编号: String(row[PROJECT_CODE_FIELD] ?? ''),
  }
}

function syncPayback(existing: EntryRow | undefined, id: number, row: EntryRow): EntryRow {
  if (existing) {
    return { ...buildPaybackEntry(Number(existing.id), row), id: Number(existing.id) }
  }
  return buildPaybackEntry(id, row)
}

// 提交批复（新建批复 / 对「待批复」工程提交批复 / 更正已批复工程）：
// 整行字段一次落库，批复金额校验越界与编号重复，成功后回写专家会商「待核拨付」。
export function saveApproval(form: ApprovalForm): SaveOutcome {
  const code = form.工程编号.trim()
  const required: Array<[string, string]> = [
    ['工程编号', code],
    ['所属隐患点', form.所属隐患点.trim()],
    ['工程类型', form.工程类型.trim()],
    ['批复日期', form.批复日期.trim()],
    ['承建单位', form.承建单位.trim()],
  ]
  const missing = required.filter(([, value]) => value === '').map(([label]) => label)
  if (missing.length > 0) {
    return { ok: false, message: `请补全必填字段：${missing.join('、')}` }
  }

  const amount = parseAmount(form.批复金额)
  if (amount === null || !amountInRange(amount)) {
    return {
      ok: false,
      message: `工程编号 ${code} 的批复金额「${form.批复金额}」越界，已挡回。${amountRuleText()}。`,
    }
  }
  const contractorAmount = parseAmount(form.承建单位送审金额)
  const duplicate = findDuplicateCode(code, form.id)
  if (duplicate) {
    return {
      ok: false,
      message: `工程编号 ${code} 已存在（记录 #${duplicate.id}），同一工程编号不得重复登记。`,
    }
  }

  const projectRows = [...listProjects()]
  const index = projectRows.findIndex((row) => Number(row.id) === form.id)
  const current = index >= 0 ? projectRows[index] : undefined
  if (current && String(current.status) === '已竣工') {
    return { ok: false, message: `工程编号 ${code} 已竣工，批复内容不再变更。` }
  }

  const isSubmit = !current || String(current.status) === '待批复'
  const status = isSubmit ? '已批复' : String(current!.status)
  const id = current ? Number(current.id) : nextId(projectRows)
  const updated: EntryRow = {
    ...(current ?? { pending: true, abnormal: false }),
    id,
    status,
    // 最后一档为已竣工，其余状态都算待办
    pending: status !== PROJECT_FLOW[PROJECT_FLOW.length - 1],
    abnormal: false,
    工程编号: code,
    所属隐患点: form.所属隐患点.trim(),
    工程类型: form.工程类型.trim(),
    批复日期: form.批复日期.trim(),
    批复金额: amount,
    承建单位送审金额: contractorAmount ?? '',
    承建单位: form.承建单位.trim(),
    完工日期: form.完工日期.trim(),
    工程状态: status,
  }

  const nextProjects = index >= 0 ? projectRows.map((row, i) => (i === index ? updated : row)) : [...projectRows, updated]

  // 批复结果回写到专家会商清单：同一工程编号只维护一条待核拨付记录。
  const consultRows = [...listRows(CONSULT_KEY)]
  const payback = findPaybackEntry(updated)
  const payIndex = consultRows.findIndex((row) => String(row['会商编号'] ?? '') === paybackCode(updated))
  const nextPayback = syncPayback(payback, nextId(consultRows), updated)
  const nextConsult =
    payIndex >= 0
      ? consultRows.map((row, i) => (i === payIndex ? nextPayback : row))
      : [...consultRows, nextPayback]

  // 工程行与会商行同一次写入，避免只落一半。
  saveMany({ [PROJECT_KEY]: nextProjects, [CONSULT_KEY]: nextConsult })
  return {
    ok: true,
    id,
    message: isSubmit
      ? `工程编号 ${code} 已提交批复，批复金额 ${formatApprovedAmount(updated)}，会商清单已新增「${PAYBACK_STATUS}」。`
      : `工程编号 ${code} 的批复信息已整体更正并落库，待核拨付清单同步更新。`,
  }
}

// 状态推进：只能顺着 待批复→已批复→施工中→已竣工 往前迈一格，不允许跳级或回退。
// 动作绑定唯一来源状态：同一动作连点两次，第二次直接挡回，只记一次账。
const ACTION_FLOW: Record<string, { source: string; target: string }> = {
  开始施工: { source: '已批复', target: '施工中' },
  确认竣工: { source: '施工中', target: '已竣工' },
}

export function advanceStatus(id: number, action: string): ActionResult {
  const move = ACTION_FLOW[action]
  if (!move) {
    return { ok: false, message: `治理工程没有登记「${action}」这个状态动作` }
  }
  if (inFlight.has(id)) {
    return { ok: false, message: '该工程正在提交中，请勿连续点击，重复提交不会重复记账。' }
  }
  const rows = [...listProjects()]
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的治理工程` }
  }
  const current = rows[index]
  const currentStatus = String(current.status)
  if (currentStatus === move.target) {
    return { ok: false, message: `工程已经是「${move.target}」，${action}只记一次，不用重复操作。` }
  }
  if (currentStatus !== move.source) {
    return {
      ok: false,
      message: `状态只能按 待批复 → 已批复 → 施工中 → 已竣工 顺序推进，当前为「${currentStatus}」，不能执行「${action}」。`,
    }
  }
  if (!amountInRange(parseAmount(current[AMOUNT_FIELD]))) {
    return {
      ok: false,
      message: `工程编号 ${current[PROJECT_CODE_FIELD] ?? id} 的批复金额越界，先更正金额再推进状态。`,
    }
  }

  inFlight.add(id)
  try {
    const updated: EntryRow = {
      ...current,
      status: move.target,
      pending: move.target !== PROJECT_FLOW[PROJECT_FLOW.length - 1],
      [ROW_STATUS_FIELD]: move.target,
    }
    rows[index] = updated
    saveMany({ [PROJECT_KEY]: rows })
    return { ok: true, message: `工程 ${current[PROJECT_CODE_FIELD] ?? id} 状态已推进为「${move.target}」。` }
  } finally {
    inFlight.delete(id)
  }
}

export function emptyForm(today: string): ApprovalForm {
  return {
    id: null,
    工程编号: '',
    所属隐患点: '',
    工程类型: '',
    批复日期: today,
    批复金额: '',
    承建单位送审金额: '',
    承建单位: '',
    完工日期: '',
  }
}

export function formFromRow(row: EntryRow): ApprovalForm {
  const amount = parseAmount(row[AMOUNT_FIELD])
  const contractorAmount = parseAmount(row[CONTRACTOR_AMOUNT_FIELD])
  return {
    id: Number(row.id),
    工程编号: String(row[PROJECT_CODE_FIELD] ?? ''),
    所属隐患点: String(row['所属隐患点'] ?? ''),
    工程类型: String(row['工程类型'] ?? ''),
    批复日期: String(row['批复日期'] ?? ''),
    批复金额: amount === null ? '' : String(amount),
    承建单位送审金额: contractorAmount === null ? '' : String(contractorAmount),
    承建单位: String(row['承建单位'] ?? ''),
    完工日期: String(row['完工日期'] ?? ''),
  }
}
