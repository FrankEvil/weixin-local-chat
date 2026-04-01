import { computed, ref } from 'vue';
import { defineStore } from 'pinia';

import { apiRequest, formRequest } from '@/api/client';
import type {
  AccountRecord,
  AppConfig,
  AuthStatusPayload,
  BootstrapPayload,
  ConfigValidationResult,
  ConversationRecord,
  DebugLogQuery,
  DebugLogSource,
  DebugSnapshot,
  LoginSessionRecord,
  MessageRecord,
  RuntimeDiagnostics,
  SyncStateRecord,
} from '@/types';

function emptyConfig(): AppConfig {
  return {
    baseUrl: '',
    cdnBaseUrl: '',
    botType: '3',
    notifyToken: '',
    defaultNotifyAccountId: '',
    defaultNotifyPeerId: '',
    defaultWorkspace: '',
    codexWorkspace: '',
    claudeWorkspace: '',
    openclawMode: 'auto',
    openclawWorkspace: '',
    openclawCommand: '',
    openclawDataDir: '',
    openclawContainer: '',
  };
}

export const useWorkbenchStore = defineStore('workbench', () => {
  const authChecked = ref(false);
  const authenticated = ref(false);
  const initialized = ref(false);
  const config = ref<AppConfig>(emptyConfig());
  const diagnostics = ref<RuntimeDiagnostics | null>(null);
  const accounts = ref<AccountRecord[]>([]);
  const selectedAccountId = ref('');
  const conversations = ref<ConversationRecord[]>([]);
  const selectedPeerId = ref('');
  const messages = ref<MessageRecord[]>([]);
  const messageTotal = ref(0);
  const historyLoading = ref(false);
  const historyHasMore = ref(false);
  const searchQuery = ref('');
  const searchResults = ref<MessageRecord[]>([]);
  const status = ref<SyncStateRecord | null>(null);
  const debugSnapshot = ref<DebugSnapshot | null>(null);
  const debugQuery = ref<DebugLogQuery>({
    source: 'all',
    level: 'all',
    keyword: '',
    limit: 'all',
  });
  const loginSession = ref<LoginSessionRecord | null>(null);
  const bootstrapLoading = ref(false);
  const diagnosticsLoading = ref(false);
  const configSaving = ref(false);
  const debugLoading = ref(false);
  const messageSending = ref(false);

  const selectedAccount = computed(() => accounts.value.find((item) => item.accountId === selectedAccountId.value) ?? null);
  const selectedConversation = computed(() => conversations.value.find((item) => item.peerId === selectedPeerId.value) ?? null);
  const visibleMessages = computed(() => (searchQuery.value.trim() ? searchResults.value : messages.value));

  function mergeMessages(nextItems: MessageRecord[]): void {
    const messageMap = new Map(messages.value.map((item) => [item.id, item]));
    for (const next of nextItems) {
      messageMap.set(next.id, next);
    }
    messages.value = Array.from(messageMap.values()).sort((left, right) => left.createdAt - right.createdAt);
  }

  function removeMessage(messageId: string): void {
    messages.value = messages.value.filter((item) => item.id !== messageId);
  }

  function applyBootstrap(payload: BootstrapPayload): void {
    config.value = payload.config;
    accounts.value = payload.accounts;
    selectedAccountId.value = payload.selectedAccountId;
    conversations.value = payload.conversations;
    selectedPeerId.value = payload.selectedPeerId;
    status.value = payload.status;
  }

  function resetWorkbenchState(): void {
    initialized.value = false;
    config.value = emptyConfig();
    diagnostics.value = null;
    accounts.value = [];
    selectedAccountId.value = '';
    conversations.value = [];
    selectedPeerId.value = '';
    messages.value = [];
    messageTotal.value = 0;
    historyLoading.value = false;
    historyHasMore.value = false;
    searchQuery.value = '';
    searchResults.value = [];
    status.value = null;
    debugSnapshot.value = null;
    loginSession.value = null;
  }

  async function loadAuthStatus(): Promise<AuthStatusPayload> {
    const payload = await apiRequest<AuthStatusPayload>('/api/auth/status');
    authenticated.value = payload.authenticated;
    authChecked.value = true;
    if (!payload.authenticated) {
      resetWorkbenchState();
    }
    return payload;
  }

  async function login(password: string): Promise<void> {
    await apiRequest<{ ok: true }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ password }),
    });
    authenticated.value = true;
    authChecked.value = true;
  }

  async function logout(): Promise<void> {
    await apiRequest<{ ok: true }>('/api/auth/logout', {
      method: 'POST',
    });
    markUnauthenticated();
  }

  async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
    await apiRequest<{ ok: true }>('/api/auth/password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    });
  }

  async function regenerateNotifyToken(): Promise<AppConfig> {
    config.value = await apiRequest<AppConfig>('/api/auth/notify-token/regenerate', {
      method: 'POST',
    });
    return config.value;
  }

  function markUnauthenticated(): void {
    authenticated.value = false;
    authChecked.value = true;
    resetWorkbenchState();
  }

  async function initialize(): Promise<void> {
    if (!authenticated.value) {
      return;
    }
    bootstrapLoading.value = true;
    try {
      const payload = await apiRequest<BootstrapPayload>('/api/bootstrap');
      applyBootstrap(payload);
      if (selectedAccountId.value && !conversations.value.length) {
        await loadConversations();
      }
      if (selectedAccountId.value && selectedPeerId.value) {
        await loadMessages();
      }
      await loadDiagnostics().catch(() => undefined);
      initialized.value = true;
    } finally {
      bootstrapLoading.value = false;
    }
  }

  async function loadAccounts(): Promise<void> {
    const payload = await apiRequest<AccountRecord[]>('/api/accounts');
    const effectiveSelectedAccountId = payload.find((item) => item.isSelected)?.accountId
      ?? (payload.some((item) => item.accountId === selectedAccountId.value) ? selectedAccountId.value : '')
      ?? payload[0]?.accountId
      ?? '';
    selectedAccountId.value = effectiveSelectedAccountId || payload[0]?.accountId || '';
    accounts.value = payload.map((item) => ({
      ...item,
      isSelected: item.accountId === selectedAccountId.value,
    }));
  }

  async function selectAccount(accountId: string): Promise<void> {
    await apiRequest<AccountRecord | null>('/api/accounts/select', {
      method: 'POST',
      body: JSON.stringify({ accountId }),
    });
    selectedAccountId.value = accountId;
    selectedPeerId.value = '';
    await loadAccounts();
    await loadConversations();
    if (selectedPeerId.value) {
      await apiRequest('/api/conversations/read', {
        method: 'POST',
        body: JSON.stringify({
          accountId: selectedAccountId.value,
          peerId: selectedPeerId.value,
        }),
      });
    }
    await loadStatus();
    await loadMessages();
  }

  async function renameAccount(accountId: string, displayName: string): Promise<void> {
    await apiRequest<AccountRecord | null>('/api/accounts/update', {
      method: 'POST',
      body: JSON.stringify({ accountId, displayName }),
    });
    await loadAccounts();
  }

  async function clearAccountHistory(accountId: string): Promise<void> {
    await apiRequest<AccountRecord | null>('/api/accounts/history/clear', {
      method: 'POST',
      body: JSON.stringify({ accountId }),
    });
    if (selectedAccountId.value === accountId) {
      selectedPeerId.value = '';
      messages.value = [];
      messageTotal.value = 0;
      clearSearch();
    }
    await Promise.all([loadAccounts(), loadConversations(), loadStatus()]);
    await loadMessages();
  }

  async function deleteAccount(accountId: string): Promise<void> {
    await apiRequest<{ ok: true }>('/api/accounts/delete', {
      method: 'POST',
      body: JSON.stringify({ accountId }),
    });
    if (selectedAccountId.value === accountId) {
      selectedPeerId.value = '';
      messages.value = [];
      messageTotal.value = 0;
      clearSearch();
    }
    await Promise.all([loadAccounts(), loadConversations(), loadStatus()]);
    await loadMessages();
  }

  async function loadConversations(): Promise<void> {
    if (!selectedAccountId.value) {
      conversations.value = [];
      return;
    }
    const payload = await apiRequest<ConversationRecord[]>(`/api/conversations?accountId=${encodeURIComponent(selectedAccountId.value)}`);
    conversations.value = payload;
    if (!payload.some((item) => item.peerId === selectedPeerId.value)) {
      selectedPeerId.value = payload[0]?.peerId ?? '';
    }
  }

  async function openConversation(peerId: string): Promise<void> {
    await apiRequest<ConversationRecord>('/api/conversations/open', {
      method: 'POST',
      body: JSON.stringify({
        accountId: selectedAccountId.value,
        peerId,
      }),
    });
    selectedPeerId.value = peerId;
    await loadConversations();
    await loadMessages();
    await loadStatus();
  }

  async function selectConversation(peerId: string): Promise<void> {
    selectedPeerId.value = peerId;
    await apiRequest('/api/conversations/read', {
      method: 'POST',
      body: JSON.stringify({
        accountId: selectedAccountId.value,
        peerId,
      }),
    });
    await loadConversations();
    await loadMessages();
    await loadStatus();
  }

  async function loadMessages(options: { beforeCreatedAt?: number; appendHistory?: boolean } = {}): Promise<void> {
    if (!selectedAccountId.value || !selectedPeerId.value) {
      messages.value = [];
      messageTotal.value = 0;
      historyHasMore.value = false;
      return;
    }
    const limit = 60;
    const before = options.beforeCreatedAt ?? 0;
    if (options.appendHistory) {
      historyLoading.value = true;
    }
    try {
      const [payload, countPayload] = await Promise.all([
        apiRequest<MessageRecord[]>(
          `/api/messages?accountId=${encodeURIComponent(selectedAccountId.value)}&peerId=${encodeURIComponent(selectedPeerId.value)}&before=${encodeURIComponent(String(before))}&limit=${limit}`,
        ),
        apiRequest<{ total: number }>(
          `/api/messages/count?accountId=${encodeURIComponent(selectedAccountId.value)}&peerId=${encodeURIComponent(selectedPeerId.value)}`,
        ),
      ]);
      if (options.appendHistory) {
        const merged = [...payload, ...messages.value];
        const seen = new Set<string>();
        messages.value = merged.filter((item) => {
          if (seen.has(item.id)) return false;
          seen.add(item.id);
          return true;
        });
      } else {
        messages.value = payload;
      }
      messageTotal.value = countPayload.total;
      historyHasMore.value = messages.value.length < messageTotal.value;
    } finally {
      historyLoading.value = false;
    }
  }

  async function loadOlderMessages(): Promise<void> {
    if (!selectedAccountId.value || !selectedPeerId.value || historyLoading.value || !historyHasMore.value) {
      return;
    }
    const earliestCreatedAt = messages.value[0]?.createdAt ?? 0;
    if (!earliestCreatedAt) {
      return;
    }
    await loadMessages({
      beforeCreatedAt: earliestCreatedAt,
      appendHistory: true,
    });
  }

  async function searchMessages(query: string): Promise<void> {
    searchQuery.value = query.trim();
    if (!searchQuery.value) {
      searchResults.value = [];
      return;
    }
    if (!selectedAccountId.value || !selectedPeerId.value) {
      searchResults.value = [];
      return;
    }
    searchResults.value = await apiRequest<MessageRecord[]>(
      `/api/messages/search?accountId=${encodeURIComponent(selectedAccountId.value)}&peerId=${encodeURIComponent(selectedPeerId.value)}&q=${encodeURIComponent(searchQuery.value)}`,
    );
  }

  function clearSearch(): void {
    searchQuery.value = '';
    searchResults.value = [];
  }

  async function loadStatus(): Promise<void> {
    if (!selectedAccountId.value) {
      status.value = null;
      return;
    }
    status.value = await apiRequest<SyncStateRecord>(`/api/status?accountId=${encodeURIComponent(selectedAccountId.value)}`);
  }

  async function loadDiagnostics(configOverride?: AppConfig): Promise<RuntimeDiagnostics> {
    diagnosticsLoading.value = true;
    try {
      const payload = configOverride
        ? await apiRequest<ConfigValidationResult>('/api/config/validate', {
          method: 'POST',
          body: JSON.stringify(configOverride),
        }).then((result) => result.diagnostics)
        : await apiRequest<RuntimeDiagnostics>('/api/runtime/diagnostics');
      diagnostics.value = payload;
      return payload;
    } finally {
      diagnosticsLoading.value = false;
    }
  }

  async function saveConfig(nextConfig: AppConfig): Promise<AppConfig> {
    configSaving.value = true;
    try {
      config.value = await apiRequest<AppConfig>('/api/config', {
        method: 'POST',
        body: JSON.stringify(nextConfig),
      });
      await loadDiagnostics().catch(() => undefined);
      return config.value;
    } finally {
      configSaving.value = false;
    }
  }

  async function validateConfig(nextConfig: AppConfig): Promise<ConfigValidationResult> {
    return apiRequest<ConfigValidationResult>('/api/config/validate', {
      method: 'POST',
      body: JSON.stringify(nextConfig),
    });
  }

  async function loadDebug(query: Partial<DebugLogQuery> = {}): Promise<void> {
    if (!selectedAccountId.value) {
      debugSnapshot.value = null;
      return;
    }
    debugLoading.value = true;
    try {
      debugQuery.value = {
        ...debugQuery.value,
        ...query,
      };
      const params = new URLSearchParams({
        accountId: selectedAccountId.value,
        logSource: debugQuery.value.source ?? 'all',
        logLevel: debugQuery.value.level ?? 'all',
        logKeyword: debugQuery.value.keyword ?? '',
        logLimit: String(debugQuery.value.limit ?? 'all'),
      });
      debugSnapshot.value = await apiRequest<DebugSnapshot>(`/api/debug?${params.toString()}`);
    } finally {
      debugLoading.value = false;
    }
  }

  async function clearDebugLogs(source: DebugLogSource = 'all'): Promise<void> {
    await apiRequest<{ ok: true }>('/api/debug/logs/clear', {
      method: 'POST',
      body: JSON.stringify({ source }),
    });
    await loadDebug(source === 'all' ? { source: 'all' } : {});
  }

  async function sendText(text: string): Promise<void> {
    if (!selectedAccountId.value || !selectedPeerId.value || !text.trim()) return;
    const createdAt = Date.now();
    const optimisticId = `optimistic-${createdAt}-${Math.random().toString(36).slice(2, 8)}`;
    const optimisticMessage: MessageRecord = {
      id: optimisticId,
      accountId: selectedAccountId.value,
      peerId: selectedPeerId.value,
      direction: 'outbound',
      messageType: 'text',
      text,
      fileName: '',
      mimeType: 'text/plain',
      mediaPath: '',
      mediaSize: text.length,
      status: 'pending',
      remoteMessageId: '',
      rawJson: '',
      createdAt,
      updatedAt: createdAt,
    };
    messageSending.value = true;
    clearSearch();
    mergeMessages([optimisticMessage]);
    try {
      const message = await apiRequest<MessageRecord>('/api/messages/text', {
        method: 'POST',
        body: JSON.stringify({
          accountId: selectedAccountId.value,
          peerId: selectedPeerId.value,
          text,
        }),
      });
      removeMessage(optimisticId);
      mergeMessages([message]);
    } catch (error) {
      mergeMessages([{ ...optimisticMessage, status: 'failed', updatedAt: Date.now() }]);
      throw error;
    } finally {
      messageSending.value = false;
    }
    await Promise.allSettled([loadConversations(), loadMessages(), loadStatus()]);
  }

  async function sendMedia(params: { file: File; caption: string; sendAsVoice: boolean }): Promise<void> {
    if (!selectedAccountId.value || !selectedPeerId.value) return;
    messageSending.value = true;
    try {
      const formData = new FormData();
      formData.append('accountId', selectedAccountId.value);
      formData.append('peerId', selectedPeerId.value);
      formData.append('caption', params.caption);
      formData.append('sendAsVoice', String(params.sendAsVoice));
      formData.append('file', params.file, params.file.name);
      const message = await formRequest<MessageRecord>('/api/messages/media', formData);
      clearSearch();
      mergeMessages([message]);
    } finally {
      messageSending.value = false;
    }
    await Promise.allSettled([loadConversations(), loadMessages(), loadStatus()]);
  }

  async function startLogin(): Promise<LoginSessionRecord> {
    const payload = await apiRequest<LoginSessionRecord>('/api/login/start', {
      method: 'POST',
    });
    loginSession.value = payload;
    return payload;
  }

  async function pollLogin(): Promise<LoginSessionRecord | null> {
    if (!loginSession.value?.sessionKey) return null;
    const payload = await apiRequest<LoginSessionRecord>(`/api/login/session?sessionKey=${encodeURIComponent(loginSession.value.sessionKey)}`);
    loginSession.value = payload;
    if (payload.status === 'confirmed') {
      await loadAccounts();
      await loadConversations();
      await loadStatus();
      await loadMessages();
      await loadDiagnostics().catch(() => undefined);
    }
    return payload;
  }

  function loginQrImageUrl(): string {
    const imageContent = loginSession.value?.qrcodeUrl?.trim() || '';
    const qrPayload = loginSession.value?.qrcode?.trim() || '';
    const raw = imageContent || qrPayload;
    if (!raw) return '';

    if (/^data:image\//i.test(raw)) {
      return raw;
    }

    if (/^https?:\/\/.+\.(png|jpg|jpeg|gif|webp|svg)(?:[?#].*)?$/i.test(raw)) {
      return raw;
    }

    if (/^<svg[\s>]/i.test(raw)) {
      return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(raw)}`;
    }

    if (/^[A-Za-z0-9+/=\r\n]+$/.test(raw) && raw.length > 128) {
      return `data:image/png;base64,${raw.replace(/\s+/g, '')}`;
    }

    return '';
  }

  function loginQrCodeValue(): string {
    return loginSession.value?.qrcodeUrl?.trim() || loginSession.value?.qrcode?.trim() || '';
  }

  return {
    authChecked,
    authenticated,
    initialized,
    config,
    diagnostics,
    accounts,
    conversations,
    messages,
    messageTotal,
    historyLoading,
    historyHasMore,
    searchQuery,
    searchResults,
    status,
    debugSnapshot,
    debugQuery,
    loginSession,
    selectedAccountId,
    selectedPeerId,
    selectedAccount,
    selectedConversation,
    visibleMessages,
    bootstrapLoading,
    diagnosticsLoading,
    configSaving,
    debugLoading,
    messageSending,
    loadAuthStatus,
    login,
    logout,
    changePassword,
    regenerateNotifyToken,
    markUnauthenticated,
    initialize,
    loadAccounts,
    selectAccount,
    loadConversations,
    openConversation,
    selectConversation,
    loadMessages,
    loadOlderMessages,
    searchMessages,
    clearSearch,
    loadStatus,
    loadDiagnostics,
    saveConfig,
    validateConfig,
    loadDebug,
    clearDebugLogs,
    sendText,
    sendMedia,
    startLogin,
    pollLogin,
    loginQrImageUrl,
    loginQrCodeValue,
    renameAccount,
    clearAccountHistory,
    deleteAccount,
  };
});
