import type { EntryRow } from './types'

/**
 * 治理工程领域口径（全应用唯一一份，侧栏、详情、弹窗、专家会商回写都从这里取数，
 * 不允许在页面上各自解析/重算批复金额）。
 */

export const PROJECT_KEY = 'project'
export const CONSULT_KEY = 'consult'

export const PROJECT_STATUSES = ['待批复', '已批复', '施工中', '已竣工'] as const
export const PROJECT_ACTIONS = ['提交批复', '开始施工', '确认竣工'] as const

/** 金额统一以「万元」落库与展示。 */
export const AMOUNT_UNIT = '万元'
/** 批复金额合法区间：(0, 100000] 万元（单处治理工程批复上限 10 亿元）。 */
export const AMOUNT_MIN_EXCLUSIVE = 0
export const AMOUNT_MAX_INCLUSIVE = 100000

export const CODE_FIELD = '工程编号'
export const AMOUNT_FIELD = '批复金额'
export const CONTRACTOR_FIELD = '承建单位'
export const APPROVAL_DATE_FIELD = '批复日期'

/** 待批复提交时必须一次落库的字段：落库只写一半的旧账在这里补齐。 */
export const APPROVAL_REQUIRED_FIELDS = [
  CODE_FIELD,
  APPROVAL_DATE_FIELD,
  AMOUNT_FIELD,
  CONTRACTOR_FIELD,
] as const

export type AmountCheck = {
  /** 能解析成数字（无论是否越界）。 */
  parseable: boolean
  value: number | null
  /** 落在 (0, 上限] 内才算合法，越界一律挡回。 */
  valid: boolean
  reason: string
}

export function canonicalCode(raw: unknown): string {
  return String(raw ?? '').trim().toUpperCase()
}

/** 金额解析：数字或带「万元/元」的文本都归一成 number（万元）；无法解析返回 null。 */
export function parseAmount(raw: unknown): number | null {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? raw : null
  }
  const text = String(raw ?? '').trim()
  if (!text) {
    return null
  }
  const matched = text.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/)
  if (!matched) {
    return null
  }
  let value = Number(matched[0])
  if (!Number.isFinite(value)) {
    return null
  }
  // 明确写成「元」的换算成万元，其余一律按万元处理。
  if (/元\s*$/.test(text) && !/万\s*元/.test(text)) {
    value = value / 10000
  }
  return value
}

export function checkAmount(raw: unknown): AmountCheck {
  const value = parseAmount(raw)
  if (value === null) {
    return {
      parseable: false,
      value: null,
      valid: false,
      reason: '批复金额必须是大于 0 的数字（单位：万元）',
    }
  }
  if (value <= AMOUNT_MIN_EXCLUSIVE) {
    return {
      parseable: true,
      value,
      valid: false,
      reason: `批复金额 ${value} 万元越界：必须大于 ${AMOUNT_MIN_EXCLUSIVE}`,
    }
  }
  if (value > AMOUNT_MAX_INCLUSIVE) {
    return {
      parseable: true,
      value,
      valid: false,
      reason: `批复金额 ${value} 万元越界：单工程批复上限 ${AMOUNT_MAX_INCLUSIVE} 万元`,
    }
  }
  return { parseable: true, value, valid: true, reason: '' }
}

/** 唯一的金额展示口径：保留最多两位小数，带单位。任何页面都不要自己拼。 */
export function formatAmount(raw: unknown): string {
  const value = parseAmount(raw)
  if (value === null) {
    return '—'
  }
  return `${Number(value.toFixed(2))} ${AMOUNT_UNIT}`
}

/** 两个值是否都视为「已填写」。 */
function hasValue(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false
  }
  return String(value).trim() !== ''
}

/** 单条工程记录的金额校验结果（详情、侧栏、提交共用）。 */
export function rowAmountIssue(row: EntryRow): string {
  return checkAmount(row[AMOUNT_FIELD]).reason
}

function preferByApprovalDate(a: EntryRow, b: EntryRow): EntryRow {
  // 冲突时以批复文件为准：批复日期有登记、且日期更新的一份代表正式批复文件。
  const da = String(a[APPROVAL_DATE_FIELD] ?? '').trim()
  const db = String(b[APPROVAL_DATE_FIELD] ?? '').trim()
  if (da && !db) {
    return a
  }
  if (db && !da) {
    return b
  }
  if (da && db && da !== db) {
    return da > db ? a : b
  }
  // 批复文件分不出先后时，状态走得更远的一份以正式批复为准。
  const sa = PROJECT_STATUSES.indexOf(a.status as (typeof PROJECT_STATUSES)[number])
  const sb = PROJECT_STATUSES.indexOf(b.status as (typeof PROJECT_STATUSES)[number])
  if (sa !== sb) {
    return sa > sb ? a : b
  }
  // 再分不出，后录入的（id 更大）覆盖旧值。
  return Number(a.id) >= Number(b.id) ? a : b
}

export type CanonicalProject = {
  rows: EntryRow[]
  /** 同一工程编号重复的份被合并过。 */
  deduped: number
}

/**
 * 工程记录归一化（读存储时只做这一次，结果回写存储）：
 * 1. 同一工程编号的多份记录合并为一条，缺失字段互相补齐；
 * 2. 批复金额、承建单位冲突按「以批复文件 / 施工合同为准」的规则裁定；
 * 3. 批复金额归一成数字（万元），落库即唯一一份，之后任何地方都不重算。
 */
export function canonicalizeProjects(source: EntryRow[]): CanonicalProject {
  const groups = new Map<string, EntryRow[]>()
  const noCode: EntryRow[] = []
  for (const row of source) {
    const code = canonicalCode(row[CODE_FIELD])
    if (!code) {
      noCode.push({ ...row })
      continue
    }
    const list = groups.get(code) ?? []
    list.push({ ...row, [CODE_FIELD]: code })
    groups.set(code, list)
  }

  const merged: EntryRow[] = []
  let deduped = 0
  for (const list of groups.values()) {
    if (list.length === 1) {
      merged.push({ ...list[0] })
      continue
    }
    deduped += list.length - 1
    const base: EntryRow = { ...list[0] }
    // 基条：状态走得最远、其次 id 最大（最新录入）。
    for (const row of list.slice(1)) {
      const sb = PROJECT_STATUSES.indexOf(base.status as (typeof PROJECT_STATUSES)[number])
      const sr = PROJECT_STATUSES.indexOf(row.status as (typeof PROJECT_STATUSES)[number])
      if (sr > sb || (sr === sb && Number(row.id) > Number(base.id))) {
        Object.assign(base, row)
      }
    }
    // 字段级合并：所有业务字段，缺失就用别份补。
    const fieldNames = new Set<string>()
    for (const row of list) {
      for (const key of Object.keys(row)) {
        if (!['id', 'status', 'pending', 'abnormal'].includes(key)) {
          fieldNames.add(key)
        }
      }
    }
    for (const field of fieldNames) {
      if (!hasValue(base[field])) {
        const donor = list.find((row) => hasValue(row[field]))
        if (donor) {
          base[field] = donor[field] as string | number | boolean
        }
      }
    }
    // 金额冲突：以批复文件（批复日期已登记/更新、状态更远）的一份为准。
    const amountRows = list.filter((row) => parseAmount(row[AMOUNT_FIELD]) !== null)
    if (amountRows.length > 1) {
      const winner = amountRows.reduce((acc, row) => preferByApprovalDate(acc, row))
      const value = parseAmount(winner[AMOUNT_FIELD])
      if (value !== null) {
        base[AMOUNT_FIELD] = value
      }
    } else {
      const value = parseAmount(base[AMOUNT_FIELD])
      if (value !== null) {
        base[AMOUNT_FIELD] = value
      }
    }
    // 承建单位冲突：以施工合同（中标后签订，状态走得更远的一份代表合同口径）为准。
    const contractorRows = list.filter((row) => hasValue(row[CONTRACTOR_FIELD]))
    if (contractorRows.length > 1) {
      const winner = contractorRows.reduce((acc, row) => preferByApprovalDate(acc, row))
      base[CONTRACTOR_FIELD] = winner[CONTRACTOR_FIELD]
    }
    // 异常态：参与合并的任何一份被标过异常，合并后仍保留。
    base.abnormal = list.some((row) => row.abnormal)
    merged.push(base)
  }

  const rows = [...merged, ...noCode]
  rows.sort((a, b) => Number(a.id) - Number(b.id))
  return { rows, deduped }
}

/** 下一个可推进的状态；不是严格的相邻态就返回 null（回退、跳级都挡掉）。 */
export function nextProjectStatus(status: string): string | null {
  const index = PROJECT_STATUSES.indexOf(status as (typeof PROJECT_STATUSES)[number])
  if (index < 0 || index >= PROJECT_STATUSES.length - 1) {
    return null
  }
  return PROJECT_STATUSES[index + 1]
}

/** 当前态允许执行的动作：严格顺着「待批复 → 已批复 → 施工中 → 已竣工」推进。 */
export function projectActionForStatus(status: string): string | null {
  switch (status) {
    case '待批复':
      return '提交批复'
    case '已批复':
      return '开始施工'
    case '施工中':
      return '确认竣工'
    default:
      return null
  }
}
