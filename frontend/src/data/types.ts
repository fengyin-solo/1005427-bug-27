/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
  /** 严格状态机：动作只能把状态从当前态推进到 statuses 里相邻的下一个态，禁止回退、禁止跳级。 */
  strict?: boolean
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

/** 批复提交后写回专家会商清单的「待核拨付」记录，批复结果以快照存一份，两个入口读同一份。 */
export type DisbursementTodo = {
  key: string
  projectId: number
  projectCode: string
  /** 批复金额快照（万元），落库即定数，任何页面都不再重算。 */
  amount: number
  contractor: string
  approvalDate: string
  createdAt: string
}
