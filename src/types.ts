export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface AppConfig {
  baseUrl: string;
  cdnBaseUrl: string;
  botType: string;
  defaultWorkspace: string;
  codexWorkspace: string;
  claudeWorkspace: string;
  openclawMode: "auto" | "docker" | "local";
  openclawWorkspace: string;
  openclawCommand: string;
  openclawDataDir: string;
  openclawContainer: string;
}

export type AgentProvider = "codex" | "claude" | "openclaw";

export interface AccountRecord {
  accountId: string;
  displayName: string;
  userId: string;
  token: string;
  baseUrl: string;
  cdnBaseUrl: string;
  isSelected: boolean;
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
  direction: "inbound" | "outbound";
  messageType: "text" | "image" | "file" | "video" | "voice" | "unknown";
  text: string;
  fileName: string;
  mimeType: string;
  mediaPath: string;
  mediaSize: number;
  status: "pending" | "sent" | "failed" | "received";
  remoteMessageId: string;
  rawJson: string;
  createdAt: number;
  updatedAt: number;
}

export interface LoginSessionRecord {
  sessionKey: string;
  qrcode: string;
  qrcodeUrl: string;
  status: "wait" | "scaned" | "confirmed" | "expired" | "error";
  startedAt: number;
  lastCheckedAt: number;
  error: string;
  baseUrl: string;
  cdnBaseUrl: string;
  botType: string;
}

export interface ServerEvent {
  type: "bootstrap" | "accounts" | "conversations" | "messages" | "status";
  accountId?: string;
  peerId?: string;
  payload?: JsonValue;
}

export interface ProviderRuntimeStatus {
  provider: AgentProvider;
  available: boolean;
  command: string;
  workspace: string;
  details: string;
  resolvedMode?: "local" | "docker";
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

export type UploadKind = "image" | "file" | "video" | "voice";

export interface AgentBindingRecord {
  accountId: string;
  peerId: string;
  activeProvider: AgentProvider | "";
  activeSessionId: string;
  updatedAt: number;
}

export interface AgentSessionRecord {
  accountId: string;
  peerId: string;
  provider: AgentProvider;
  sessionId: string;
  status: "idle" | "running" | "error";
  lastError: string;
  lastUsedAt: number;
  createdAt: number;
  updatedAt: number;
}

export interface AgentJobRecord {
  id: string;
  accountId: string;
  peerId: string;
  provider: AgentProvider;
  sessionId: string;
  prompt: string;
  status: "queued" | "running" | "succeeded" | "failed";
  responseText: string;
  error: string;
  createdAt: number;
  updatedAt: number;
}
