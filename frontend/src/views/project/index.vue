<template>
  <section class="page" data-module="project">
    <header class="page-head">
      <div>
        <h2>治理工程管理</h2>
        <p class="page-desc">维护治理工程，围绕工程编号、所属隐患点、工程类型、批复日期做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记治理工程</button>
        <button class="btn" type="button" @click="exportRows">导出治理工程清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
      <span class="legend-item legend-todo">待核拨付：{{ todos.length }}</span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <p class="rule-note">
      口径：批复金额统一以「万元」落库，侧栏标签页、详情、批复弹窗与专家会商清单读同一份，不在任何页面重算；
      <strong>金额冲突以正式批复文件为准（批复日期更新、状态更远的一份），承建单位冲突以施工合同口径为准</strong>；
      状态只能按 待批复 → 已批复 → 施工中 → 已竣工 单向推进。
    </p>

    <div class="project-layout">
      <aside class="project-side">
        <h3 class="pane-title">工程清单（标签页）</h3>
        <button
          v-for="row in rows"
          :key="String(row.id)"
          type="button"
          class="side-item"
          :class="{ active: selectedId === Number(row.id), invalid: !!rowAmountIssue(row) }"
          @click="selectedId = Number(row.id)"
        >
          <span class="side-code">{{ row['工程编号'] || '未编号' }}</span>
          <span class="side-amount">{{ formatAmount(row['批复金额']) }}</span>
          <span class="side-status">{{ row.status }}</span>
        </button>
        <p v-if="!rows.length" class="empty-state">暂无治理工程数据，可先登记治理工程</p>
      </aside>

      <article class="project-detail">
        <template v-if="selected">
          <div class="detail-head">
            <div>
              <h3 class="pane-title">{{ selected['工程编号'] }} · 工程详情</h3>
              <p class="detail-sub">编号 id={{ selected.id }}，侧栏标签页与本详情取的是同一条记录。</p>
            </div>
            <span class="status-badge">{{ selected.status }}</span>
          </div>

          <p v-if="amountIssue" class="error-text detail-alert">批复金额越界，已挡回提交：{{ amountIssue }}</p>
          <p v-else-if="todoForSelected" class="todo-note detail-alert">
            批复结果已回写专家会商清单：{{ todoForSelected.projectCode }}｜{{ formatAmount(todoForSelected.amount) }}｜{{ todoForSelected.contractor || '承建单位待补' }}｜待核拨付
          </p>

          <dl class="detail-grid">
            <template v-for="field in detailFields" :key="field">
              <dt>{{ field }}</dt>
              <dd :class="{ 'amount-cell': field === '批复金额' }">
                <template v-if="field === '批复金额'">{{ formatAmount(selected[field]) }}</template>
                <template v-else>{{ selected[field] === '' || selected[field] === undefined ? '—' : selected[field] }}</template>
              </dd>
            </template>
          </dl>

          <div class="detail-actions">
            <button
              v-if="selected.status === '待批复'"
              class="btn primary"
              type="button"
              :disabled="submitting"
              @click="openApproval(selected)"
            >
              {{ submitting ? '提交中…' : '提交批复' }}
            </button>
            <button
              v-if="selected.status === '已批复'"
              class="btn primary"
              type="button"
              :disabled="submitting"
              @click="advance(selected, '开始施工')"
            >
              {{ submitting ? '提交中…' : '开始施工' }}
            </button>
            <button
              v-if="selected.status === '施工中'"
              class="btn primary"
              type="button"
              :disabled="submitting"
              @click="advance(selected, '确认竣工')"
            >
              {{ submitting ? '提交中…' : '确认竣工' }}
            </button>
            <span v-if="selected.status === '已竣工'" class="muted-text">工程已竣工，流程结束</span>
          </div>
        </template>
        <p v-else class="empty-state detail-empty">请在左侧选择一条工程记录查看详情</p>
      </article>
    </div>

    <div v-if="dialogOpen" class="modal-mask" @click.self="closeDialog">
      <div class="modal-card">
        <h3 class="pane-title">{{ dialogMode === 'create' ? '登记治理工程' : `提交批复 · ${form['工程编号']}` }}</h3>
        <p v-if="dialogMode === 'approval'" class="muted-text">
          批复字段请一次填齐后落库；金额越界（须为 0～100000 万元之间）会当场挡回，连续点两次只记一次。
        </p>
        <div class="form-grid">
          <label>
            <span>工程编号</span>
            <input v-model="form['工程编号']" :disabled="dialogMode === 'approval'" placeholder="如 PROJ-0006" />
          </label>
          <label>
            <span>批复日期</span>
            <input v-model="form['批复日期']" type="date" />
          </label>
          <label>
            <span>批复金额（万元）</span>
            <input v-model="form['批复金额']" placeholder="如 256.8" />
          </label>
          <label>
            <span>承建单位</span>
            <input v-model="form['承建单位']" placeholder="以施工合同签订单位为准" />
          </label>
        </div>
        <p v-if="formAmountIssue" class="error-text">{{ formAmountIssue }}</p>
        <div class="modal-actions">
          <button class="btn ghost" type="button" :disabled="submitting" @click="closeDialog">取消</button>
          <button class="btn primary" type="button" :disabled="submitting" @click="confirmDialog">
            {{ submitting ? '提交中…' : '确认提交' }}
          </button>
        </div>
      </div>
    </div>

    <footer class="page-foot">
      <span>共 {{ total }} 条治理工程记录（同一工程编号已合并，不重复显示）</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  createProject,
  disbursementTodos,
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
  submitApproval,
} from '@/api/local-service'
import {
  AMOUNT_FIELD,
  AMOUNT_MAX_INCLUSIVE,
  checkAmount,
  formatAmount,
  rowAmountIssue,
} from '@/data/project-domain'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('project')
// 标签页列表里只放识别列；完整字段在详情里看，两处共用同一条行数据。
const sideFields = ['工程编号', '所属隐患点', '工程类型']
const detailFields = ['工程编号', '所属隐患点', '工程类型', '批复日期', '批复金额', '承建单位', '完工日期']
const actions = ['提交批复', '开始施工', '确认竣工']
const statuses = ['待批复', '已批复', '施工中', '已竣工']
const stats = [{ label: '施工中工程', value: 0 }, { label: '待批复工程', value: 0 }, { label: '已竣工工程', value: 0 }]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = sideFields
const selectedId = ref<number | null>(null)
const submitting = ref(false)

const dialogOpen = ref(false)
const dialogMode = ref<'create' | 'approval'>('approval')
const editingId = ref<number | null>(null)
const form = reactive<{ 工程编号: string; 批复日期: string; 批复金额: string; 承建单位: string }>({
  工程编号: '',
  批复日期: '',
  批复金额: '',
  承建单位: '',
})

const todos = ref(disbursementTodos())

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const selected = computed<EntryRow | null>(
  () => rows.value.find((row) => Number(row.id) === selectedId.value) ?? null,
)
const amountIssue = computed(() => (selected.value ? rowAmountIssue(selected.value) : ''))
const todoForSelected = computed(() =>
  selected.value
    ? todos.value.find((todo) => todo.projectId === Number(selected.value?.id)) ?? null
    : null,
)
const formAmountIssue = computed(() => {
  if (!form[AMOUNT_FIELD].trim()) {
    return ''
  }
  return checkAmount(form[AMOUNT_FIELD]).reason
})

function refreshTodos() {
  todos.value = disbursementTodos()
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  dialogMode.value = 'create'
  editingId.value = null
  form.工程编号 = ''
  form.批复日期 = ''
  form.批复金额 = ''
  form.承建单位 = ''
  dialogOpen.value = true
  errorMessage.value = ''
}

function openApproval(row: EntryRow) {
  const issue = rowAmountIssue(row)
  if (issue) {
    errorMessage.value = `批复金额越界，先修正金额再提交：${issue}（合法区间 0～${AMOUNT_MAX_INCLUSIVE} 万元）`
    return
  }
  dialogMode.value = 'approval'
  editingId.value = Number(row.id)
  form.工程编号 = String(row['工程编号'] ?? '')
  form.批复日期 = String(row['批复日期'] ?? '')
  form.批复金额 = row['批复金额'] === undefined ? '' : String(row['批复金额'])
  form.承建单位 = String(row['承建单位'] ?? '')
  dialogOpen.value = true
  errorMessage.value = ''
}

function closeDialog() {
  if (submitting.value) {
    return
  }
  dialogOpen.value = false
}

function confirmDialog() {
  if (submitting.value) {
    return
  }
  errorMessage.value = ''
  const amount = checkAmount(form[AMOUNT_FIELD])
  if (!amount.valid) {
    errorMessage.value = amount.reason
    return
  }
  submitting.value = true
  try {
    const result =
      dialogMode.value === 'create'
        ? createProject({ ...form })
        : submitApproval(editingId.value as number, { ...form })
    if (!result.ok) {
      errorMessage.value = result.message
      return
    }
    dialogOpen.value = false
    reload()
  } finally {
    submitting.value = false
  }
}

function advance(row: EntryRow, action: string) {
  if (submitting.value) {
    return
  }
  errorMessage.value = ''
  submitting.value = true
  try {
    const result = applyAction(meta.key, Number(row.id), action)
    if (!result.ok) {
      errorMessage.value = result.message
      return
    }
    reload()
  } finally {
    submitting.value = false
  }
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    refreshTodos()
    // 标签页刷新后选中项不跳：还在就守住，不在了就落到第一条。
    if (selectedId.value !== null && !rows.value.some((row) => Number(row.id) === selectedId.value)) {
      selectedId.value = rows.value.length ? Number(rows.value[0].id) : null
    } else if (selectedId.value === null && rows.value.length) {
      selectedId.value = Number(rows.value[0].id)
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '治理工程列表读取失败'
  }
}

void actions

onMounted(reload)
</script>

<style scoped>
.rule-note {
  background: #eef6ff;
  border: 1px solid #bcd9fb;
  border-radius: 6px;
  padding: 8px 12px;
  font-size: 12px;
  color: #334155;
  margin: 0 0 12px;
}
.legend-todo { background: #fff7e6; }
.project-layout { display: flex; gap: 12px; align-items: stretch; }
.project-side { width: 280px; flex-shrink: 0; background: #fff; border: 1px solid var(--border); border-radius: 8px; padding: 10px; }
.project-detail { flex: 1; background: #fff; border: 1px solid var(--border); border-radius: 8px; padding: 14px 16px; min-height: 260px; }
.pane-title { font-size: 14px; margin: 0 0 8px; }
.side-item {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 2px 8px;
  width: 100%;
  text-align: left;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: #fff;
  padding: 8px 10px;
  margin-bottom: 6px;
  cursor: pointer;
}
.side-item:hover { border-color: var(--brand); }
.side-item.active { border-color: var(--brand); box-shadow: 0 0 0 1px var(--brand) inset; background: #f5f9ff; }
.side-item.invalid { border-color: #d92d20; background: #fff5f4; }
.side-code { font-size: 13px; font-weight: 600; }
.side-amount { font-size: 12px; color: var(--brand); text-align: right; }
.side-status { grid-column: 1 / 3; font-size: 12px; color: var(--muted); }
.detail-head { display: flex; justify-content: space-between; align-items: flex-start; }
.detail-sub { font-size: 12px; color: var(--muted); margin: 0 0 8px; }
.status-badge { background: #eef2f7; border-radius: 999px; padding: 2px 12px; font-size: 12px; }
.detail-alert { border-radius: 6px; padding: 6px 10px; font-size: 12px; margin: 8px 0; }
.todo-note { background: #fff7e6; border: 1px solid #ffd591; color: #ad4e00; }
.detail-grid { display: grid; grid-template-columns: 120px 1fr 120px 1fr; gap: 6px 12px; margin: 10px 0; }
.detail-grid dt { color: var(--muted); font-size: 12px; }
.detail-grid dd { margin: 0; font-size: 13px; }
.amount-cell { color: var(--brand); font-weight: 600; }
.detail-actions { margin-top: 12px; display: flex; gap: 10px; align-items: center; }
.detail-empty { padding-top: 60px; }
.muted-text { color: var(--muted); font-size: 12px; }
.modal-mask { position: fixed; inset: 0; background: rgba(16, 24, 40, 0.45); display: flex; align-items: center; justify-content: center; z-index: 50; }
.modal-card { background: #fff; border-radius: 10px; padding: 18px 20px; width: 520px; max-width: calc(100vw - 32px); }
.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 14px; margin: 12px 0; }
.form-grid label span { display: block; font-size: 12px; color: var(--muted); margin-bottom: 2px; }
.form-grid input { width: 100%; padding: 6px 8px; border: 1px solid var(--border); border-radius: 6px; }
.form-grid input:disabled { background: #f1f5f9; }
.modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }
</style>
