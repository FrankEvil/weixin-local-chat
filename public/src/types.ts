export interface AppConfig {
  baseUrl: string;
  cdnBaseUrl: string;
  botType: string;
  defaultWorkspace: string;
  codexWorkspace: string;
  claudeWorkspace: string;
  openclawMode: 'auto' | 'docker' | 'local';
  openclawWorkspace: string;
  openclawCommand: string;
  openclawDataDir: string;
  openclawContainer: string;
}

export interface AccountRecord {
  accountId: string;
  displayName: string;
  userId: string;
  token: string;
  baseUrl: string;
  cdnBaseUrl: string;
  isSelected: boolean;
  unreadCount: number;
  latestPeerId: string;
  latestConversationTitle: string;
  latestMessagePreview: string;
  latestMessageType: string;
  latestMessageAt: number;
  lastLoginAt: number;
  createdAt: number;
  updatedAt: number;
}

export interface SyncStateRecord {
  accountId: string;
  getUpdatesBuf: string;
  pauseUntilMs: number;
  lastError: string;
  lastEventAt: number;
}

export interface ConversationRecord {
  accountId: string;
  peerId: string;
  title: string;
  lastMessagePreview: string;
  lastMessageType: string;
  lastMessageAt: number;
  unreadCount: number;
  contextToken: string;
  updatedAt: number;
}

export interface MessageRecord {
  id: string;
  accountId: string;
  peerId: string;
  direction: 'inbound' | 'outbound';
  messageType: 'text' | 'image' | 'file' | 'video' | 'voice' | 'unknown';
  text: string;
  fileName: string;
  mimeType: string;
  mediaPath: string;
  mediaSize: number;
  status: 'pending' | 'sent' | 'failed' | 'received';
  remoteMessageId: string;
  rawJson: string;
  createdAt: number;
  updatedAt: number;
}

export interface LoginSessionRecord {
  sessionKey: string;
  qrcode: string;
  qrcodeUrl: string;
  status: 'wait' | 'scaned' | 'confirmed' | 'expired' | 'error';
  startedAt: number;
  lastCheckedAt: number;
  error: string;
  baseUrl: string;
  cdnBaseUrl: string;
  botType: string;
}

export interface ProviderRuntimeStatus {
  provider: 'codex' | 'claude' | 'openclaw';
  available: boolean;
  command: string;
  workspace: string;
  details: string;
  resolvedMode?: 'local' | 'docker';
  container?: string;
  dataDir?: string;
}

export interface RuntimeDiagnostics {
  checkedAt: string;
  defaultWorkspace: string;
  providers: ProviderRuntimeStatus[];
}

export interface BootstrapPayload {
  config: AppConfig;
  accounts: AccountRecord[];
  selectedAccountId: string;
  selectedPeerId: string;
  conversations: ConversationRecord[];
  status: SyncStateRecord | null;
}

export interface DebugSnapshot {
  config: AppConfig;
  account: AccountRecord | null;
  syncState: SyncStateRecord | null;
  stats: {
    conversationCount: number;
    messageCount: number;
  };
  agentBindings: unknown[];
  agentSessions: unknown[];
  recentLogs: Array<{
    source: string;
    timestamp: string;
    event: string;
    level: 'info' | 'error';
    summary: string;
    payload: Record<string, unknown>;
  }>;
}

export type DebugLogSource = 'all' | 'chat-service' | 'agent-router' | 'weixin-api' | 'weixin-media';

export interface DebugLogQuery {
  source?: DebugLogSource;
  level?: 'all' | 'info' | 'error';
  keyword?: string;
  limit?: number | 'all';
}

export interface ConfigValidationResult {
  config: AppConfig;
  diagnostics: RuntimeDiagnostics;
}
