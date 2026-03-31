<template>
  <div class="workbench-shell">
    <div class="ambient ambient-left"></div>
    <div class="ambient ambient-right"></div>

    <header class="topbar">
      <div class="brand-block">
        <span class="brand-kicker">Local Ops Console</span>
        <h1>微信本地工作台</h1>
      </div>

      <n-space align="center" :size="10" wrap class="topbar-actions">
        <n-button tertiary size="small" @click="toggleTheme">
          {{ isDarkMode ? '浅色主题' : '深色主题' }}
        </n-button>
        <n-button tertiary size="small" @click="showSettings = true">设置</n-button>
        <n-button tertiary size="small" @click="showDebug = true">调试</n-button>
        <n-button type="primary" size="small" @click="showLogin = true">扫码登录</n-button>
      </n-space>
    </header>

    <main class="board-grid">
      <aside class="panel left-panel">
        <section class="panel-section account-section">
          <div class="section-header">
            <div>
              <span class="section-kicker">Accounts</span>
              <h2>账号面板</h2>
            </div>
            <n-space :size="8">
              <n-button tertiary size="small" @click="showLogin = true">新增</n-button>
              <n-button quaternary circle @click="refreshAccounts">
                <template #icon>
                  <span class="button-icon">↻</span>
                </template>
              </n-button>
            </n-space>
          </div>

          <div class="account-list">
            <n-card
              v-for="account in workbench.accounts"
              :key="account.accountId"
              size="small"
              hoverable
              class="account-card"
              :class="{ active: account.accountId === workbench.selectedAccountId }"
              @click="handleSelectAccount(account.accountId)"
            >
              <template #header>
                <n-space justify="space-between" align="start" :wrap="false">
                  <div class="account-card__heading">
                    <strong class="account-card__title">
                      <n-ellipsis :line-clamp="1">{{ account.displayName || account.accountId }}</n-ellipsis>
                    </strong>
                    <n-text depth="3" class="account-card__meta account-card__summary">
                      <n-ellipsis :line-clamp="2">{{ account.latestMessagePreview || '等待新的聊天消息…' }}</n-ellipsis>
                    </n-text>
                  </div>
                  <n-space :size="8" align="center" :wrap="false">
                    <n-badge v-if="account.unreadCount > 0" :value="account.unreadCount" :max="99" type="error" />
                    <n-dropdown
                      trigger="click"
                      :options="accountActionOptions"
                      placement="bottom-end"
                      @select="handleAccountActionSelect(account, $event)"
                    >
                      <n-button text size="tiny" @click.stop>管理</n-button>
                    </n-dropdown>
                  </n-space>
                </n-space>
              </template>
              <div class="account-card__footer">
                <n-text depth="3" class="account-card__meta">
                  {{ account.latestMessageAt ? formatRelative(account.latestMessageAt) : `最近登录 ${formatTimestamp(account.lastLoginAt)}` }}
                </n-text>
                <n-tag size="small" round :bordered="false" :type="accountMessageTagType(account)">
                  {{ accountMessageTagLabel(account) }}
                </n-tag>
              </div>
            </n-card>

            <n-empty v-if="!workbench.accounts.length" description="还没有可用账号">
              <template #extra>
                <n-button type="primary" @click="showLogin = true">立即扫码登录</n-button>
              </template>
            </n-empty>
          </div>
        </section>

      </aside>

      <section class="panel center-panel">
        <div class="chat-header">
          <div class="chat-header__meta">
            <strong class="chat-header__title" :title="currentConversationTitle">{{ currentConversationTitle }}</strong>
            <span class="chat-header__subtitle" :title="currentConversationSubtitle">{{ currentConversationSubtitle }}</span>
          </div>
          <n-space :size="10" wrap class="chat-header__actions">
            <n-tag size="small" round type="info">{{ messageCountHeadline }}</n-tag>
            <n-button tertiary size="small" @click="showSearchBar = !showSearchBar">
              {{ showSearchBar ? '收起搜索' : '搜索消息' }}
            </n-button>
            <n-button tertiary size="small" @click="showOverview = true">详情</n-button>
          </n-space>
        </div>

        <div v-if="showSearchBar" class="message-search-bar">
          <n-input
            v-model:value="messageSearchInput"
            placeholder="搜索当前会话中的文本消息"
            clearable
            @keyup.enter="handleSearchMessages"
          />
          <n-space :size="10">
            <n-button size="small" @click="handleSearchMessages">搜索</n-button>
            <n-button size="small" tertiary @click="clearMessageSearch" :disabled="!workbench.searchQuery">清空</n-button>
          </n-space>
        </div>

        <div class="message-panel">
          <n-spin :show="workbench.bootstrapLoading" class="message-panel__spin">
            <div ref="messageStreamRef" class="message-stream" @scroll="handleMessageScroll">
              <div v-if="workbench.historyLoading" class="message-history-indicator">正在加载更早消息…</div>
              <div v-else-if="workbench.historyHasMore" class="message-history-indicator">向上滚动加载更早消息</div>
              <template v-if="displayedMessages.length">
                <article
                  v-for="message in displayedMessages"
                  :key="message.id"
                  class="message-row"
                  :class="message.direction"
                >
                  <div class="message-bubble">
                    <div class="message-bubble__meta">
                      <span>{{ message.direction === 'outbound' ? '我方发送' : '对端消息' }}</span>
                      <span>{{ messageLabel(message) }}</span>
                      <span>{{ formatTimestamp(message.createdAt) }}</span>
                    </div>

                    <p v-if="message.text" class="message-text">{{ message.text }}</p>

                    <img
                      v-if="isImageMessage(message)"
                      class="media-preview media-preview--image"
                      :src="mediaUrl(message)"
                      :alt="message.fileName || '图片消息'"
                    />

                    <video
                      v-else-if="isVideoMessage(message)"
                      class="media-preview"
                      controls
                      :src="mediaUrl(message)"
                    ></video>

                    <audio
                      v-else-if="isAudioMessage(message)"
                      class="media-preview media-preview--audio"
                      controls
                      :src="mediaUrl(message)"
                    ></audio>

                    <a
                      v-else-if="message.mediaPath || message.fileName"
                      class="file-chip"
                      :href="mediaUrl(message)"
                      target="_blank"
                      rel="noreferrer"
                    >
                      {{ message.fileName || '下载媒体文件' }}
                    </a>

                    <span class="message-status" :class="message.status">{{ message.status }}</span>
                  </div>
                </article>
              </template>

              <n-empty v-else description="当前没有消息记录" class="message-empty" />
            </div>
          </n-spin>
        </div>

        <section class="composer-panel">
          <div class="composer-panel__hint">
            <span class="section-kicker">Composer</span>
            <span>支持直接输入 `/codex`、`/claude`、`/openclaw` 指令</span>
          </div>

          <div v-if="selectedUploadFiles.length" class="upload-chip-list upload-chip-list--inline">
            <div
              v-for="file in selectedUploadFiles"
              :key="uploadFileKey(file)"
              class="upload-chip"
            >
              <button
                type="button"
                class="upload-chip__preview"
                :title="`${file.name} · ${formatFileSize(file.size)}`"
                @click="openUploadPreview(file)"
              >
                <span class="upload-chip__icon">{{ uploadFileIcon(file) }}</span>
                <span class="upload-chip__name">{{ file.name }}</span>
                <span class="upload-chip__meta">{{ formatFileSize(file.size) }}</span>
              </button>
              <button type="button" class="upload-chip__remove" @click="removeUploadFile(file)">×</button>
            </div>
          </div>

          <n-input
            v-model:value="composerText"
            type="textarea"
            :autosize="{ minRows: 2, maxRows: 4 }"
            placeholder="输入消息内容。支持直接输入 /codex、/claude、/openclaw 指令。"
          />

          <div class="composer-actions">
            <div class="composer-actions__left">
              <n-switch v-if="hasVoiceUploadFiles" v-model:value="sendAsVoice">
                <template #checked>是</template>
                <template #unchecked>否</template>
              </n-switch>
              <span v-if="hasVoiceUploadFiles" class="composer-actions__placeholder">语音文件是否使用微信格式</span>
              <span v-else-if="selectedUploadFiles.length" class="composer-actions__placeholder">当前文件将按普通文件发送</span>
              <span v-else class="composer-actions__placeholder">未选择文件时仅发送文本消息</span>
            </div>
            <n-space :size="10" wrap>
              <n-button tertiary @click="triggerFilePick">{{ selectedUploadFiles.length ? '继续添加' : '选择文件' }}</n-button>
              <n-button
                type="primary"
                :loading="workbench.messageSending"
                :disabled="!canSubmitComposer"
                @click="handleSubmitComposer"
              >
                发送
              </n-button>
            </n-space>
          </div>
        </section>
      </section>

    </main>

    <SettingsDrawer
      v-model="showSettings"
      :config="workbench.config"
      :diagnostics="workbench.diagnostics"
      :saving="workbench.configSaving"
      :validating="configValidating"
      @save="handleSaveConfig"
      @validate="handleValidateConfig"
      @refresh-diagnostics="handleRefreshDiagnostics"
    />

    <DebugDrawer
      v-model="showDebug"
      :loading="workbench.debugLoading"
      :snapshot="workbench.debugSnapshot"
      @refresh="handleRefreshDebug"
      @clear-logs="handleClearDebugLogs"
    />

    <LoginDialog
      v-model="showLogin"
      :session="workbench.loginSession"
      :qr-image-url="workbench.loginQrImageUrl()"
      :qr-value="workbench.loginQrCodeValue()"
      :busy="loginBusy"
      @start="handleStartLogin"
      @poll="handleManualPollLogin"
    />

    <n-drawer :show="showOverview" width="420" placement="right" @update:show="showOverview = $event">
      <n-drawer-content title="会话详情" closable>
        <n-space vertical :size="20">
          <section class="drawer-section">
            <span class="section-kicker">Actions</span>
            <h2>会话操作</h2>
            <n-space :size="10" wrap>
              <n-button v-if="exportUrl" tertiary tag="a" :href="exportUrl" target="_blank">导出当前会话</n-button>
              <n-button tertiary @click="showDebug = true">打开调试面板</n-button>
            </n-space>
          </section>

          <section class="drawer-section">
            <span class="section-kicker">Runtime</span>
            <h2>运行诊断</h2>
            <p>{{ diagnosticsHeadline }}</p>
            <n-space vertical :size="12">
              <div
                v-for="provider in providerStatusTags"
                :key="provider.provider"
                class="runtime-item"
              >
                <div class="runtime-item__header">
                  <strong>{{ provider.provider }}</strong>
                  <n-tag size="small" :type="provider.available ? 'success' : 'warning'">
                    {{ provider.available ? '可用' : '待修复' }}
                  </n-tag>
                </div>
                <span>{{ provider.command || '-' }}</span>
                <small>{{ provider.details }}</small>
              </div>
            </n-space>
          </section>

          <section class="drawer-section">
            <span class="section-kicker">Status</span>
            <h2>会话状态</h2>
            <div class="drawer-status-grid">
              <div class="status-chip">
                <span class="status-chip__label">同步缓存</span>
                <strong class="status-chip__value">{{ workbench.status?.getUpdatesBuf || '未初始化' }}</strong>
              </div>
              <div class="status-chip">
                <span class="status-chip__label">最近事件</span>
                <strong class="status-chip__value">{{ formatTimestamp(workbench.status?.lastEventAt ?? 0) }}</strong>
              </div>
              <div class="status-chip">
                <span class="status-chip__label">暂停到</span>
                <strong class="status-chip__value">{{ formatTimestamp(workbench.status?.pauseUntilMs ?? 0) }}</strong>
              </div>
              <div class="status-chip">
                <span class="status-chip__label">最近错误</span>
                <strong class="status-chip__value">{{ workbench.status?.lastError || '暂无错误' }}</strong>
              </div>
            </div>
          </section>

          <section class="drawer-section">
            <span class="section-kicker">Snapshot</span>
            <h2>当前上下文</h2>
            <ul class="snapshot-list">
              <li>账号：{{ workbench.selectedAccount?.displayName || '未选择' }}</li>
              <li>会话：{{ workbench.selectedConversation?.title || workbench.selectedPeerId || '未选择' }}</li>
              <li>消息数：{{ workbench.messageTotal }}</li>
              <li>会话数：{{ workbench.conversations.length }}</li>
              <li>工作区：{{ workbench.config.defaultWorkspace || '未配置' }}</li>
            </ul>
          </section>

          <section class="drawer-section">
            <span class="section-kicker">Hints</span>
            <h2>优化建议已接入</h2>
            <ul class="snapshot-list">
              <li>OpenClaw 已支持 `auto / local / docker` 三模式。</li>
              <li>设置抽屉可直接做运行诊断和配置校验。</li>
              <li>前端已迁移到 Vue 3 + Pinia + Naive UI，后续扩展不需要继续手搓 DOM。</li>
            </ul>
          </section>
        </n-space>
      </n-drawer-content>
    </n-drawer>

    <n-modal :show="showUploadPreview" @update:show="handleUploadPreviewVisibility">
      <n-card
        title="文件预览"
        closable
        size="small"
        class="upload-preview-modal"
        :bordered="false"
        role="dialog"
        aria-modal="true"
        @close="closeUploadPreview"
      >
        <template v-if="previewFile">
          <div class="upload-preview-modal__meta">
            <span class="upload-preview-modal__badge">{{ uploadFileIcon(previewFile) }}</span>
            <strong>{{ previewFile.name }}</strong>
            <span>{{ formatFileSize(previewFile.size) }}</span>
          </div>

          <img
            v-if="uploadPreviewKind === 'image'"
            class="upload-preview-modal__image"
            :src="uploadPreviewUrl"
            :alt="previewFile.name"
          />

          <video
            v-else-if="uploadPreviewKind === 'video'"
            class="upload-preview-modal__media"
            controls
            :src="uploadPreviewUrl"
          ></video>

          <audio
            v-else-if="uploadPreviewKind === 'audio'"
            class="upload-preview-modal__audio"
            controls
            :src="uploadPreviewUrl"
          ></audio>

          <pre v-else-if="uploadPreviewKind === 'text'" class="upload-preview-modal__text">{{ uploadPreviewText }}</pre>

          <n-empty v-else description="当前文件类型暂不支持内嵌预览，可继续发送或删除。" />
        </template>
      </n-card>
    </n-modal>

    <n-modal :show="showRenameModal" @update:show="handleRenameModalVisibility">
      <n-card
        title="修改账号名称"
        closable
        size="small"
        class="account-rename-modal"
        :bordered="false"
        role="dialog"
        aria-modal="true"
        @close="closeRenameModal"
      >
        <n-space vertical :size="14">
          <n-text depth="3">名称会同步到左侧账号卡片和当前聊天头部，便于区分多个微信账号。</n-text>
          <n-input
            v-model:value="renameDraft"
            maxlength="24"
            show-count
            placeholder="输入新的账号名称"
            @keyup.enter="handleConfirmRename"
          />
          <n-space justify="end">
            <n-button tertiary @click="closeRenameModal">取消</n-button>
            <n-button type="primary" @click="handleConfirmRename">保存</n-button>
          </n-space>
        </n-space>
      </n-card>
    </n-modal>

    <input
      ref="fileInputRef"
      type="file"
      multiple
      class="hidden-file-input"
      @change="handleFileSelected"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  NBadge,
  NButton,
  NCard,
  NDrawer,
  NDrawerContent,
  NDropdown,
  NEllipsis,
  NEmpty,
  NInput,
  NModal,
  NSpace,
  NSpin,
  NSwitch,
  NTag,
  NText,
  type DropdownOption,
  useDialog,
  useMessage,
} from 'naive-ui';

import DebugDrawer from '@/components/DebugDrawer.vue';
import LoginDialog from '@/components/LoginDialog.vue';
import SettingsDrawer from '@/components/SettingsDrawer.vue';
import { useWorkbenchStore } from '@/stores/workbench';
import { themeControllerKey } from '@/theme';
import type { AccountRecord, AppConfig, ConversationRecord, MessageRecord } from '@/types';

const workbench = useWorkbenchStore();
const messageApi = useMessage();
const dialog = useDialog();
const themeController = inject(themeControllerKey, null);

const showSettings = ref(false);
const showDebug = ref(false);
const showLogin = ref(false);
const showOverview = ref(false);
const showSearchBar = ref(false);
const composerText = ref('');
const messageSearchInput = ref('');
const selectedUploadFiles = ref<File[]>([]);
const sendAsVoice = ref(false);
const showUploadPreview = ref(false);
const showRenameModal = ref(false);
const previewFile = ref<File | null>(null);
const uploadPreviewUrl = ref('');
const uploadPreviewText = ref('');
const renameAccountTarget = ref<AccountRecord | null>(null);
const renameDraft = ref('');
const configValidating = ref(false);
const loginBusy = ref(false);
const fileInputRef = ref<HTMLInputElement | null>(null);
const messageStreamRef = ref<HTMLElement | null>(null);
const pendingHistoryScrollRestore = ref<{ scrollTop: number; scrollHeight: number } | null>(null);

let eventSource: EventSource | null = null;
let reconnectTimer: number | null = null;
let loginPollTimer: number | null = null;

const isDarkMode = computed(() => themeController?.mode.value === 'dark');

const canSubmitComposer = computed(() =>
  Boolean(workbench.selectedPeerId && (composerText.value.trim() || selectedUploadFiles.value.length)),
);

const hasVoiceUploadFiles = computed(() => selectedUploadFiles.value.some((file) => isVoiceUploadFile(file)));
const uploadPreviewKind = computed(() => (previewFile.value ? detectUploadPreviewKind(previewFile.value) : 'unknown'));

const providerStatusTags = computed(() => workbench.diagnostics?.providers ?? []);
const accountActionOptions: DropdownOption[] = [
  { label: '修改名称', key: 'rename' },
  { label: '清空聊天记录', key: 'clear-history' },
  { label: '删除账号', key: 'delete-account' },
];
const displayedMessages = computed(() =>
  showSearchBar.value && workbench.searchQuery.trim() ? workbench.searchResults : workbench.messages,
);

const diagnosticsHeadline = computed(() => {
  if (!providerStatusTags.value.length) {
    return '还没有诊断结果，打开设置抽屉后可以主动刷新运行时状态。';
  }
  const availableCount = providerStatusTags.value.filter((item) => item.available).length;
  return `共诊断 ${providerStatusTags.value.length} 个 provider，其中 ${availableCount} 个可直接使用。`;
});
const messageCountHeadline = computed(() => {
  const total = workbench.messageTotal;
  const loaded = workbench.messages.length;
  if (!total) {
    return '0 条消息';
  }
  if (loaded >= total) {
    return `${total} 条消息`;
  }
  return `最近 ${loaded} / 共 ${total} 条`;
});

const currentConversationTitle = computed(() => {
  return workbench.selectedConversation?.title || workbench.selectedPeerId || '未选择聊天';
});

const currentConversationSubtitle = computed(() => {
  if (!workbench.selectedAccountId) {
    return '先选择一个账号，再查看它当前关联的聊天窗口。';
  }
  if (!workbench.selectedPeerId) {
    return '当前账号还没有可用的真实会话，需先通过扫码关联产生消息往来。';
  }
  return '当前窗口已连接真实聊天对象，可直接收发消息与附件。';
});

const exportUrl = computed(() => {
  if (!workbench.selectedAccountId || !workbench.selectedPeerId) return '';
  return `/api/export/conversation?accountId=${encodeURIComponent(workbench.selectedAccountId)}&peerId=${encodeURIComponent(workbench.selectedPeerId)}`;
});

onMounted(async () => {
  try {
    await workbench.initialize();
    connectEventStream();
    if (!workbench.accounts.length) {
      showLogin.value = true;
    }
  } catch (error) {
    messageApi.error(extractErrorMessage(error, '初始化工作台失败'));
  }
});

onBeforeUnmount(() => {
  disconnectEventStream();
  stopLoginPolling();
  revokeUploadPreview();
});

watch(
  () => [workbench.selectedPeerId, workbench.messages.length, workbench.searchQuery] as const,
  async ([, , searchQuery]) => {
    if (searchQuery) return;
    await nextTick();
    const target = messageStreamRef.value;
    if (!target) return;
    if (pendingHistoryScrollRestore.value) {
      const { scrollTop, scrollHeight } = pendingHistoryScrollRestore.value;
      target.scrollTop = target.scrollHeight - scrollHeight + scrollTop;
      pendingHistoryScrollRestore.value = null;
      return;
    }
    await scrollMessagesToBottom();
  },
  { flush: 'post' },
);

watch(showDebug, async (visible) => {
  if (visible) {
    await workbench.loadDebug({ limit: 'all' }).catch(() => undefined);
  }
});

watch(showSearchBar, (visible) => {
  if (!visible && workbench.searchQuery.trim()) {
    clearMessageSearch();
  }
});

watch(
  () => workbench.loginSession?.status,
  (status) => {
    if (!showLogin.value) {
      stopLoginPolling();
      return;
    }
    if (!status || status === 'confirmed' || status === 'expired' || status === 'error') {
      stopLoginPolling();
      if (status === 'confirmed') {
        messageApi.success('登录已确认，账号列表已刷新');
      }
      return;
    }
    startLoginPolling();
  },
  { immediate: true },
);

async function refreshAccounts(): Promise<void> {
  try {
    await Promise.all([workbench.loadAccounts(), workbench.loadConversations(), workbench.loadStatus()]);
    if (showDebug.value) {
      await workbench.loadDebug({ limit: 'all' }).catch(() => undefined);
    }
  } catch (error) {
    messageApi.error(extractErrorMessage(error, '刷新账号失败'));
  }
}

async function handleSelectAccount(accountId: string): Promise<void> {
  try {
    clearMessageSearch();
    await workbench.selectAccount(accountId);
    if (showDebug.value) {
      await workbench.loadDebug({ limit: 'all' }).catch(() => undefined);
    }
  } catch (error) {
    messageApi.error(extractErrorMessage(error, '切换账号失败'));
  }
}

async function handleRenameAccount(account: AccountRecord): Promise<void> {
  renameAccountTarget.value = account;
  renameDraft.value = account.displayName || '';
  showRenameModal.value = true;
}

function closeRenameModal(): void {
  showRenameModal.value = false;
  renameAccountTarget.value = null;
  renameDraft.value = '';
}

function handleRenameModalVisibility(nextVisible: boolean): void {
  if (!nextVisible) {
    closeRenameModal();
    return;
  }
  showRenameModal.value = true;
}

async function handleConfirmRename(): Promise<void> {
  const account = renameAccountTarget.value;
  const nextName = renameDraft.value.trim();
  if (!account || !nextName || nextName === (account.displayName || '').trim()) {
    closeRenameModal();
    return;
  }
  try {
    await workbench.renameAccount(account.accountId, nextName);
    closeRenameModal();
    messageApi.success('账号名称已更新');
  } catch (error) {
    messageApi.error(extractErrorMessage(error, '更新账号名称失败'));
  }
}

function handleAccountActionSelect(account: AccountRecord, action: string | number): void {
  if (action === 'rename') {
    void handleRenameAccount(account);
    return;
  }
  if (action === 'clear-history') {
    dialog.warning({
      title: '清空聊天记录',
      content: `将清空「${account.displayName || account.accountId}」的聊天消息、会话摘要和 Agent 上下文，本地媒体缓存也会一起删除。`,
      positiveText: '确认清空',
      negativeText: '取消',
      onPositiveClick: async () => {
        try {
          await workbench.clearAccountHistory(account.accountId);
          if (showDebug.value) {
            await workbench.loadDebug({ limit: 'all' }).catch(() => undefined);
          }
          messageApi.success('聊天记录已清空');
        } catch (error) {
          messageApi.error(extractErrorMessage(error, '清空聊天记录失败'));
        }
      },
    });
    return;
  }
  if (action === 'delete-account') {
    dialog.error({
      title: '删除账号',
      content: `将删除「${account.displayName || account.accountId}」的登录态、聊天记录、本地收发文件和 Agent 上下文，此操作不可恢复。`,
      positiveText: '确认删除',
      negativeText: '取消',
      onPositiveClick: async () => {
        try {
          await workbench.deleteAccount(account.accountId);
          if (showDebug.value) {
            await workbench.loadDebug({ limit: 'all' }).catch(() => undefined);
          }
          messageApi.success('账号已删除');
        } catch (error) {
          messageApi.error(extractErrorMessage(error, '删除账号失败'));
        }
      },
    });
  }
}

async function handleSearchMessages(): Promise<void> {
  try {
    await workbench.searchMessages(messageSearchInput.value);
  } catch (error) {
    messageApi.error(extractErrorMessage(error, '搜索消息失败'));
  }
}

async function handleMessageScroll(event: Event): Promise<void> {
  if (showSearchBar.value && workbench.searchQuery.trim()) {
    return;
  }
  const target = event.target as HTMLElement | null;
  if (!target || target.scrollTop > 80 || !workbench.historyHasMore || workbench.historyLoading) {
    return;
  }
  pendingHistoryScrollRestore.value = {
    scrollTop: target.scrollTop,
    scrollHeight: target.scrollHeight,
  };
  try {
    await workbench.loadOlderMessages();
  } catch (error) {
    pendingHistoryScrollRestore.value = null;
    messageApi.error(extractErrorMessage(error, '加载历史消息失败'));
  }
}

function clearMessageSearch(): void {
  messageSearchInput.value = '';
  workbench.clearSearch();
}

async function handleSubmitComposer(): Promise<void> {
  const text = composerText.value.trim();
  const files = [...selectedUploadFiles.value];
  if (!workbench.selectedPeerId || (!text && !files.length)) return;
  const failedFiles: string[] = [];
  try {
    if (text) {
      await workbench.sendText(text);
      composerText.value = '';
    }
    for (const file of files) {
      try {
        await workbench.sendMedia({
          file,
          caption: '',
          sendAsVoice: sendAsVoice.value && isVoiceUploadFile(file),
        });
        removeUploadFile(file);
      } catch (error) {
        failedFiles.push(`${file.name}：${extractErrorMessage(error, '发送失败')}`);
      }
    }
    clearMessageSearch();
    if (text || files.length) {
      if (!selectedUploadFiles.value.length) {
        clearUpload();
      }
      await scrollMessagesToBottom();
    }
    if (failedFiles.length) {
      messageApi.error(`部分文件发送失败：${failedFiles.join('；')}`);
    }
  } catch (error) {
    messageApi.error(extractErrorMessage(error, '发送消息失败'));
  }
}

function triggerFilePick(): void {
  fileInputRef.value?.click();
}

function handleFileSelected(event: Event): void {
  const input = event.target as HTMLInputElement | null;
  const files = Array.from(input?.files ?? []);
  if (!files.length) {
    if (fileInputRef.value) {
      fileInputRef.value.value = '';
    }
    return;
  }
  const merged = [...selectedUploadFiles.value];
  for (const file of files) {
    if (!merged.some((item) => uploadFileKey(item) === uploadFileKey(file))) {
      merged.push(file);
    }
  }
  selectedUploadFiles.value = merged;
  if (!selectedUploadFiles.value.some((file) => isVoiceUploadFile(file))) {
    sendAsVoice.value = false;
  }
  if (fileInputRef.value) {
    fileInputRef.value.value = '';
  }
}

function removeUploadFile(target: File): void {
  selectedUploadFiles.value = selectedUploadFiles.value.filter((file) => uploadFileKey(file) !== uploadFileKey(target));
  if (previewFile.value && uploadFileKey(previewFile.value) === uploadFileKey(target)) {
    closeUploadPreview();
  }
  if (!selectedUploadFiles.value.some((file) => isVoiceUploadFile(file))) {
    sendAsVoice.value = false;
  }
}

function clearUpload(): void {
  selectedUploadFiles.value = [];
  sendAsVoice.value = false;
  closeUploadPreview();
  if (fileInputRef.value) {
    fileInputRef.value.value = '';
  }
}

async function handleSaveConfig(nextConfig: AppConfig): Promise<void> {
  try {
    await workbench.saveConfig(nextConfig);
    messageApi.success('配置已保存');
  } catch (error) {
    messageApi.error(extractErrorMessage(error, '保存配置失败'));
  }
}

async function handleValidateConfig(nextConfig: AppConfig): Promise<void> {
  configValidating.value = true;
  try {
    const result = await workbench.validateConfig(nextConfig);
    workbench.diagnostics = result.diagnostics;
    messageApi.success('配置校验完成');
  } catch (error) {
    messageApi.error(extractErrorMessage(error, '校验配置失败'));
  } finally {
    configValidating.value = false;
  }
}

async function handleRefreshDiagnostics(): Promise<void> {
  try {
    await workbench.loadDiagnostics();
    messageApi.success('运行诊断已刷新');
  } catch (error) {
    messageApi.error(extractErrorMessage(error, '刷新运行诊断失败'));
  }
}

async function handleRefreshDebug(): Promise<void> {
  try {
    await workbench.loadDebug({ limit: 'all' });
    messageApi.success('运行日志已刷新');
  } catch (error) {
    messageApi.error(extractErrorMessage(error, '刷新调试日志失败'));
  }
}

async function handleClearDebugLogs(source: 'all' | 'chat-service' | 'agent-router' | 'weixin-api' | 'weixin-media'): Promise<void> {
  try {
    await workbench.clearDebugLogs(source);
    await workbench.loadDebug({ limit: 'all' });
    messageApi.success(source === 'all' ? '运行日志已全部清空' : `${source} 日志已清空`);
  } catch (error) {
    messageApi.error(extractErrorMessage(error, '清空运行日志失败'));
  }
}

async function handleStartLogin(): Promise<void> {
  loginBusy.value = true;
  try {
    await workbench.startLogin();
    startLoginPolling();
  } catch (error) {
    messageApi.error(extractErrorMessage(error, '生成登录二维码失败'));
  } finally {
    loginBusy.value = false;
  }
}

async function handleManualPollLogin(): Promise<void> {
  try {
    await workbench.pollLogin();
  } catch (error) {
    messageApi.error(extractErrorMessage(error, '刷新登录状态失败'));
  }
}

function startLoginPolling(): void {
  if (loginPollTimer !== null) return;
  loginPollTimer = window.setInterval(() => {
    workbench.pollLogin().catch(() => undefined);
  }, 3000);
}

function stopLoginPolling(): void {
  if (loginPollTimer !== null) {
    window.clearInterval(loginPollTimer);
    loginPollTimer = null;
  }
}

function connectEventStream(): void {
  disconnectEventStream();
  eventSource = new EventSource('/api/events');
  eventSource.onmessage = (event) => {
    const payload = parseEventPayload(event.data);
    if (!payload) return;
    void handleServerEvent(payload);
  };
  eventSource.onerror = () => {
    disconnectEventStream(false);
    if (reconnectTimer === null) {
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        connectEventStream();
      }, 2500);
    }
  };
}

function disconnectEventStream(clearReconnect = true): void {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
  if (clearReconnect && reconnectTimer !== null) {
    window.clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

async function handleServerEvent(payload: { type: string; accountId?: string; peerId?: string; payload?: unknown }): Promise<void> {
  try {
    if (payload.type === 'bootstrap') {
      await Promise.all([
        workbench.loadAccounts(),
        workbench.loadConversations(),
        workbench.loadStatus(),
      ]);
      if (workbench.selectedPeerId) {
        await workbench.loadMessages();
      }
      return;
    }

    if (payload.type === 'accounts') {
      await workbench.loadAccounts();
      if (!payload.accountId || payload.accountId === workbench.selectedAccountId) {
        await Promise.all([workbench.loadConversations(), workbench.loadStatus()]);
      }
      return;
    }

    if (payload.type === 'conversations') {
      await workbench.loadAccounts();
      if (!payload.accountId || payload.accountId === workbench.selectedAccountId) {
        await workbench.loadConversations();
      }
      return;
    }

    if (payload.type === 'messages') {
      await workbench.loadAccounts();
      if (
        (!payload.accountId || payload.accountId === workbench.selectedAccountId) &&
        (!payload.peerId || payload.peerId === workbench.selectedPeerId)
      ) {
        await workbench.loadMessages();
      }
      if (!payload.accountId || payload.accountId === workbench.selectedAccountId) {
        await workbench.loadConversations();
      }
      return;
    }

    if (payload.type === 'status') {
      if (workbench.selectedAccountId) {
        await workbench.loadStatus();
      }
      const message = typeof payload.payload === 'object' && payload.payload && 'message' in payload.payload
        ? (payload.payload as { message?: unknown }).message
        : undefined;
      if (message === 'config_saved') {
        await workbench.loadDiagnostics().catch(() => undefined);
      }
      return;
    }
  } finally {
    if (showDebug.value) {
      await workbench.loadDebug({ limit: 'all' }).catch(() => undefined);
    }
  }
}

function parseEventPayload(raw: string): { type: string; accountId?: string; peerId?: string; payload?: unknown } | null {
  try {
    return JSON.parse(raw) as { type: string; accountId?: string; peerId?: string; payload?: unknown };
  } catch {
    return null;
  }
}

function renderConversationPreview(item: ConversationRecord): string {
  return item.lastMessagePreview || `${item.lastMessageType || '消息'} · 暂无文本预览`;
}

function accountMessageTagLabel(account: AccountRecord): string {
  if (!account.latestMessageType) return '新账号';
  if (account.latestMessageType === 'image') return '图片';
  if (account.latestMessageType === 'video') return '视频';
  if (account.latestMessageType === 'voice') return '语音';
  if (account.latestMessageType === 'file') return '文件';
  if (account.latestMessageType === 'text') return '文本';
  return '消息';
}

function accountMessageTagType(account: AccountRecord): 'default' | 'info' | 'success' | 'warning' | 'error' {
  if (account.latestMessageType === 'image' || account.latestMessageType === 'video') return 'info';
  if (account.latestMessageType === 'voice') return 'success';
  if (account.latestMessageType === 'file') return 'warning';
  return 'default';
}

function mediaUrl(message: MessageRecord): string {
  return `/api/media/${encodeURIComponent(message.id)}`;
}

function isImageMessage(message: MessageRecord): boolean {
  return message.messageType === 'image' || message.mimeType.startsWith('image/');
}

function isVideoMessage(message: MessageRecord): boolean {
  return message.messageType === 'video' || message.mimeType.startsWith('video/');
}

function isAudioMessage(message: MessageRecord): boolean {
  return message.messageType === 'voice' || message.mimeType.startsWith('audio/');
}

function messageLabel(message: MessageRecord): string {
  if (message.messageType === 'image') return '图片';
  if (message.messageType === 'video') return '视频';
  if (message.messageType === 'voice') return '语音';
  if (message.messageType === 'file') return '文件';
  if (message.messageType === 'text') return '文本';
  return '其他';
}

function formatTimestamp(value: number): string {
  if (!value) return '-';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

function formatRelative(value: number): string {
  if (!value) return '刚刚';
  const diff = Date.now() - value;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.max(1, Math.floor(diff / 60_000))} 分钟前`;
  if (diff < 86_400_000) return `${Math.max(1, Math.floor(diff / 3_600_000))} 小时前`;
  return `${Math.max(1, Math.floor(diff / 86_400_000))} 天前`;
}

function formatFileSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function uploadFileKey(file: File): string {
  return `${file.name}-${file.size}-${file.lastModified}-${file.type}`;
}

function isVoiceUploadFile(file: File): boolean {
  const lowerName = file.name.toLowerCase();
  const lowerType = (file.type || '').toLowerCase();
  return lowerType.startsWith('audio/')
    || ['.silk', '.wav', '.mp3', '.m4a', '.aac', '.ogg', '.opus'].some((ext) => lowerName.endsWith(ext));
}

function detectUploadPreviewKind(file: File): 'image' | 'video' | 'audio' | 'text' | 'unknown' {
  const lowerName = file.name.toLowerCase();
  const lowerType = (file.type || '').toLowerCase();
  if (lowerType.startsWith('image/')) return 'image';
  if (lowerType.startsWith('video/')) return 'video';
  if (lowerType.startsWith('audio/')) return 'audio';
  if (
    lowerType.startsWith('text/')
    || ['.txt', '.md', '.json', '.log', '.csv', '.yaml', '.yml', '.xml'].some((ext) => lowerName.endsWith(ext))
  ) {
    return 'text';
  }
  return 'unknown';
}

function uploadFileIcon(file: File): string {
  const kind = detectUploadPreviewKind(file);
  if (kind === 'image') return 'IMG';
  if (kind === 'video') return 'VID';
  if (kind === 'audio') return 'AUD';
  if (kind === 'text') return 'TXT';
  return 'FILE';
}

async function openUploadPreview(file: File): Promise<void> {
  revokeUploadPreview();
  previewFile.value = file;
  uploadPreviewText.value = '';
  const kind = detectUploadPreviewKind(file);
  if (kind === 'image' || kind === 'video' || kind === 'audio') {
    uploadPreviewUrl.value = URL.createObjectURL(file);
  } else if (kind === 'text') {
    uploadPreviewText.value = await file.text();
  }
  showUploadPreview.value = true;
}

function handleUploadPreviewVisibility(nextVisible: boolean): void {
  if (!nextVisible) {
    closeUploadPreview();
    return;
  }
  showUploadPreview.value = true;
}

function closeUploadPreview(): void {
  showUploadPreview.value = false;
  previewFile.value = null;
  uploadPreviewText.value = '';
  revokeUploadPreview();
}

function revokeUploadPreview(): void {
  if (uploadPreviewUrl.value) {
    URL.revokeObjectURL(uploadPreviewUrl.value);
    uploadPreviewUrl.value = '';
  }
}

function extractErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function toggleTheme(): void {
  themeController?.toggleTheme();
}

async function scrollMessagesToBottom(): Promise<void> {
  await nextTick();
  const target = messageStreamRef.value;
  if (!target) return;
  target.scrollTop = target.scrollHeight;
}
</script>

<style scoped>
.workbench-shell {
  position: relative;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 12px;
  height: 100vh;
  padding: 14px;
  overflow: hidden;
  color: var(--text-primary);
  background: var(--shell-background);
}

.ambient {
  position: absolute;
  inset: auto;
  width: 520px;
  height: 520px;
  border-radius: 999px;
  filter: blur(80px);
  opacity: 0.28;
  pointer-events: none;
}

.ambient-left {
  top: -120px;
  left: -120px;
  background: radial-gradient(circle, var(--ambient-left), transparent 64%);
}

.ambient-right {
  right: -160px;
  bottom: -180px;
  background: radial-gradient(circle, var(--ambient-right), transparent 64%);
}

.topbar {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 10px 14px;
  border: 1px solid var(--panel-border);
  border-radius: 18px;
  background: var(--panel-background);
  box-shadow: var(--panel-shadow);
  backdrop-filter: blur(20px);
}

.brand-block h1 {
  margin: 4px 0 0;
  font-size: clamp(18px, 2.1vw, 24px);
  line-height: 1.1;
}

.brand-kicker,
.section-kicker {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  letter-spacing: 0.24em;
  text-transform: uppercase;
  color: var(--accent-soft);
}

.board-grid {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr);
  gap: 16px;
  height: 100%;
  min-height: 0;
}

.panel {
  min-height: 0;
  min-width: 0;
  border: 1px solid var(--panel-border);
  border-radius: 24px;
  background: var(--panel-background);
  box-shadow: var(--panel-shadow);
  backdrop-filter: blur(20px);
}

.left-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px;
  overflow: auto;
}

.account-section {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 12px;
  flex: 1;
  min-height: 0;
}

.conversation-section {
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  gap: 14px;
  min-height: 0;
}

.center-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: 100%;
  min-height: 0;
  padding: 14px;
  overflow: hidden;
}

.panel-section h2,
.drawer-section h2 {
  margin: 8px 0 0;
  font-size: 18px;
}

.panel-section p,
.drawer-section p {
  margin: 10px 0 0;
  color: var(--text-secondary);
  line-height: 1.6;
}

.section-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
}

.button-icon {
  display: inline-flex;
  font-size: 16px;
}

.account-card,
.conversation-item {
  width: 100%;
  min-width: 0;
  padding: 16px 18px;
  text-align: left;
  color: inherit;
  border: 1px solid var(--card-border);
  border-radius: 20px;
  background: var(--card-background);
  transition: transform 0.18s ease, border-color 0.18s ease, background 0.18s ease;
  cursor: pointer;
}

.account-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
  overflow: auto;
  padding-right: 4px;
}

.account-card:hover,
.conversation-item:hover {
  transform: translateY(-1px);
  border-color: var(--card-border-active);
  background: var(--card-background-active);
}

.account-card.active,
.conversation-item.active {
  border-color: var(--card-border-active);
  background: var(--card-background-active);
}

.account-card {
  padding: 0;
}

.account-card :deep(.n-card-header) {
  padding: 12px 14px 6px;
}

.account-card :deep(.n-card__content) {
  padding: 0 14px 12px;
}

.account-card__heading {
  min-width: 0;
}

.account-card__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 4px;
  min-width: 0;
}

.account-card__header,
.conversation-item__header,
.conversation-item__footer,
.runtime-item__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
}

.account-card__meta,
.conversation-item__preview,
.conversation-item__footer,
.runtime-item span,
.runtime-item small {
  display: block;
  color: var(--text-secondary);
}

.account-card__meta,
.conversation-item__id {
  overflow-wrap: anywhere;
  word-break: break-word;
}

.account-card__summary {
  margin-top: 6px;
}

.account-card__meta + .account-card__meta,
.conversation-item__preview {
  margin-top: 8px;
}

.account-card__title,
.conversation-item__title,
.conversation-item__id,
.upload-file-name,
.status-chip__value {
  min-width: 0;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.account-card__title,
.conversation-item__title {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.account-card__title {
  font-size: 16px;
  line-height: 1.35;
}

.conversation-item__time {
  flex: none;
  white-space: nowrap;
  color: var(--text-tertiary);
}

.conversation-item__preview {
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.conversation-list {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
  overflow: auto;
  padding-right: 4px;
}

.conversation-empty {
  margin-top: 24px;
}

.compact-input {
  margin-bottom: 2px;
}

.status-chip {
  min-width: 0;
  padding: 12px 14px;
  border-radius: 18px;
  background: var(--status-chip-background);
  border: 1px solid var(--card-border);
}

.status-chip__label {
  display: block;
  margin-bottom: 8px;
  font-size: 12px;
  color: var(--text-tertiary);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.status-chip strong {
  display: block;
  line-height: 1.5;
  color: var(--text-primary);
}

.chat-header,
.message-search-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-width: 0;
  padding: 10px 12px;
  border-radius: 18px;
  background: var(--card-background);
  border: 1px solid var(--card-border);
}

.chat-header__meta {
  min-width: 0;
}

.chat-header__title {
  display: block;
  margin-top: 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-primary);
}

.chat-header__subtitle,
.composer-panel__hint,
.composer-actions__placeholder {
  display: block;
  margin-top: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-secondary);
  font-size: 13px;
}

.chat-header__actions {
  flex: none;
}

.message-search-bar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 10px;
  align-items: stretch;
  min-width: 0;
  position: relative;
  z-index: 2;
  min-height: 58px;
  padding: 12px;
  box-sizing: border-box;
  overflow: visible;
  margin-bottom: 8px;
  box-shadow: 0 10px 24px rgba(15, 23, 42, 0.06);
}

.message-search-bar :deep(.n-input),
.message-search-bar :deep(.n-input-wrapper) {
  min-height: 36px;
}

.search-alert {
  margin-bottom: -4px;
}

.message-panel {
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
  border-radius: 22px;
  background: color-mix(in srgb, var(--panel-background) 86%, transparent);
  border: 1px solid var(--card-border);
  padding: 12px;
}

.message-panel__spin {
  display: block;
  height: 100%;
}

.message-panel__spin :deep(.n-spin-container),
.message-panel__spin :deep(.n-spin-content) {
  height: 100%;
}

.message-stream {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 14px;
  height: 100%;
  min-height: 0;
  padding-right: 4px;
  overflow: auto;
}

.message-history-indicator {
  align-self: center;
  padding: 6px 12px;
  border-radius: 999px;
  color: var(--text-secondary);
  background: var(--card-background);
  border: 1px solid var(--card-border);
  font-size: 12px;
}

.message-row {
  display: flex;
}

.message-row.outbound {
  justify-content: flex-end;
}

.message-row.inbound {
  justify-content: flex-start;
}

.message-bubble {
  width: min(72%, 700px);
  min-width: 0;
  padding: 16px 18px;
  border-radius: 24px;
  border: 1px solid var(--card-border);
  background: var(--bubble-background);
  box-shadow: inset 0 1px 0 var(--bubble-highlight);
}

.message-row.outbound .message-bubble {
  background: var(--bubble-outbound-background);
}

.message-row.inbound .message-bubble {
  background: var(--bubble-inbound-background);
}

.message-bubble__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 10px;
  font-size: 12px;
  color: var(--text-tertiary);
}

.message-text {
  margin: 0 0 12px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  color: var(--text-primary);
  line-height: 1.8;
}

.media-preview {
  display: block;
  width: min(100%, 360px);
  max-width: 100%;
  margin-top: 6px;
  border-radius: 18px;
}

.media-preview--image {
  max-height: 360px;
  object-fit: cover;
}

.media-preview--audio {
  width: min(100%, 320px);
}

.file-chip {
  display: inline-flex;
  padding: 10px 14px;
  border-radius: 999px;
  color: var(--link-color);
  text-decoration: none;
  background: var(--file-chip-background);
}

.message-status {
  display: inline-flex;
  margin-top: 12px;
  font-size: 12px;
  color: var(--text-tertiary);
}

.message-status.failed {
  color: var(--error-color);
}

.message-status.sent,
.message-status.received {
  color: var(--success-color);
}

.message-empty {
  margin: auto 0;
}

.composer-panel {
  display: grid;
  flex: none;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 20px;
  background: var(--composer-background);
  border: 1px solid var(--card-border);
  position: relative;
  z-index: 1;
  box-shadow: 0 -8px 18px rgba(15, 23, 42, 0.06);
}

.composer-panel__hint {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
  margin: 0;
}

.composer-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
}

.composer-actions__left {
  min-width: 0;
}

.drawer-status-grid {
  display: grid;
  gap: 12px;
}

.upload-chip-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.upload-chip-list--inline {
  margin-bottom: -2px;
}

.upload-chip {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  max-width: min(100%, 260px);
  border: 1px solid var(--card-border);
  border-radius: 999px;
  background: var(--status-chip-background);
  color: var(--text-primary);
}

.upload-chip__preview,
.upload-chip__remove {
  border: 0;
  background: transparent;
  color: inherit;
}

.upload-chip__preview {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  max-width: 100%;
  padding: 6px 10px;
  cursor: pointer;
}

.upload-chip__icon {
  flex: none;
  min-width: 34px;
  padding: 2px 6px;
  border-radius: 999px;
  background: var(--card-background-active);
  color: var(--accent-soft);
  font-size: 11px;
  font-weight: 700;
  text-align: center;
}

.upload-chip__name {
  max-width: 150px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.upload-chip__meta,
.upload-chip__remove {
  flex: none;
  color: var(--text-secondary);
  font-size: 12px;
}

.upload-chip__remove {
  padding: 6px 10px 6px 0;
  cursor: pointer;
}

.upload-preview-modal {
  width: min(820px, 92vw);
}

.account-rename-modal {
  width: min(460px, calc(100vw - 32px));
}

.account-rename-modal :deep(.n-card-header) {
  padding-bottom: 8px;
}

.account-rename-modal :deep(.n-card__content) {
  padding-top: 0;
}

.upload-preview-modal__meta {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  margin-bottom: 16px;
  color: var(--text-secondary);
}

.upload-preview-modal__meta strong {
  min-width: 0;
  overflow-wrap: anywhere;
  word-break: break-word;
  color: var(--text-primary);
}

.upload-preview-modal__badge {
  flex: none;
  padding: 4px 8px;
  border-radius: 999px;
  background: var(--card-background-active);
  color: var(--accent-soft);
  font-size: 11px;
  font-weight: 700;
}

.upload-preview-modal__image,
.upload-preview-modal__media {
  display: block;
  width: 100%;
  max-height: 68vh;
  border-radius: 16px;
  background: rgba(15, 23, 42, 0.05);
}

.upload-preview-modal__audio {
  width: 100%;
}

.upload-preview-modal__text {
  max-height: 68vh;
  margin: 0;
  padding: 16px;
  overflow: auto;
  border-radius: 16px;
  background: rgba(15, 23, 42, 0.05);
  color: var(--text-primary);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

.runtime-item {
  padding: 14px 16px;
  border-radius: 18px;
  background: var(--card-background);
  border: 1px solid var(--card-border);
}

.runtime-item span {
  margin-top: 8px;
}

.runtime-item small {
  margin-top: 6px;
  line-height: 1.5;
}

.snapshot-list {
  display: grid;
  gap: 10px;
  margin: 16px 0 0;
  padding-left: 18px;
  color: var(--text-secondary);
  line-height: 1.6;
}

.hidden-file-input {
  display: none;
}

.topbar-actions {
  justify-content: flex-end;
}

@media (max-width: 1480px) {
  .board-grid {
    grid-template-columns: 280px minmax(0, 1fr);
  }
}

@media (max-width: 1100px) {
  .workbench-shell {
    height: auto;
    min-height: 100vh;
    padding: 20px;
    overflow: visible;
  }

  .board-grid {
    grid-template-columns: 1fr;
    height: auto;
  }

  .left-panel,
  .center-panel {
    padding: 18px;
  }

  .topbar {
    flex-direction: column;
    align-items: flex-start;
  }

  .chat-header,
  .message-search-bar {
    grid-template-columns: 1fr;
  }

  .center-panel {
    overflow: visible;
  }

  .message-panel {
    min-height: 360px;
  }
}

@media (max-width: 768px) {
  .topbar,
  .composer-panel__hint,
  .composer-actions,
  .upload-panel__actions,
  .upload-panel__summary {
    flex-direction: column;
    align-items: stretch;
  }

  .chat-header,
  .message-search-bar {
    display: grid;
    grid-template-columns: 1fr;
  }

  .message-bubble {
    width: 100%;
  }
}
</style>
