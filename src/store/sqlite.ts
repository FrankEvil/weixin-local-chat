import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import type {
  AccountRecord,
  AppConfig,
  AgentBindingRecord,
  AgentJobRecord,
  AgentSessionRecord,
  BootstrapPayload,
  ConversationRecord,
  MessageRecord,
  SyncStateRecord,
} from "../types.js";

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function sqlNumber(value: number): string {
  return Number.isFinite(value) ? String(value) : "0";
}

function sqlBool(value: boolean): string {
  return value ? "1" : "0";
}

function nowMs(): number {
  return Date.now();
}

export class SqliteStore {
  constructor(private readonly dbPath: string) {}

  init(): void {
    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    if (!fs.existsSync(this.dbPath)) {
      fs.writeFileSync(this.dbPath, "");
    }
    const schema = `
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS accounts (
  account_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  user_id TEXT NOT NULL,
  token TEXT NOT NULL,
  base_url TEXT NOT NULL,
  cdn_base_url TEXT NOT NULL,
  is_selected INTEGER NOT NULL DEFAULT 0,
  last_login_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sync_state (
  account_id TEXT PRIMARY KEY,
  get_updates_buf TEXT NOT NULL DEFAULT '',
  pause_until_ms INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NOT NULL DEFAULT '',
  last_event_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS conversations (
  account_id TEXT NOT NULL,
  peer_id TEXT NOT NULL,
  title TEXT NOT NULL,
  last_message_preview TEXT NOT NULL DEFAULT '',
  last_message_type TEXT NOT NULL DEFAULT 'text',
  last_message_at INTEGER NOT NULL DEFAULT 0,
  unread_count INTEGER NOT NULL DEFAULT 0,
  context_token TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (account_id, peer_id)
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  peer_id TEXT NOT NULL,
  direction TEXT NOT NULL,
  message_type TEXT NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  file_name TEXT NOT NULL DEFAULT '',
  mime_type TEXT NOT NULL DEFAULT '',
  media_path TEXT NOT NULL DEFAULT '',
  media_size INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'received',
  remote_message_id TEXT NOT NULL DEFAULT '',
  raw_json TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_account_peer_created
ON messages(account_id, peer_id, created_at);
CREATE TABLE IF NOT EXISTS agent_bindings (
  account_id TEXT NOT NULL,
  peer_id TEXT NOT NULL,
  active_provider TEXT NOT NULL DEFAULT '',
  active_session_id TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (account_id, peer_id)
);
CREATE TABLE IF NOT EXISTS agent_sessions (
  account_id TEXT NOT NULL,
  peer_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  session_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'idle',
  last_error TEXT NOT NULL DEFAULT '',
  last_used_at INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (account_id, peer_id, provider)
);
CREATE TABLE IF NOT EXISTS agent_jobs (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  peer_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  session_id TEXT NOT NULL DEFAULT '',
  prompt TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'queued',
  response_text TEXT NOT NULL DEFAULT '',
  error TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_agent_jobs_account_peer_created
ON agent_jobs(account_id, peer_id, created_at DESC);
`;
    this.exec(schema);
    this.ensureDefaultConfig();
  }

  private ensureDefaultConfig(): void {
    const config = this.getConfig();
    if (!config.baseUrl) {
      this.saveConfig({
        baseUrl: "https://ilinkai.weixin.qq.com",
        cdnBaseUrl: "https://novac2c.cdn.weixin.qq.com/c2c",
        botType: "3",
        defaultWorkspace: process.cwd(),
        codexWorkspace: "",
        claudeWorkspace: "",
        openclawMode: "auto",
        openclawWorkspace: "",
        openclawCommand: "",
        openclawDataDir: "",
        openclawContainer: "openclaw-openclaw-gateway-1",
      });
    }
  }

  private exec(sql: string): void {
    execFileSync("sqlite3", [this.dbPath, sql], { encoding: "utf-8" });
  }

  private query<T>(sql: string): T[] {
    const output = execFileSync("sqlite3", ["-json", this.dbPath, sql], {
      encoding: "utf-8",
    }).trim();
    if (!output) return [];
    return JSON.parse(output) as T[];
  }

  getBootstrap(): BootstrapPayload {
    const accounts = this.listAccounts();
    const selectedAccountId = accounts.find((item) => item.isSelected)?.accountId ?? accounts[0]?.accountId ?? "";
    const conversations = selectedAccountId ? this.listConversations(selectedAccountId) : [];
    return {
      config: this.getConfig(),
      accounts,
      selectedAccountId,
      selectedPeerId: conversations[0]?.peerId ?? "",
      conversations,
      status: selectedAccountId ? this.getSyncState(selectedAccountId) : null,
    };
  }

  getConfig(): AppConfig {
    const rows = this.query<{ key: string; value: string }>("SELECT key, value FROM settings;");
    const map = new Map(rows.map((row) => [row.key, row.value]));
    return {
      baseUrl: map.get("baseUrl") ?? "",
      cdnBaseUrl: map.get("cdnBaseUrl") ?? "",
      botType: map.get("botType") ?? "3",
      defaultWorkspace: map.get("defaultWorkspace") ?? process.cwd(),
      codexWorkspace: map.get("codexWorkspace") ?? "",
      claudeWorkspace: map.get("claudeWorkspace") ?? "",
      openclawMode: (map.get("openclawMode") as AppConfig["openclawMode"]) ?? "auto",
      openclawWorkspace: map.get("openclawWorkspace") ?? "",
      openclawCommand: map.get("openclawCommand") ?? "",
      openclawDataDir: map.get("openclawDataDir") ?? "",
      openclawContainer: map.get("openclawContainer") ?? "openclaw-openclaw-gateway-1",
    };
  }

  saveConfig(config: AppConfig): void {
    const updatedAt = nowMs();
    const statements = [
      this.upsertSettingSql("baseUrl", config.baseUrl, updatedAt),
      this.upsertSettingSql("cdnBaseUrl", config.cdnBaseUrl, updatedAt),
      this.upsertSettingSql("botType", config.botType, updatedAt),
      this.upsertSettingSql("defaultWorkspace", config.defaultWorkspace, updatedAt),
      this.upsertSettingSql("codexWorkspace", config.codexWorkspace, updatedAt),
      this.upsertSettingSql("claudeWorkspace", config.claudeWorkspace, updatedAt),
      this.upsertSettingSql("openclawMode", config.openclawMode, updatedAt),
      this.upsertSettingSql("openclawWorkspace", config.openclawWorkspace, updatedAt),
      this.upsertSettingSql("openclawCommand", config.openclawCommand, updatedAt),
      this.upsertSettingSql("openclawDataDir", config.openclawDataDir, updatedAt),
      this.upsertSettingSql("openclawContainer", config.openclawContainer, updatedAt),
    ];
    this.exec(statements.join("\n"));
  }

  private upsertSettingSql(key: string, value: string, updatedAt: number): string {
    return `
INSERT INTO settings(key, value, updated_at)
VALUES(${sqlString(key)}, ${sqlString(value)}, ${sqlNumber(updatedAt)})
ON CONFLICT(key) DO UPDATE SET
  value = excluded.value,
  updated_at = excluded.updated_at;`;
  }

  listAccounts(): AccountRecord[] {
    return this.query<AccountRecord>(`
SELECT
  account_id AS accountId,
  display_name AS displayName,
  user_id AS userId,
  token,
  base_url AS baseUrl,
  cdn_base_url AS cdnBaseUrl,
  is_selected AS isSelected,
  last_login_at AS lastLoginAt,
  created_at AS createdAt,
  updated_at AS updatedAt
FROM accounts
ORDER BY is_selected DESC, updated_at DESC;
`).map((item) => ({ ...item, isSelected: Boolean(item.isSelected) }));
  }

  getAccount(accountId: string): AccountRecord | null {
    const rows = this.query<AccountRecord>(`
SELECT
  account_id AS accountId,
  display_name AS displayName,
  user_id AS userId,
  token,
  base_url AS baseUrl,
  cdn_base_url AS cdnBaseUrl,
  is_selected AS isSelected,
  last_login_at AS lastLoginAt,
  created_at AS createdAt,
  updated_at AS updatedAt
FROM accounts
WHERE account_id = ${sqlString(accountId)}
LIMIT 1;`);
    if (!rows[0]) return null;
    return { ...rows[0], isSelected: Boolean(rows[0].isSelected) };
  }

  upsertAccount(account: Omit<AccountRecord, "createdAt" | "updatedAt" | "isSelected"> & { isSelected?: boolean }): AccountRecord {
    const existing = this.getAccount(account.accountId);
    const createdAt = existing?.createdAt ?? nowMs();
    const updatedAt = nowMs();
    const isSelected = account.isSelected ?? existing?.isSelected ?? false;
    const sql = `
INSERT INTO accounts(
  account_id, display_name, user_id, token, base_url, cdn_base_url,
  is_selected, last_login_at, created_at, updated_at
)
VALUES(
  ${sqlString(account.accountId)},
  ${sqlString(account.displayName)},
  ${sqlString(account.userId)},
  ${sqlString(account.token)},
  ${sqlString(account.baseUrl)},
  ${sqlString(account.cdnBaseUrl)},
  ${sqlBool(isSelected)},
  ${sqlNumber(account.lastLoginAt)},
  ${sqlNumber(createdAt)},
  ${sqlNumber(updatedAt)}
)
ON CONFLICT(account_id) DO UPDATE SET
  display_name = excluded.display_name,
  user_id = excluded.user_id,
  token = excluded.token,
  base_url = excluded.base_url,
  cdn_base_url = excluded.cdn_base_url,
  is_selected = excluded.is_selected,
  last_login_at = excluded.last_login_at,
  updated_at = excluded.updated_at;`;
    this.exec(sql);
    if (isSelected) {
      this.selectAccount(account.accountId);
    }
    return this.getAccount(account.accountId)!;
  }

  selectAccount(accountId: string): void {
    this.exec(`
UPDATE accounts SET is_selected = 0;
UPDATE accounts SET is_selected = 1, updated_at = ${sqlNumber(nowMs())}
WHERE account_id = ${sqlString(accountId)};`);
  }

  getSelectedAccount(): AccountRecord | null {
    return this.listAccounts().find((item) => item.isSelected) ?? null;
  }

  getSyncState(accountId: string): SyncStateRecord {
    const rows = this.query<SyncStateRecord>(`
SELECT
  account_id AS accountId,
  get_updates_buf AS getUpdatesBuf,
  pause_until_ms AS pauseUntilMs,
  last_error AS lastError,
  last_event_at AS lastEventAt
FROM sync_state
WHERE account_id = ${sqlString(accountId)}
LIMIT 1;`);
    return rows[0] ?? {
      accountId,
      getUpdatesBuf: "",
      pauseUntilMs: 0,
      lastError: "",
      lastEventAt: 0,
    };
  }

  saveSyncState(state: SyncStateRecord): void {
    this.exec(`
INSERT INTO sync_state(
  account_id, get_updates_buf, pause_until_ms, last_error, last_event_at
)
VALUES(
  ${sqlString(state.accountId)},
  ${sqlString(state.getUpdatesBuf)},
  ${sqlNumber(state.pauseUntilMs)},
  ${sqlString(state.lastError)},
  ${sqlNumber(state.lastEventAt)}
)
ON CONFLICT(account_id) DO UPDATE SET
  get_updates_buf = excluded.get_updates_buf,
  pause_until_ms = excluded.pause_until_ms,
  last_error = excluded.last_error,
  last_event_at = excluded.last_event_at;`);
  }

  upsertConversation(record: ConversationRecord): void {
    this.exec(`
INSERT INTO conversations(
  account_id, peer_id, title, last_message_preview, last_message_type,
  last_message_at, unread_count, context_token, updated_at
)
VALUES(
  ${sqlString(record.accountId)},
  ${sqlString(record.peerId)},
  ${sqlString(record.title)},
  ${sqlString(record.lastMessagePreview)},
  ${sqlString(record.lastMessageType)},
  ${sqlNumber(record.lastMessageAt)},
  ${sqlNumber(record.unreadCount)},
  ${sqlString(record.contextToken)},
  ${sqlNumber(record.updatedAt)}
)
ON CONFLICT(account_id, peer_id) DO UPDATE SET
  title = excluded.title,
  last_message_preview = excluded.last_message_preview,
  last_message_type = excluded.last_message_type,
  last_message_at = excluded.last_message_at,
  unread_count = excluded.unread_count,
  context_token = excluded.context_token,
  updated_at = excluded.updated_at;`);
  }

  getConversation(accountId: string, peerId: string): ConversationRecord | null {
    const rows = this.query<ConversationRecord>(`
SELECT
  account_id AS accountId,
  peer_id AS peerId,
  title,
  last_message_preview AS lastMessagePreview,
  last_message_type AS lastMessageType,
  last_message_at AS lastMessageAt,
  unread_count AS unreadCount,
  context_token AS contextToken,
  updated_at AS updatedAt
FROM conversations
WHERE account_id = ${sqlString(accountId)}
  AND peer_id = ${sqlString(peerId)}
LIMIT 1;`);
    return rows[0] ?? null;
  }

  listConversations(accountId: string): ConversationRecord[] {
    return this.query<ConversationRecord>(`
SELECT
  account_id AS accountId,
  peer_id AS peerId,
  title,
  last_message_preview AS lastMessagePreview,
  last_message_type AS lastMessageType,
  last_message_at AS lastMessageAt,
  unread_count AS unreadCount,
  context_token AS contextToken,
  updated_at AS updatedAt
FROM conversations
WHERE account_id = ${sqlString(accountId)}
ORDER BY last_message_at DESC, updated_at DESC;`);
  }

  openConversation(accountId: string, peerId: string): ConversationRecord {
    const existing = this.getConversation(accountId, peerId);
    const next: ConversationRecord = {
      accountId,
      peerId,
      title: existing?.title || peerId,
      lastMessagePreview: existing?.lastMessagePreview || "",
      lastMessageType: existing?.lastMessageType || "text",
      lastMessageAt: existing?.lastMessageAt || 0,
      unreadCount: existing?.unreadCount || 0,
      contextToken: existing?.contextToken || "",
      updatedAt: nowMs(),
    };
    this.upsertConversation(next);
    return next;
  }

  markConversationRead(accountId: string, peerId: string): void {
    this.exec(`
UPDATE conversations
SET unread_count = 0, updated_at = ${sqlNumber(nowMs())}
WHERE account_id = ${sqlString(accountId)}
  AND peer_id = ${sqlString(peerId)};`);
  }

  saveMessage(message: MessageRecord): void {
    this.exec(`
INSERT INTO messages(
  id, account_id, peer_id, direction, message_type, text,
  file_name, mime_type, media_path, media_size, status,
  remote_message_id, raw_json, created_at, updated_at
)
VALUES(
  ${sqlString(message.id)},
  ${sqlString(message.accountId)},
  ${sqlString(message.peerId)},
  ${sqlString(message.direction)},
  ${sqlString(message.messageType)},
  ${sqlString(message.text)},
  ${sqlString(message.fileName)},
  ${sqlString(message.mimeType)},
  ${sqlString(message.mediaPath)},
  ${sqlNumber(message.mediaSize)},
  ${sqlString(message.status)},
  ${sqlString(message.remoteMessageId)},
  ${sqlString(message.rawJson)},
  ${sqlNumber(message.createdAt)},
  ${sqlNumber(message.updatedAt)}
)
ON CONFLICT(id) DO UPDATE SET
  text = excluded.text,
  file_name = excluded.file_name,
  mime_type = excluded.mime_type,
  media_path = excluded.media_path,
  media_size = excluded.media_size,
  status = excluded.status,
  remote_message_id = excluded.remote_message_id,
  raw_json = excluded.raw_json,
  updated_at = excluded.updated_at;`);
  }

  updateMessageStatus(id: string, status: MessageRecord["status"], remoteMessageId = ""): void {
    this.exec(`
UPDATE messages
SET status = ${sqlString(status)},
    remote_message_id = CASE
      WHEN ${sqlString(remoteMessageId)} = '' THEN remote_message_id
      ELSE ${sqlString(remoteMessageId)}
    END,
    updated_at = ${sqlNumber(nowMs())}
WHERE id = ${sqlString(id)};`);
  }

  getMessage(id: string): MessageRecord | null {
    const rows = this.query<MessageRecord>(`
SELECT
  id,
  account_id AS accountId,
  peer_id AS peerId,
  direction,
  message_type AS messageType,
  text,
  file_name AS fileName,
  mime_type AS mimeType,
  media_path AS mediaPath,
  media_size AS mediaSize,
  status,
  remote_message_id AS remoteMessageId,
  raw_json AS rawJson,
  created_at AS createdAt,
  updated_at AS updatedAt
FROM messages
WHERE id = ${sqlString(id)}
LIMIT 1;`);
    return rows[0] ?? null;
  }

  listMessages(accountId: string, peerId: string, limit = 200): MessageRecord[] {
    return this.query<MessageRecord>(`
SELECT
  id,
  account_id AS accountId,
  peer_id AS peerId,
  direction,
  message_type AS messageType,
  text,
  file_name AS fileName,
  mime_type AS mimeType,
  media_path AS mediaPath,
  media_size AS mediaSize,
  status,
  remote_message_id AS remoteMessageId,
  raw_json AS rawJson,
  created_at AS createdAt,
  updated_at AS updatedAt
FROM messages
WHERE account_id = ${sqlString(accountId)}
  AND peer_id = ${sqlString(peerId)}
ORDER BY created_at ASC
LIMIT ${sqlNumber(limit)};`);
  }

  searchMessages(accountId: string, queryText: string, peerId = "", limit = 100): MessageRecord[] {
    const like = `%${queryText.replace(/'/g, "''")}%`;
    const peerClause = peerId.trim()
      ? `AND peer_id = ${sqlString(peerId)}`
      : "";
    return this.query<MessageRecord>(`
SELECT
  id,
  account_id AS accountId,
  peer_id AS peerId,
  direction,
  message_type AS messageType,
  text,
  file_name AS fileName,
  mime_type AS mimeType,
  media_path AS mediaPath,
  media_size AS mediaSize,
  status,
  remote_message_id AS remoteMessageId,
  raw_json AS rawJson,
  created_at AS createdAt,
  updated_at AS updatedAt
FROM messages
WHERE account_id = ${sqlString(accountId)}
  ${peerClause}
  AND (
    text LIKE ${sqlString(like)}
    OR file_name LIKE ${sqlString(like)}
  )
ORDER BY created_at DESC
LIMIT ${sqlNumber(limit)};`);
  }

  getAccountStats(accountId: string): { conversationCount: number; messageCount: number } {
    const rows = this.query<{ conversationCount: number; messageCount: number }>(`
SELECT
  (SELECT COUNT(*) FROM conversations WHERE account_id = ${sqlString(accountId)}) AS conversationCount,
  (SELECT COUNT(*) FROM messages WHERE account_id = ${sqlString(accountId)}) AS messageCount;`);
    return rows[0] ?? { conversationCount: 0, messageCount: 0 };
  }

  getAgentBinding(accountId: string, peerId: string): AgentBindingRecord | null {
    const rows = this.query<AgentBindingRecord>(`
SELECT
  account_id AS accountId,
  peer_id AS peerId,
  active_provider AS activeProvider,
  active_session_id AS activeSessionId,
  updated_at AS updatedAt
FROM agent_bindings
WHERE account_id = ${sqlString(accountId)}
  AND peer_id = ${sqlString(peerId)}
LIMIT 1;`);
    return rows[0] ?? null;
  }

  upsertAgentBinding(record: AgentBindingRecord): AgentBindingRecord {
    this.exec(`
INSERT INTO agent_bindings(
  account_id, peer_id, active_provider, active_session_id, updated_at
)
VALUES(
  ${sqlString(record.accountId)},
  ${sqlString(record.peerId)},
  ${sqlString(record.activeProvider)},
  ${sqlString(record.activeSessionId)},
  ${sqlNumber(record.updatedAt)}
)
ON CONFLICT(account_id, peer_id) DO UPDATE SET
  active_provider = excluded.active_provider,
  active_session_id = excluded.active_session_id,
  updated_at = excluded.updated_at;`);
    return this.getAgentBinding(record.accountId, record.peerId)!;
  }

  clearAgentBinding(accountId: string, peerId: string): void {
    this.exec(`
DELETE FROM agent_bindings
WHERE account_id = ${sqlString(accountId)}
  AND peer_id = ${sqlString(peerId)};`);
  }

  listAgentBindings(accountId: string): AgentBindingRecord[] {
    return this.query<AgentBindingRecord>(`
SELECT
  account_id AS accountId,
  peer_id AS peerId,
  active_provider AS activeProvider,
  active_session_id AS activeSessionId,
  updated_at AS updatedAt
FROM agent_bindings
WHERE account_id = ${sqlString(accountId)}
ORDER BY updated_at DESC;`);
  }

  getAgentSession(accountId: string, peerId: string, provider: AgentSessionRecord["provider"]): AgentSessionRecord | null {
    const rows = this.query<AgentSessionRecord>(`
SELECT
  account_id AS accountId,
  peer_id AS peerId,
  provider,
  session_id AS sessionId,
  status,
  last_error AS lastError,
  last_used_at AS lastUsedAt,
  created_at AS createdAt,
  updated_at AS updatedAt
FROM agent_sessions
WHERE account_id = ${sqlString(accountId)}
  AND peer_id = ${sqlString(peerId)}
  AND provider = ${sqlString(provider)}
LIMIT 1;`);
    return rows[0] ?? null;
  }

  upsertAgentSession(record: AgentSessionRecord): AgentSessionRecord {
    this.exec(`
INSERT INTO agent_sessions(
  account_id, peer_id, provider, session_id, status,
  last_error, last_used_at, created_at, updated_at
)
VALUES(
  ${sqlString(record.accountId)},
  ${sqlString(record.peerId)},
  ${sqlString(record.provider)},
  ${sqlString(record.sessionId)},
  ${sqlString(record.status)},
  ${sqlString(record.lastError)},
  ${sqlNumber(record.lastUsedAt)},
  ${sqlNumber(record.createdAt)},
  ${sqlNumber(record.updatedAt)}
)
ON CONFLICT(account_id, peer_id, provider) DO UPDATE SET
  session_id = excluded.session_id,
  status = excluded.status,
  last_error = excluded.last_error,
  last_used_at = excluded.last_used_at,
  updated_at = excluded.updated_at;`);
    return this.getAgentSession(record.accountId, record.peerId, record.provider)!;
  }

  listAgentSessions(accountId: string): AgentSessionRecord[] {
    return this.query<AgentSessionRecord>(`
SELECT
  account_id AS accountId,
  peer_id AS peerId,
  provider,
  session_id AS sessionId,
  status,
  last_error AS lastError,
  last_used_at AS lastUsedAt,
  created_at AS createdAt,
  updated_at AS updatedAt
FROM agent_sessions
WHERE account_id = ${sqlString(accountId)}
ORDER BY updated_at DESC;`);
  }

  saveAgentJob(record: AgentJobRecord): AgentJobRecord {
    this.exec(`
INSERT INTO agent_jobs(
  id, account_id, peer_id, provider, session_id,
  prompt, status, response_text, error, created_at, updated_at
)
VALUES(
  ${sqlString(record.id)},
  ${sqlString(record.accountId)},
  ${sqlString(record.peerId)},
  ${sqlString(record.provider)},
  ${sqlString(record.sessionId)},
  ${sqlString(record.prompt)},
  ${sqlString(record.status)},
  ${sqlString(record.responseText)},
  ${sqlString(record.error)},
  ${sqlNumber(record.createdAt)},
  ${sqlNumber(record.updatedAt)}
)
ON CONFLICT(id) DO UPDATE SET
  session_id = excluded.session_id,
  prompt = excluded.prompt,
  status = excluded.status,
  response_text = excluded.response_text,
  error = excluded.error,
  updated_at = excluded.updated_at;`);
    return this.getAgentJob(record.id)!;
  }

  getAgentJob(id: string): AgentJobRecord | null {
    const rows = this.query<AgentJobRecord>(`
SELECT
  id,
  account_id AS accountId,
  peer_id AS peerId,
  provider,
  session_id AS sessionId,
  prompt,
  status,
  response_text AS responseText,
  error,
  created_at AS createdAt,
  updated_at AS updatedAt
FROM agent_jobs
WHERE id = ${sqlString(id)}
LIMIT 1;`);
    return rows[0] ?? null;
  }

  listAgentJobs(accountId: string, peerId: string, limit = 20): AgentJobRecord[] {
    return this.query<AgentJobRecord>(`
SELECT
  id,
  account_id AS accountId,
  peer_id AS peerId,
  provider,
  session_id AS sessionId,
  prompt,
  status,
  response_text AS responseText,
  error,
  created_at AS createdAt,
  updated_at AS updatedAt
FROM agent_jobs
WHERE account_id = ${sqlString(accountId)}
  AND peer_id = ${sqlString(peerId)}
ORDER BY created_at DESC
LIMIT ${sqlNumber(limit)};`);
  }
}
