<template>
  <n-drawer :show="modelValue" width="640" placement="right" @update:show="emit('update:modelValue', $event)">
    <n-drawer-content title="调试面板" closable>
      <n-space vertical :size="16" class="debug-drawer">
        <n-alert type="warning" :show-icon="false">
          展示当前账号的同步状态、Agent 绑定、最近运行日志和请求链路，便于排查消息、配置与 Agent 问题。
        </n-alert>

        <n-spin :show="loading">
          <n-tabs type="segment" animated default-value="logs">
            <n-tab-pane name="overview" tab="概览">
              <div class="overview-grid">
                <div class="overview-card">
                  <span class="overview-card__label">当前账号</span>
                  <strong>{{ snapshot?.account?.displayName || '未选择' }}</strong>
                  <small>{{ snapshot?.account?.accountId || '-' }}</small>
                </div>
                <div class="overview-card">
                  <span class="overview-card__label">消息总数</span>
                  <strong>{{ snapshot?.stats.messageCount ?? 0 }}</strong>
                  <small>会话 {{ snapshot?.stats.conversationCount ?? 0 }} 个</small>
                </div>
                <div class="overview-card">
                  <span class="overview-card__label">同步状态</span>
                  <strong>{{ snapshot?.syncState?.lastError || '正常' }}</strong>
                  <small>{{ syncStateMeta }}</small>
                </div>
              </div>

              <div class="json-panel">
                <pre class="debug-content">{{ overviewJson }}</pre>
              </div>
            </n-tab-pane>

            <n-tab-pane name="logs" tab="运行日志">
              <div class="logs-header">
                <n-tag size="small" round type="info">{{ filteredAllLogs.length }} / {{ allLogs.length }} 条</n-tag>
                <span class="logs-header__hint">{{ logsHint }}</span>
              </div>

              <div class="logs-toolbar">
                <n-select v-model:value="logSource" size="small" :options="sourceOptions" />
                <n-select v-model:value="logLevel" size="small" :options="levelOptions" />
                <n-input v-model:value="keyword" size="small" clearable placeholder="筛选事件、摘要或 payload" />
                <n-space :size="8" wrap>
                  <n-button size="small" tertiary @click="emit('refresh')">刷新</n-button>
                  <n-button size="small" tertiary :disabled="!allLogs.length" @click="emit('clear-logs', currentClearSource)">
                    清空当前
                  </n-button>
                  <n-button size="small" tertiary :disabled="!allLogs.length" @click="emit('clear-logs', 'all')">
                    清空全部
                  </n-button>
                </n-space>
              </div>

              <n-alert v-if="!allLogs.length" type="info" :show-icon="false" class="logs-empty-alert">
                当前没有拿到运行日志。通常是后端服务还在跑旧进程，重启后会显示 chat-service、agent-router、weixin-api、weixin-media 的完整日志。
              </n-alert>

              <n-empty v-if="!allLogs.length" description="最近还没有日志" />

              <n-empty v-else-if="!filteredAllLogs.length" description="当前筛选条件下没有匹配日志" />

              <div v-else>
                <div class="log-list">
                  <article
                    v-for="(entry, index) in filteredLogs"
                    :key="`${entry.timestamp}-${entry.source}-${index}`"
                    class="log-card"
                    :class="{ 'log-card--error': entry.level === 'error' }"
                  >
                    <div class="log-card__top">
                      <div class="log-card__main">
                        <div class="log-card__headline">{{ entry.summary }}</div>
                        <div class="log-card__subline">
                          <span>{{ formatTime(entry.timestamp) }}</span>
                          <span>{{ entry.event }}</span>
                        </div>
                      </div>
                      <n-space :size="8" align="center" wrap>
                        <n-tag size="small" :type="entry.level === 'error' ? 'error' : 'success'">
                          {{ entry.level === 'error' ? '异常' : '正常' }}
                        </n-tag>
                        <n-tag size="small" round>{{ entry.source }}</n-tag>
                      </n-space>
                    </div>

                    <p class="log-card__preview">{{ summarizePayload(entry.payload) }}</p>

                    <div class="log-card__actions">
                      <n-button tertiary size="tiny" @click="toggleExpanded(`${entry.timestamp}-${entry.source}-${index}`)">
                        {{ expandedKeys.has(`${entry.timestamp}-${entry.source}-${index}`) ? '收起详情' : '查看详情' }}
                      </n-button>
                    </div>

                    <pre
                      v-if="expandedKeys.has(`${entry.timestamp}-${entry.source}-${index}`)"
                      class="debug-content debug-content--compact"
                    >{{ stringify(entry.payload) }}</pre>
                  </article>
                </div>

                <div class="log-pagination">
                  <n-button size="small" tertiary :disabled="currentPage <= 1" @click="currentPage = 1">首页</n-button>
                  <n-button size="small" tertiary :disabled="currentPage <= 1" @click="currentPage--">上一页</n-button>
                  <span class="log-pagination__info">{{ currentPage }} / {{ totalPages }}</span>
                  <n-button size="small" tertiary :disabled="currentPage >= totalPages" @click="currentPage++">下一页</n-button>
                  <n-button size="small" tertiary :disabled="currentPage >= totalPages" @click="currentPage = totalPages">末页</n-button>
                </div>
              </div>
            </n-tab-pane>

            <n-tab-pane name="raw" tab="原始 JSON">
              <div class="json-panel">
                <pre class="debug-content">{{ formatted }}</pre>
              </div>
            </n-tab-pane>
          </n-tabs>
        </n-spin>
      </n-space>
    </n-drawer-content>
  </n-drawer>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  NAlert,
  NButton,
  NDrawer,
  NDrawerContent,
  NEmpty,
  NInput,
  NSelect,
  NSpace,
  NSpin,
  NTabPane,
  NTabs,
  NTag,
} from 'naive-ui';

import type { DebugLogSource, DebugSnapshot } from '@/types';

const props = defineProps<{
  modelValue: boolean;
  loading: boolean;
  snapshot: DebugSnapshot | null;
}>();

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void;
  (event: 'refresh'): void;
  (event: 'clear-logs', source: DebugLogSource): void;
}>();

const logSource = ref<DebugLogSource>('all');
const logLevel = ref<'all' | 'info' | 'error'>('all');
const keyword = ref('');
const expandedKeys = ref<Set<string>>(new Set());
const currentPage = ref(1);
const pageSize = ref(20);

const formatted = computed(() => JSON.stringify(props.snapshot ?? {}, null, 2));

const overviewJson = computed(() => JSON.stringify({
  account: props.snapshot?.account,
  syncState: props.snapshot?.syncState,
  stats: props.snapshot?.stats,
  agentBindings: props.snapshot?.agentBindings,
  agentSessions: props.snapshot?.agentSessions,
}, null, 2));

const sourceOptions = [
  { label: '全部来源', value: 'all' },
  { label: 'chat-service', value: 'chat-service' },
  { label: 'agent-router', value: 'agent-router' },
  { label: 'weixin-api', value: 'weixin-api' },
  { label: 'weixin-media', value: 'weixin-media' },
] satisfies Array<{ label: string; value: DebugLogSource }>;

const levelOptions = [
  { label: '全部级别', value: 'all' },
  { label: '正常', value: 'info' },
  { label: '异常', value: 'error' },
] satisfies Array<{ label: string; value: 'all' | 'info' | 'error' }>;

const allLogs = computed(() => props.snapshot?.recentLogs ?? []);
const filteredAllLogs = computed(() => {
  const source = logSource.value;
  const level = logLevel.value;
  const query = keyword.value.trim().toLowerCase();
  return allLogs.value.filter((entry) => {
    if (source !== 'all' && entry.source !== source) {
      return false;
    }
    if (level !== 'all' && entry.level !== level) {
      return false;
    }
    if (!query) {
      return true;
    }
    const haystack = [
      entry.source,
      entry.event,
      entry.summary,
      JSON.stringify(entry.payload),
    ].join(' ').toLowerCase();
    return haystack.includes(query);
  });
});

const totalPages = computed(() => Math.max(1, Math.ceil(filteredAllLogs.value.length / pageSize.value)));

const filteredLogs = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value;
  const end = start + pageSize.value;
  return filteredAllLogs.value.slice(start, end);
});

// 筛选条件变化时重置页码
watch([logSource, logLevel, keyword], () => {
  currentPage.value = 1;
});

const currentClearSource = computed<DebugLogSource>(() => logSource.value === 'all' ? 'all' : logSource.value);
const logsHint = computed(() => allLogs.value.length
  ? '支持按来源、级别和关键词筛选，清空后可立即刷新查看最新链路'
  : '日志为空时请先重启本地服务，让新的调试接口生效');

const syncStateMeta = computed(() => {
  const state = props.snapshot?.syncState;
  if (!state) return '尚未建立同步状态';
  return `最近事件 ${formatTime(state.lastEventAt)} · buf ${state.getUpdatesBuf || '-'}`;
});

function stringify(value: unknown): string {
  return JSON.stringify(value ?? {}, null, 2);
}

function summarizePayload(value: unknown): string {
  if (!value || (typeof value === 'object' && !Object.keys(value as Record<string, unknown>).length)) {
    return '无额外 payload，当前事件已在标题中概括。';
  }
  const text = JSON.stringify(value)
    .replace(/[{}"]/g, ' ')
    .replace(/,/g, ' · ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > 220 ? `${text.slice(0, 220)}…` : text;
}

function toggleExpanded(key: string): void {
  const next = new Set(expandedKeys.value);
  if (next.has(key)) {
    next.delete(key);
  } else {
    next.add(key);
  }
  expandedKeys.value = next;
}

function formatTime(value: string | number): string {
  if (!value) return '-';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}
</script>

<style scoped>
.debug-drawer {
  min-height: 0;
}

.overview-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 14px;
}

.overview-card {
  display: grid;
  gap: 6px;
  padding: 14px 16px;
  border-radius: 16px;
  border: 1px solid var(--card-border);
  background: var(--card-background);
}

.overview-card__label,
.logs-header__hint,
.log-entry__meta {
  color: var(--text-secondary);
}

.overview-card strong {
  color: var(--text-primary);
}

.overview-card small {
  overflow-wrap: anywhere;
}

.logs-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.logs-empty-alert {
  margin-bottom: 12px;
}

.logs-toolbar {
  display: grid;
  grid-template-columns: 140px 120px minmax(0, 1fr) auto;
  gap: 10px;
  align-items: center;
  margin-bottom: 12px;
}

.log-list {
  display: grid;
  gap: 12px;
  max-height: min(72vh, 920px);
  overflow: auto;
  padding-right: 4px;
}

.log-card {
  display: grid;
  gap: 10px;
  padding: 14px 16px;
  border-radius: 16px;
  border: 1px solid var(--card-border);
  background: var(--card-background);
}

.log-card--error {
  border-color: color-mix(in srgb, var(--error-color) 24%, var(--card-border));
  background: color-mix(in srgb, var(--card-background) 88%, var(--error-color) 12%);
}

.log-card__top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
}

.log-card__main {
  display: grid;
  gap: 6px;
  min-width: 0;
  flex: 1;
}

.log-card__headline {
  font-weight: 600;
  color: var(--text-primary);
  line-height: 1.5;
}

.log-card__subline {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  font-size: 12px;
  color: var(--text-secondary);
}

.log-card__preview {
  margin: 0;
  color: var(--text-secondary);
  line-height: 1.65;
  word-break: break-word;
}

.log-card__actions {
  display: flex;
  justify-content: flex-end;
}

.log-pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-top: 16px;
  padding: 12px 0;
}

.log-pagination__info {
  min-width: 80px;
  text-align: center;
  font-size: 13px;
  color: var(--text-secondary);
}

.json-panel {
  min-height: 0;
}

.debug-content {
  margin: 0;
  padding: 16px;
  min-height: 240px;
  border-radius: 16px;
  overflow: auto;
  color: var(--text-primary);
  background: var(--status-chip-background);
  border: 1px solid var(--card-border);
  line-height: 1.6;
}

.debug-content--compact {
  min-height: 0;
  max-height: 260px;
  font-size: 12px;
}

@media (max-width: 768px) {
  .overview-grid {
    grid-template-columns: 1fr;
  }

  .logs-header {
    flex-direction: column;
    align-items: flex-start;
  }

  .logs-toolbar {
    grid-template-columns: 1fr;
  }
}
</style>
