<template>
  <section class="page project-page" data-module="project">
    <header class="page-head">
      <div>
        <h2>治理工程管理</h2>
        <p class="page-desc">
          围绕工程编号、批复金额、承建单位做批复登记与状态推进。批复金额只认落库的一份，侧栏、详情标签页、弹窗与专家会商清单同口径读取。
        </p>
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

    <!-- 批复金额越界的条目统一挑出来挡回，更正前不能推进状态 -->
    <div v-if="invalidRows.length" class="alert-banner">
      <strong>批复金额越界，以下 {{ invalidRows.length }} 条已挡回：</strong>
      <ul>
        <li v-for="row in invalidRows" :key="String(row.id)">
          {{ row['工程编号'] }}：批复金额为「{{ row['批复金额'] }}」，{{ amountRuleText() }}。
          <button class="link" type="button" @click="pickAndFix(row)">挑出并更正</button>
        </li>
      </ul>
    </div>

    <p v-if="feedback" class="feedback" :class="feedback.ok ? 'feedback-ok' : 'error-text'">
      {{ feedback.text }}
    </p>

    <div class="project-layout">
      <!-- 侧栏：工程编号 + 批复金额，金额直接读落库字段，不做第二次计算 -->
      <aside class="project-side">
        <input
          v-model="keyword"
          class="side-search"
          type="search"
          placeholder="按工程编号 / 隐患点 / 承建单位检索"
        />
        <ul class="project-list">
          <li
            v-for="row in filteredRows"
            :key="String(row.id)"
            class="project-item"
            :class="{ active: selectedId === Number(row.id), invalid: !amountInRange(parseAmount(row['批复金额'])) }"
            @click="selectProject(Number(row.id))"
          >
            <span class="project-code">{{ row['工程编号'] }}</span>
            <span class="project-amount">{{ formatApprovedAmount(row) }}</span>
            <span class="status-tag" :data-status="String(row.status)">{{ row.status }}</span>
          </li>
        </ul>
        <p class="side-foot">侧栏与右侧详情取同一条记录、同一份批复金额。</p>
      </aside>

      <!-- 详情：标签页与页头都渲染 selected 这一行，杜绝两份数据 -->
      <div class="project-detail">
        <template v-if="selected">
          <div class="detail-head">
            <div>
              <h3>{{ selected['工程编号'] }} · {{ selected['工程类型'] }}</h3>
              <p class="page-desc">{{ selected['所属隐患点'] }} · 承建：{{ selected['承建单位'] || '—' }}</p>
            </div>
            <div class="detail-actions">
              <button v-if="canApprove(selected)" class="btn primary" type="button" @click="openApprove(selected)">
                提交批复
              </button>
              <button v-if="canFix(selected)" class="btn" type="button" @click="openFix(selected)">更正批复</button>
              <button v-if="nextAction(selected)" class="btn primary" type="button" @click="advance(selected)">
                {{ nextAction(selected) }}
              </button>
            </div>
          </div>

          <ol class="flow-bar">
            <li
              v-for="(step, index) in flow"
              :key="step"
              class="flow-step"
              :class="{ done: index < currentIndex, current: step === selected.status }"
            >
              {{ step }}
            </li>
          </ol>

          <nav class="detail-tabs">
            <button
              v-for="tab in tabs"
              :key="tab.key"
              type="button"
              class="detail-tab"
              :class="{ active: activeTab === tab.key }"
              @click="activeTab = tab.key"
            >
              {{ tab.label }}
            </button>
          </nav>

          <div class="tab-panel">
            <dl v-if="activeTab === 'base'" class="detail-grid">
              <dt>工程编号</dt><dd>{{ selected['工程编号'] }}</dd>
              <dt>所属隐患点</dt><dd>{{ selected['所属隐患点'] || '—' }}</dd>
              <dt>工程类型</dt><dd>{{ selected['工程类型'] || '—' }}</dd>
              <dt>工程状态</dt><dd>{{ selected.status }}</dd>
            </dl>

            <dl v-else-if="activeTab === 'approval'" class="detail-grid">
              <dt>批复日期</dt><dd>{{ selected['批复日期'] || '—' }}</dd>
              <dt>批复金额</dt><dd class="amount-strong">{{ formatApprovedAmount(selected) }}</dd>
              <dt>承建单位送审金额</dt><dd>{{ formatContractorAmount(selected) }}</dd>
              <dt>金额冲突口径</dt><dd class="rule-note">{{ amountConflictRule() }}</dd>
            </dl>

            <dl v-else-if="activeTab === 'build'" class="detail-grid">
              <dt>承建单位</dt><dd>{{ selected['承建单位'] || '—' }}</dd>
              <dt>计划完工日期</dt><dd>{{ selected['完工日期'] || '—' }}</dd>
              <dt>当前状态</dt><dd>{{ selected.status }}</dd>
            </dl>

            <div v-else class="payback-panel">
              <template v-if="selectedPayback">
                <dl class="detail-grid">
                  <dt>会商编号</dt><dd>{{ selectedPayback['会商编号'] }}</dd>
                  <dt>会商主题</dt><dd>{{ selectedPayback['会商主题'] }}</dd>
                  <dt>清单状态</dt><dd><span class="status-tag" data-status="待核拨付">待核拨付</span></dd>
                  <dt>核拨口径</dt><dd class="rule-note">{{ selectedPayback['会商结论'] }}</dd>
                </dl>
              </template>
              <p v-else class="page-desc">
                提交批复后，批复结果（含批复金额）会自动回写到专家会商清单，生成一条「待核拨付」。
              </p>
            </div>
          </div>
        </template>
        <p v-else class="empty-state">请从左侧选择一条治理工程</p>
      </div>
    </div>

    <footer class="page-foot">
      <span>共 {{ rows.length }} 条治理工程记录；状态只允许 待批复 → 已批复 → 施工中 → 已竣工 顺序推进。</span>
    </footer>

    <!-- 批复弹窗：一份表单一条工程编号，编号唯一，整行字段一次落库 -->
    <div v-if="modalOpen" class="modal-mask" @click.self="closeModal">
      <form class="modal-card" @submit.prevent="submitForm">
        <h3 class="modal-title">{{ modalTitle }}</h3>
        <p class="rule-note">{{ amountConflictRule() }}</p>
        <div class="form-grid">
          <label v-for="field in formFields" :key="field.key" class="form-item">
            <span>{{ field.label }}<em v-if="field.required">*</em></span>
            <input
              v-model="form[field.key]"
              :type="field.type ?? 'text'"
              :step="field.step"
              :disabled="field.key === '工程编号' && modalMode === 'fix'"
              :placeholder="`请输入${field.label}`"
            />
          </label>
        </div>
        <p class="page-desc">{{ amountRuleText() }}，超出范围的批复金额提交时直接挡回。</p>
        <p v-if="modalError" class="error-text">{{ modalError }}</p>
        <div class="modal-actions">
          <button type="button" class="btn ghost" @click="closeModal">取消</button>
          <button type="submit" class="btn primary" :disabled="submitting">
            {{ submitting ? '提交中…' : submitLabel }}
          </button>
        </div>
      </form>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

import { downloadEntries } from '@/api/local-service'
import {
  PROJECT_FLOW,
  advanceStatus,
  amountConflictRule,
  amountInRange,
  amountRuleText,
  emptyForm,
  findPaybackEntry,
  formFromRow,
  formatApprovedAmount,
  invalidAmountRows,
  listPaybackEntries,
  listProjects,
  parseAmount,
  saveApproval,
} from '@/api/project-service'
import type { ApprovalForm } from '@/api/project-service'
import type { EntryRow } from '@/data/types'

const flow = PROJECT_FLOW
const tabs = [
  { key: 'base', label: '基本信息' },
  { key: 'approval', label: '批复信息' },
  { key: 'build', label: '施工信息' },
  { key: 'payback', label: '拨付核账' },
] as const

const formFields: Array<{
  key: keyof ApprovalForm
  label: string
  type?: string
  step?: string
  required?: boolean
}> = [
  { key: '工程编号', label: '工程编号', required: true },
  { key: '所属隐患点', label: '所属隐患点', required: true },
  { key: '工程类型', label: '工程类型', required: true },
  { key: '批复日期', label: '批复日期', type: 'date', required: true },
  { key: '批复金额', label: '批复金额（万元）', type: 'number', step: '0.01', required: true },
  { key: '承建单位送审金额', label: '承建单位送审金额（万元，参考）', type: 'number', step: '0.01' },
  { key: '承建单位', label: '承建单位', required: true },
  { key: '完工日期', label: '计划完工日期', type: 'date' },
]

const NEXT_ACTION: Record<string, string> = { 已批复: '开始施工', 施工中: '确认竣工' }

const rows = ref<EntryRow[]>([])
const paybackRows = ref<EntryRow[]>([])
const selectedId = ref<number | null>(null)
const keyword = ref('')
const activeTab = ref<(typeof tabs)[number]['key']>('base')
const feedback = ref<{ ok: boolean; text: string } | null>(null)

const modalOpen = ref(false)
const modalMode = ref<'create' | 'approve' | 'fix'>('create')
const form = ref<ApprovalForm>(emptyForm(today()))
const modalError = ref('')
const submitting = ref(false)

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function reload() {
  rows.value = listProjects()
  paybackRows.value = listPaybackEntries()
  if (selectedId.value === null || !rows.value.some((row) => Number(row.id) === selectedId.value)) {
    selectedId.value = rows.value.length ? Number(rows.value[0].id) : null
  }
}

// 侧栏、详情页头、四个标签页都从这一个 computed 取行，标签页与详情必然是同一条。
const selected = computed<EntryRow | null>(
  () => rows.value.find((row) => Number(row.id) === selectedId.value) ?? null,
)
const selectedPayback = computed(() => (selected.value ? findPaybackEntry(selected.value) : undefined))

const filteredRows = computed(() => {
  const key = keyword.value.trim()
  if (!key) return rows.value
  return rows.value.filter((row) =>
    ['工程编号', '所属隐患点', '承建单位'].some((field) => String(row[field] ?? '').includes(key)),
  )
})

const invalidRows = computed(() => invalidAmountRows(rows.value))

const stats = computed(() => {
  const count = (status: string) => rows.value.filter((row) => String(row.status) === status).length
  return [
    { label: '待批复工程', value: count('待批复') },
    { label: '已批复工程', value: count('已批复') },
    { label: '施工中工程', value: count('施工中') },
    { label: '已竣工工程', value: count('已竣工') },
    { label: '待核拨付（专家会商清单）', value: paybackRows.value.length },
  ]
})

const currentIndex = computed(() =>
  selected.value ? flow.indexOf(selected.value.status as (typeof flow)[number]) : -1,
)

const modalTitle = computed(() => {
  if (modalMode.value === 'create') return '登记治理工程（提交批复）'
  if (modalMode.value === 'approve') return `提交批复 · ${form.value.工程编号}`
  return `更正批复 · ${form.value.工程编号}`
})
const submitLabel = computed(() => (modalMode.value === 'fix' ? '保存更正' : '提交批复'))

function formatContractorAmount(row: EntryRow): string {
  const value = parseAmount(row['承建单位送审金额'])
  return value === null ? '—' : `${value.toFixed(2)} 万元（仅参考）`
}

function canApprove(row: EntryRow): boolean {
  return String(row.status) === '待批复'
}

function canFix(row: EntryRow): boolean {
  return String(row.status) === '已批复' || String(row.status) === '施工中'
}

function nextAction(row: EntryRow): string {
  return NEXT_ACTION[String(row.status)] ?? ''
}

function selectProject(id: number) {
  selectedId.value = id
  activeTab.value = 'base'
  feedback.value = null
}

function exportRows() {
  downloadEntries('project')
}

function openModal(mode: 'create' | 'approve' | 'fix', row?: EntryRow) {
  modalMode.value = mode
  form.value = row ? formFromRow(row) : emptyForm(today())
  modalError.value = ''
  modalOpen.value = true
}

function openCreate() {
  openModal('create')
}

function openApprove(row: EntryRow) {
  openModal('approve', row)
}

function openFix(row: EntryRow) {
  openModal('fix', row)
}

function pickAndFix(row: EntryRow) {
  selectProject(Number(row.id))
  openFix(row)
}

function closeModal() {
  if (submitting.value) return
  modalOpen.value = false
  modalError.value = ''
}

// 连点两次只记一次：按钮提交中禁用 + 在途标记拦截，服务层还有状态推进锁兜底。
async function submitForm() {
  if (submitting.value) return
  submitting.value = true
  modalError.value = ''
  await Promise.resolve()
  const result = saveApproval(form.value)
  submitting.value = false
  if (!result.ok) {
    modalError.value = result.message
    return
  }
  modalOpen.value = false
  if (typeof result.id === 'number') {
    selectedId.value = result.id
  }
  activeTab.value = 'approval'
  feedback.value = { ok: true, text: result.message }
  reload()
}

function advance(row: EntryRow) {
  const action = nextAction(row)
  if (!action) return
  const result = advanceStatus(Number(row.id), action)
  feedback.value = { ok: result.ok, text: result.message }
  if (result.ok) reload()
}

reload()
</script>
