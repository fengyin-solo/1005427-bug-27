<template>
  <section class="page" data-module="consult">
    <header class="page-head">
      <div>
        <h2>专家会商管理</h2>
        <p class="page-desc">维护专家会商，围绕会商编号、会商主题、参会专家、会商日期做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记专家会商</button>
        <button class="btn" type="button" @click="exportRows">导出专家会商清单</button>
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

    <section v-if="todos.length" class="todo-panel">
      <h3 class="todo-title">待核拨付清单（治理工程批复回写，与工程详情读同一份批复金额）</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>工程编号</th>
            <th>批复金额</th>
            <th>承建单位</th>
            <th>批复日期</th>
            <th>拨付状态</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="todo in todos" :key="todo.key">
            <td>{{ todo.projectCode }}</td>
            <td class="amount-cell">{{ formatAmount(todo.amount) }}</td>
            <td>{{ todo.contractor || '—' }}</td>
            <td>{{ todo.approvalDate || '—' }}</td>
            <td><span class="legend-item legend-todo">待核拨付</span></td>
          </tr>
        </tbody>
      </table>
    </section>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无专家会商数据，可先登记专家会商</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条专家会商记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  disbursementTodos,
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import { formatAmount } from '@/data/project-domain'
import type { DisbursementTodo, EntryRow } from '@/data/types'

const meta = moduleMeta('consult')
const columns = ["会商编号", "会商主题", "参会专家", "会商日期", "会商结论", "建议措施", "纪要归档日", "会商状态"]
const actions = ["确认组织", "提交结论", "取消会商"]
const statuses = ["待组织", "已组织", "已出结论", "已取消"]
const stats = [{"label": "待组织会商", "value": 0}, {"label": "已出结论会商", "value": 0}, {"label": "本月会商次数", "value": 0}]

const rows = ref<EntryRow[]>([])
const todos = ref<DisbursementTodo[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '专家会商登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    todos.value = disbursementTodos()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '专家会商列表读取失败'
  }
}

onMounted(reload)
</script>

<style scoped>
.legend-todo { background: #fff7e6; color: #ad4e00; }
.todo-panel { background: #fff; border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; margin-bottom: 12px; }
.todo-title { font-size: 13px; margin: 0 0 8px; }
.amount-cell { color: var(--brand); font-weight: 600; }
</style>
