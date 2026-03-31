import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  MessageItemType,
  SESSION_EXPIRED_ERRCODE,
  WeixinClient,
  type MessageItem,
  type WeixinMessage,
} from "../api/weixin.js";
import {
  detectUploadKind,
  downloadInboundMedia,
  normalizeOutboundVoiceMedia,
  transcodeSilkFileToWav,
  uploadMedia,
  uploadedMediaToItem,
  type UploadedMedia,
  type VoiceItemMetadata,
} from "../media/cdn.js";
import { appendJsonlLog, clearJsonlLog, readRecentJsonlLogs } from "../utils/jsonl-log.js";
import { AgentRouter } from "./agent-router.js";
import { SqliteStore } from "../store/sqlite.js";
import type {
  AccountRecord,
  AppConfig,
  ConversationRecord,
  DebugLogQuery,
  DebugLogEntry,
  DebugLogSource,
  DebugSnapshot,
  LoginSessionRecord,
  MessageRecord,
  RuntimeDiagnostics,
  ServerEvent,
} from "../types.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function toPreview(messageType: MessageRecord["messageType"], text: string, fileName: string): string {
  if (text.trim()) return text.trim().slice(0, 80);
  if (messageType === "image") return "[图片]";
  if (messageType === "video") return "[视频]";
  if (messageType === "voice") return "[语音]";
  if (messageType === "file") return fileName ? `[文件] ${fileName}` : "[文件]";
  return "[消息]";
}

function nowMs(): number {
  return Date.now();
}

function buildDisplayName(userId: string): string {
  const suffix = userId.slice(0, 8) || "unknown";
  return `微信账号 ${suffix}`;
}

function maskSecret(value: string): string {
  if (!value) return "";
  if (value.length <= 12) return `${value.slice(0, 2)}***${value.slice(-2)}`;
  return `${value.slice(0, 6)}***${value.slice(-4)}`;
}

function summarizeLogEvent(source: string, event: string, payload: Record<string, unknown>): string {
  const provider = typeof payload.provider === "string" ? payload.provider : "";
  const peerId = typeof payload.peerId === "string" ? payload.peerId : "";
  const prompt = typeof payload.prompt === "string" ? payload.prompt : "";
  const error = typeof payload.error === "string" ? payload.error : "";
  const status = typeof payload.status === "number" ? String(payload.status) : "";
  const clientId = typeof payload.clientId === "string" ? payload.clientId : "";

  if (source === "agent-router" && event === "job_started") {
    return `${provider || "agent"} 开始处理${peerId ? ` ${peerId}` : ""}${prompt ? `：${prompt.slice(0, 40)}` : ""}`;
  }
  if (source === "agent-router" && event === "job_failed") {
    return `${provider || "agent"} 执行失败${error ? `：${error.slice(0, 80)}` : ""}`;
  }
  if (source === "agent-router" && event === "job_succeeded") {
    return `${provider || "agent"} 执行完成`;
  }
  if (source === "weixin-api" && event.endsWith("_request")) {
    return `${event.replace("_request", "")} 请求已发出${clientId ? `（${clientId}）` : ""}`;
  }
  if (source === "weixin-api" && event.endsWith("_response")) {
    return `${event.replace("_response", "")} 响应 ${status || "-"}`;
  }
  if (source === "weixin-api" && event.endsWith("_error")) {
    return `${event.replace("_error", "")} 请求失败${error ? `：${error.slice(0, 80)}` : ""}`;
  }
  if (source === "weixin-media") {
    return `${event}${peerId ? ` · ${peerId}` : ""}`;
  }
  if (source === "chat-service") {
    return event.replace(/_/g, " ");
  }
  return event;
}

function messageTypeFromItem(item?: MessageItem): MessageRecord["messageType"] {
  if (!item?.type) return "unknown";
  if (item.type === MessageItemType.TEXT) return "text";
  if (item.type === MessageItemType.IMAGE) return "image";
  if (item.type === MessageItemType.VOICE) return "voice";
  if (item.type === MessageItemType.FILE) return "file";
  if (item.type === MessageItemType.VIDEO) return "video";
  return "unknown";
}

function extractText(itemList?: MessageItem[]): string {
  if (!itemList?.length) return "";
  for (const item of itemList) {
    if (item.type === MessageItemType.TEXT && item.text_item?.text) {
      return item.text_item.text;
    }
    if (item.type === MessageItemType.VOICE && item.voice_item?.text) {
      return item.voice_item.text;
    }
  }
  return "";
}

function firstMediaItem(itemList?: MessageItem[]): MessageItem | undefined {
  if (!itemList?.length) return undefined;
  return itemList.find((item) => item.type === MessageItemType.IMAGE && item.image_item?.media?.encrypt_query_param)
    ?? itemList.find((item) => item.type === MessageItemType.VIDEO && item.video_item?.media?.encrypt_query_param)
    ?? itemList.find((item) => item.type === MessageItemType.FILE && item.file_item?.media?.encrypt_query_param)
    ?? itemList.find((item) => item.type === MessageItemType.VOICE && item.voice_item?.media?.encrypt_query_param)
    ?? itemList.find((item) => item.ref_msg?.message_item)?.ref_msg?.message_item;
}

function inferInboundFileName(messageId: string, item: MessageItem): string {
  if (item.type === MessageItemType.IMAGE) return `${messageId}.jpg`;
  if (item.type === MessageItemType.VIDEO) return `${messageId}.mp4`;
  if (item.type === MessageItemType.FILE) return sanitizeFileName(item.file_item?.file_name || `${messageId}.bin`);
  if (item.type === MessageItemType.VOICE) return `${messageId}.silk`;
  return `${messageId}.bin`;
}

function inferMimeType(item: MessageItem): string {
  if (item.type === MessageItemType.IMAGE) return "image/jpeg";
  if (item.type === MessageItemType.VIDEO) return "video/mp4";
  if (item.type === MessageItemType.VOICE) return "audio/silk";
  return "application/octet-stream";
}

interface VoiceMessageTemplate {
  item: MessageItem;
  metadata: VoiceItemMetadata;
  text: string;
}

const FORCE_ECHO_LATEST_INBOUND_VOICE = false;
const DEBUG_LOG_SOURCES = [
  { source: "chat-service", fileName: "chat-service.jsonl" },
  { source: "agent-router", fileName: "agent-router.jsonl" },
  { source: "weixin-api", fileName: "weixin-api.jsonl" },
  { source: "weixin-media", fileName: "weixin-media.jsonl" },
] as const;

export class ChatService {
  private readonly loginSessions = new Map<string, LoginSessionRecord>();
  private readonly monitorAbort = new Map<string, AbortController>();
  private readonly agentRouter: AgentRouter;

  constructor(
    private readonly store: SqliteStore,
    private readonly workspaceDir: string,
    private readonly emit: (event: ServerEvent) => void,
  ) {
    this.agentRouter = new AgentRouter(this.store, this.workspaceDir, async (params) => {
      await this.sendText(params);
    }, async (params) => {
      await this.sendMedia(params);
    });
  }

  async init(): Promise<void> {
    this.store.init();
    for (const account of this.store.listAccounts()) {
      if (account.token) {
        this.startMonitor(account.accountId);
      }
    }
  }

  getBootstrap() {
    return this.store.getBootstrap();
  }

  async getRuntimeDiagnostics(configOverride?: AppConfig): Promise<RuntimeDiagnostics> {
    return this.agentRouter.getRuntimeDiagnostics(configOverride);
  }

  async validateConfig(config: AppConfig): Promise<{ config: AppConfig; diagnostics: RuntimeDiagnostics }> {
    return {
      config,
      diagnostics: await this.getRuntimeDiagnostics(config),
    };
  }

  getConfig(): AppConfig {
    return this.store.getConfig();
  }

  saveConfig(config: AppConfig): AppConfig {
    this.store.saveConfig(config);
    this.emit({ type: "status", payload: { message: "config_saved" } });
    return this.store.getConfig();
  }

  listAccounts(): AccountRecord[] {
    return this.store.listAccounts();
  }

  selectAccount(accountId: string): AccountRecord | null {
    this.store.selectAccount(accountId);
    this.emit({ type: "accounts", accountId });
    return this.store.getAccount(accountId);
  }

  renameAccount(accountId: string, displayName: string): AccountRecord | null {
    const nextName = displayName.trim();
    if (!nextName) {
      throw new Error("账号名称不能为空");
    }
    const account = this.store.updateAccountDisplayName(accountId, nextName);
    this.emit({ type: "accounts", accountId });
    return account;
  }

  clearAccountHistory(accountId: string): AccountRecord | null {
    const account = this.mustAccount(accountId);
    this.store.clearAccountHistory(accountId);
    this.removeAccountDataDirs(accountId);
    this.logRuntime("account_history_cleared", {
      accountId,
      displayName: account.displayName,
    });
    this.emit({ type: "accounts", accountId });
    this.emit({ type: "conversations", accountId });
    this.emit({ type: "messages", accountId });
    this.emit({ type: "status", accountId, payload: { message: "account_history_cleared" } });
    return this.store.getAccount(accountId);
  }

  deleteAccount(accountId: string): void {
    const account = this.mustAccount(accountId);
    this.stopMonitor(accountId);
    this.store.deleteAccount(accountId);
    this.removeAccountDataDirs(accountId);
    this.logRuntime("account_deleted", {
      accountId,
      displayName: account.displayName,
    });
    this.emit({ type: "accounts", accountId });
    this.emit({ type: "conversations", accountId });
    this.emit({ type: "messages", accountId });
    this.emit({ type: "status", accountId, payload: { message: "account_deleted" } });
  }

  listConversations(accountId: string): ConversationRecord[] {
    return this.store.listConversations(accountId);
  }

  openConversation(accountId: string, peerId: string): ConversationRecord {
    const conversation = this.store.openConversation(accountId, peerId);
    this.emit({ type: "conversations", accountId, peerId });
    return conversation;
  }

  listMessages(accountId: string, peerId: string, beforeCreatedAt = 0, limit = 60): MessageRecord[] {
    return this.store.listMessages(accountId, peerId, beforeCreatedAt, limit);
  }

  countMessages(accountId: string, peerId: string): number {
    return this.store.countMessages(accountId, peerId);
  }

  searchMessages(accountId: string, queryText: string, peerId = ""): MessageRecord[] {
    return this.store.searchMessages(accountId, queryText, peerId);
  }

  getAccountStatus(accountId: string) {
    return this.store.getSyncState(accountId);
  }

  exportConversation(accountId: string, peerId: string) {
    const account = this.mustAccount(accountId);
    const conversation = this.store.getConversation(accountId, peerId);
    return {
      exportedAt: new Date().toISOString(),
      account: {
        accountId: account.accountId,
        displayName: account.displayName,
        userId: account.userId,
      },
      conversation,
      messages: this.store.listMessages(accountId, peerId),
    };
  }

  getDebugSnapshot(accountId: string, query?: DebugLogQuery): DebugSnapshot {
    const account = accountId ? this.store.getAccount(accountId) : null;
    return {
      config: this.store.getConfig(),
      account: account ? { ...account, token: maskSecret(account.token) } : null,
      syncState: account ? this.store.getSyncState(accountId) : null,
      stats: account ? this.store.getAccountStats(accountId) : { conversationCount: 0, messageCount: 0 },
      agentBindings: account ? this.store.listAgentBindings(accountId) : [],
      agentSessions: account ? this.store.listAgentSessions(accountId) : [],
      recentLogs: this.collectDebugLogs(accountId, query),
    };
  }

  clearDebugLogs(source: DebugLogSource = "all"): void {
    const targets = source === "all"
      ? DEBUG_LOG_SOURCES
      : DEBUG_LOG_SOURCES.filter((entry) => entry.source === source);
    for (const entry of targets) {
      clearJsonlLog(entry.fileName);
    }
  }

  markConversationRead(accountId: string, peerId: string): void {
    this.store.markConversationRead(accountId, peerId);
    this.emit({ type: "conversations", accountId, peerId });
  }

  getLoginSession(sessionKey: string): LoginSessionRecord | null {
    return this.loginSessions.get(sessionKey) ?? null;
  }

  async startLogin(): Promise<LoginSessionRecord> {
    const config = this.store.getConfig();
    const client = new WeixinClient({ baseUrl: config.baseUrl });
    const qr = await client.fetchQrCode(config.botType);
    const session: LoginSessionRecord = {
      sessionKey: crypto.randomUUID(),
      qrcode: qr.qrcode,
      qrcodeUrl: qr.qrcode_img_content,
      status: "wait",
      startedAt: nowMs(),
      lastCheckedAt: 0,
      error: "",
      baseUrl: config.baseUrl,
      cdnBaseUrl: config.cdnBaseUrl,
      botType: config.botType,
    };
    this.loginSessions.set(session.sessionKey, session);
    return session;
  }

  async pollLogin(sessionKey: string): Promise<LoginSessionRecord> {
    const session = this.loginSessions.get(sessionKey);
    if (!session) {
      throw new Error("登录会话不存在，请重新生成二维码");
    }
    const client = new WeixinClient({ baseUrl: session.baseUrl });
    try {
      const status = await client.pollQrStatus(session.qrcode);
      this.logRuntime("login_poll", {
        sessionKey,
        status: status.status,
        userId: status.ilink_user_id ?? "",
        accountId: status.ilink_bot_id ?? "",
      });
      session.lastCheckedAt = nowMs();
      session.status = status.status;
      if (status.status === "confirmed" && status.bot_token && status.ilink_bot_id && status.ilink_user_id) {
        const isFirstAccount = this.store.listAccounts().length === 0;
        this.store.upsertAccount({
          accountId: status.ilink_bot_id,
          displayName: buildDisplayName(status.ilink_user_id),
          userId: status.ilink_user_id,
          token: status.bot_token,
          baseUrl: status.baseurl || session.baseUrl,
          cdnBaseUrl: session.cdnBaseUrl,
          lastLoginAt: nowMs(),
          isSelected: isFirstAccount,
        });
        this.startMonitor(status.ilink_bot_id);
        this.emit({ type: "accounts", accountId: status.ilink_bot_id });
      }
      this.loginSessions.set(sessionKey, session);
      return session;
    } catch (error) {
      this.logRuntime("login_poll_error", {
        sessionKey,
        error,
      });
      session.status = "error";
      session.error = error instanceof Error ? error.message : String(error);
      session.lastCheckedAt = nowMs();
      this.loginSessions.set(sessionKey, session);
      return session;
    }
  }

  async sendText(params: { accountId: string; peerId: string; text: string }): Promise<MessageRecord> {
    const account = this.mustAccount(params.accountId);
    this.logRuntime("send_text_started", {
      accountId: account.accountId,
      peerId: params.peerId,
      textPreview: params.text.slice(0, 120),
    });
    if (FORCE_ECHO_LATEST_INBOUND_VOICE) {
      const echoed = await this.sendLatestInboundVoice(account, params.peerId);
      if (echoed) return echoed;
    }
    const client = new WeixinClient({ baseUrl: account.baseUrl, token: account.token });
    const conversation = this.store.getConversation(account.accountId, params.peerId);
    const messageId = crypto.randomUUID();
    const createdAt = nowMs();
    const localMessage: MessageRecord = {
      id: messageId,
      accountId: account.accountId,
      peerId: params.peerId,
      direction: "outbound",
      messageType: "text",
      text: params.text,
      fileName: "",
      mimeType: "text/plain",
      mediaPath: "",
      mediaSize: Buffer.byteLength(params.text, "utf-8"),
      status: "pending",
      remoteMessageId: "",
      rawJson: "",
      createdAt,
      updatedAt: createdAt,
    };
    this.store.saveMessage(localMessage);
    this.touchConversation(account.accountId, params.peerId, {
      preview: toPreview("text", params.text, ""),
      contextToken: conversation?.contextToken ?? "",
      messageType: "text",
      incrementUnread: false,
      timestamp: createdAt,
    });
    this.emit({ type: "messages", accountId: account.accountId, peerId: params.peerId });

    let typingTicket = "";
    try {
      typingTicket = await this.prepareConversationForSend(client, params.peerId, conversation?.contextToken ?? "");
      await this.sendMessageWithContextFallback(client, {
        to_user_id: params.peerId,
        client_id: messageId,
        message_type: 2,
        message_state: 2,
        item_list: [{ type: 1, text_item: { text: params.text } }],
        context_token: conversation?.contextToken || undefined,
      });
      this.store.updateMessageStatus(messageId, "sent", messageId);
      this.logRuntime("send_text_succeeded", {
        accountId: account.accountId,
        peerId: params.peerId,
        messageId,
      });
    } catch (error) {
      this.store.updateMessageStatus(messageId, "failed");
      this.logRuntime("send_text_failed", {
        accountId: account.accountId,
        peerId: params.peerId,
        messageId,
        error,
      });
      throw error;
    } finally {
      await this.finishConversationSend(client, params.peerId, typingTicket);
      this.emit({ type: "messages", accountId: account.accountId, peerId: params.peerId });
      this.emit({ type: "conversations", accountId: account.accountId, peerId: params.peerId });
    }
    return this.store.getMessage(messageId)!;
  }

  async sendMedia(params: {
    accountId: string;
    peerId: string;
    fileName: string;
    mimeType: string;
    bytesBase64?: string;
    bytes?: Buffer;
    caption: string;
    sendAsVoice?: boolean;
  }): Promise<MessageRecord> {
    const account = this.mustAccount(params.accountId);
    this.logRuntime("send_media_started", {
      accountId: account.accountId,
      peerId: params.peerId,
      fileName: params.fileName,
      mimeType: params.mimeType,
      sendAsVoice: Boolean(params.sendAsVoice),
    });
    if (FORCE_ECHO_LATEST_INBOUND_VOICE) {
      const echoed = await this.sendLatestInboundVoice(account, params.peerId);
      if (echoed) return echoed;
    }
    const client = new WeixinClient({ baseUrl: account.baseUrl, token: account.token });
    const conversation = this.store.getConversation(account.accountId, params.peerId);
    const sourceBytes = params.bytes ?? Buffer.from(params.bytesBase64 ?? "", "base64");
    if (!sourceBytes.length) {
      throw new Error("上传文件内容为空");
    }
    const detectedKind = detectUploadKind(params.fileName, params.mimeType);
    const shouldSendAsVoice = params.sendAsVoice === true && detectedKind === "voice";
    const matchedVoiceTemplate = shouldSendAsVoice
      ? this.findMatchingVoiceTemplate(account.accountId, params.peerId, sourceBytes)
      : null;
    const recentVoiceTemplate = shouldSendAsVoice && !matchedVoiceTemplate
      ? this.findRecentInboundVoiceTemplate(account.accountId, params.peerId)
      : null;
    const activeVoiceTemplate = matchedVoiceTemplate ?? recentVoiceTemplate;
    const normalizedVoice = shouldSendAsVoice
      ? await normalizeOutboundVoiceMedia({
        fileName: params.fileName,
        mimeType: params.mimeType,
        bytes: sourceBytes,
      })
      : null;
    const bytes = normalizedVoice?.bytes ?? sourceBytes;
    const fileName = normalizedVoice?.fileName ?? params.fileName;
    const mimeType = normalizedVoice?.mimeType ?? params.mimeType;
    const uploaded = await uploadMedia({
      client,
      cdnBaseUrl: account.cdnBaseUrl,
      peerId: params.peerId,
      fileName,
      mimeType,
      bytes,
      kindOverride: detectedKind === "voice"
        ? shouldSendAsVoice
          ? "voice"
          : "file"
        : undefined,
    });

    const messageId = crypto.randomUUID();
    const createdAt = nowMs();
    const outboxDir = path.join(this.workspaceDir, "data", "outbox", account.accountId, params.peerId);
    fs.mkdirSync(outboxDir, { recursive: true });
    const savedPath = path.join(outboxDir, `${messageId}-${sanitizeFileName(fileName)}`);
    fs.writeFileSync(savedPath, bytes);

    const localMessage: MessageRecord = {
      id: messageId,
      accountId: account.accountId,
      peerId: params.peerId,
      direction: "outbound",
      messageType: uploaded.kind,
      text: params.caption,
      fileName,
      mimeType,
      mediaPath: savedPath,
      mediaSize: bytes.length,
      status: "pending",
      remoteMessageId: "",
      rawJson: JSON.stringify({
        ...uploaded,
        voiceMetadata: matchedVoiceTemplate?.metadata ?? normalizedVoice?.metadata,
      }),
      createdAt,
      updatedAt: createdAt,
    };
    this.store.saveMessage(localMessage);
    this.touchConversation(account.accountId, params.peerId, {
      preview: toPreview(uploaded.kind, params.caption, fileName),
      contextToken: conversation?.contextToken ?? "",
      messageType: uploaded.kind,
      incrementUnread: false,
      timestamp: createdAt,
    });
    this.emit({ type: "messages", accountId: account.accountId, peerId: params.peerId });

    let typingTicket = "";
    try {
      typingTicket = await this.prepareConversationForSend(client, params.peerId, conversation?.contextToken ?? "");
      if (params.caption.trim() && !shouldSendAsVoice) {
        await this.sendMessageWithContextFallback(client, {
          to_user_id: params.peerId,
          client_id: `${messageId}-caption`,
          message_type: 2,
          message_state: 2,
          item_list: [{ type: 1, text_item: { text: params.caption } }],
          context_token: conversation?.contextToken || undefined,
        });
      }
      await this.sendMessageWithContextFallback(client, {
        to_user_id: params.peerId,
        client_id: messageId,
        message_type: 2,
        message_state: 2,
        item_list: [shouldSendAsVoice
          ? this.buildVoiceMessageItem(uploaded, {
            template: activeVoiceTemplate,
            voiceText: params.caption.trim(),
            voiceMetadata: normalizedVoice?.metadata ?? activeVoiceTemplate?.metadata,
          })
          : uploadedMediaToItem(uploaded, {
            voiceText: "",
            voiceMetadata: undefined,
          })],
        context_token: conversation?.contextToken || undefined,
      });
      this.store.updateMessageStatus(messageId, "sent", messageId);
      this.logRuntime("send_media_succeeded", {
        accountId: account.accountId,
        peerId: params.peerId,
        messageId,
        fileName,
        kind: uploaded.kind,
        voicePlaytimeMs: normalizedVoice?.metadata?.playtime ?? activeVoiceTemplate?.metadata?.playtime ?? 0,
        voiceTemplateSource: matchedVoiceTemplate
          ? "matched"
          : recentVoiceTemplate
            ? "recent-inbound"
            : shouldSendAsVoice
              ? "generated"
              : "",
      });
    } catch (error) {
      this.store.updateMessageStatus(messageId, "failed");
      this.logRuntime("send_media_failed", {
        accountId: account.accountId,
        peerId: params.peerId,
        messageId,
        fileName,
        voicePlaytimeMs: normalizedVoice?.metadata?.playtime ?? activeVoiceTemplate?.metadata?.playtime ?? 0,
        voiceTemplateSource: matchedVoiceTemplate
          ? "matched"
          : recentVoiceTemplate
            ? "recent-inbound"
            : shouldSendAsVoice
              ? "generated"
              : "",
        error,
      });
      throw error;
    } finally {
      await this.finishConversationSend(client, params.peerId, typingTicket);
      this.emit({ type: "messages", accountId: account.accountId, peerId: params.peerId });
      this.emit({ type: "conversations", accountId: account.accountId, peerId: params.peerId });
    }
    return this.store.getMessage(messageId)!;
  }

  async getMediaFile(messageId: string): Promise<{ path: string; mimeType: string; fileName: string } | null> {
    const message = this.store.getMessage(messageId);
    if (!message?.mediaPath || !fs.existsSync(message.mediaPath)) {
      return null;
    }

    if (message.messageType === "voice") {
      if (message.mimeType === "audio/wav" && fs.existsSync(message.mediaPath)) {
        return {
          path: message.mediaPath,
          mimeType: "audio/wav",
          fileName: message.fileName || path.basename(message.mediaPath),
        };
      }

      const wavPath = await transcodeSilkFileToWav(message.mediaPath);
      if (wavPath && fs.existsSync(wavPath)) {
        return {
          path: wavPath,
          mimeType: "audio/wav",
          fileName: path.basename(wavPath),
        };
      }
    }

    return {
      path: message.mediaPath,
      mimeType: message.mimeType || "application/octet-stream",
      fileName: message.fileName || path.basename(message.mediaPath),
    };
  }

  private findMatchingVoiceTemplate(accountId: string, peerId: string, bytes: Buffer): VoiceMessageTemplate | null {
    const targetHash = crypto.createHash("md5").update(bytes).digest("hex");
    for (const message of this.store.listMessages(accountId, peerId)) {
      if (message.messageType !== "voice") continue;
      for (const candidatePath of this.candidateVoicePaths(message.mediaPath)) {
        if (!candidatePath || !fs.existsSync(candidatePath)) continue;
        const candidateBytes = fs.readFileSync(candidatePath);
        const candidateHash = crypto.createHash("md5").update(candidateBytes).digest("hex");
        if (candidateHash !== targetHash) continue;
        const template = this.extractVoiceTemplate(message.rawJson);
        if (template) {
          return template;
        }
      }
    }
    return null;
  }

  private findRecentInboundVoiceTemplate(accountId: string, peerId: string): VoiceMessageTemplate | null {
    const messages = [...this.store.listMessages(accountId, peerId)].reverse();
    for (const message of messages) {
      if (message.direction !== "inbound" || message.messageType !== "voice") {
        continue;
      }
      const template = this.extractVoiceTemplate(message.rawJson);
      if (template) {
        return template;
      }
    }
    return null;
  }

  private candidateVoicePaths(mediaPath: string): string[] {
    if (!mediaPath) return [];
    const candidates = new Set<string>([mediaPath]);
    if (mediaPath.endsWith(".wav")) {
      candidates.add(mediaPath.replace(/\.wav$/i, ".silk"));
    } else if (mediaPath.endsWith(".silk")) {
      candidates.add(mediaPath.replace(/\.silk$/i, ".wav"));
    }
    return Array.from(candidates);
  }

  private extractVoiceTemplate(rawJson: string): VoiceMessageTemplate | null {
    if (!rawJson.trim()) return null;
    try {
      const parsed = JSON.parse(rawJson) as {
        item_list?: Array<{
          type?: number;
          create_time_ms?: number;
          update_time_ms?: number;
          is_completed?: boolean;
          voice_item?: {
            media?: {
              encrypt_query_param?: string;
              aes_key?: string;
              encrypt_type?: number;
            };
            text?: string;
            encode_type?: number;
            bits_per_sample?: number;
            sample_rate?: number;
            playtime?: number;
          };
        }>;
      };
      const voice = parsed.item_list?.[0]?.voice_item;
      const item = parsed.item_list?.[0];
      if (!voice || !item) return null;
      return {
        item: {
          type: item.type ?? MessageItemType.VOICE,
          create_time_ms: item.create_time_ms,
          update_time_ms: item.update_time_ms,
          is_completed: item.is_completed,
          voice_item: {
            media: voice.media,
            text: voice.text ?? "",
            encode_type: voice.encode_type,
            bits_per_sample: voice.bits_per_sample,
            sample_rate: voice.sample_rate,
            playtime: voice.playtime,
          },
        },
        metadata: {
          encodeType: voice.encode_type,
          bitsPerSample: voice.bits_per_sample,
          sampleRate: voice.sample_rate,
          playtime: voice.playtime,
        },
        text: voice.text ?? "",
      };
    } catch {
      return null;
    }
  }

  private buildVoiceMessageItem(
    uploaded: UploadedMedia,
    options: { template?: VoiceMessageTemplate | null; voiceText: string; voiceMetadata?: VoiceItemMetadata },
  ): MessageItem {
    const generated = uploadedMediaToItem(uploaded, {
      voiceText: options.voiceText,
      voiceMetadata: options.voiceMetadata,
    });
    const generatedVoice = generated.voice_item;
    if (!generatedVoice) {
      return generated;
    }
    const templateItem = options.template?.item;
    const templateVoice = templateItem?.voice_item;
    const now = nowMs();
    return {
      type: templateItem?.type ?? MessageItemType.VOICE,
      create_time_ms: now,
      update_time_ms: now,
      is_completed: templateItem?.is_completed ?? true,
      voice_item: {
        ...templateVoice,
        media: generatedVoice.media,
        text: options.voiceText,
        encode_type: options.voiceMetadata?.encodeType ?? templateVoice?.encode_type ?? generatedVoice.encode_type,
        bits_per_sample: options.voiceMetadata?.bitsPerSample ?? templateVoice?.bits_per_sample ?? generatedVoice.bits_per_sample,
        sample_rate: options.voiceMetadata?.sampleRate ?? templateVoice?.sample_rate ?? generatedVoice.sample_rate,
        playtime: options.voiceMetadata?.playtime ?? templateVoice?.playtime ?? generatedVoice.playtime,
      },
    };
  }

  private mustAccount(accountId: string): AccountRecord {
    const account = this.store.getAccount(accountId);
    if (!account) {
      throw new Error("账号不存在，请先扫码登录");
    }
    return account;
  }

  private startMonitor(accountId: string): void {
    if (this.monitorAbort.has(accountId)) return;
    const account = this.store.getAccount(accountId);
    if (!account) return;
    this.logRuntime("monitor_started", { accountId });
    const controller = new AbortController();
    this.monitorAbort.set(accountId, controller);
    void this.monitorLoop(account, controller.signal).finally(() => {
      this.monitorAbort.delete(accountId);
    });
  }

  private stopMonitor(accountId: string): void {
    const controller = this.monitorAbort.get(accountId);
    if (!controller) return;
    controller.abort();
    this.monitorAbort.delete(accountId);
    this.logRuntime("monitor_stopped", { accountId });
  }

  private removeAccountDataDirs(accountId: string): void {
    const targets = [
      path.join(this.workspaceDir, "data", "inbox", accountId),
      path.join(this.workspaceDir, "data", "outbox", accountId),
    ];
    for (const target of targets) {
      fs.rmSync(target, { recursive: true, force: true });
    }
  }

  private async monitorLoop(account: AccountRecord, signal: AbortSignal): Promise<void> {
    const client = new WeixinClient({ baseUrl: account.baseUrl, token: account.token });
    while (!signal.aborted) {
      const sync = this.store.getSyncState(account.accountId);
      if (sync.pauseUntilMs > nowMs()) {
        await sleep(3_000);
        continue;
      }
      try {
        const response = await client.getUpdates(sync.getUpdatesBuf);
        this.logRuntime("getupdates_result", {
          accountId: account.accountId,
          ret: response.ret ?? 0,
          messageCount: response.msgs?.length ?? 0,
        });
        if ((response.errcode ?? 0) === SESSION_EXPIRED_ERRCODE) {
          this.store.saveSyncState({
            accountId: account.accountId,
            getUpdatesBuf: sync.getUpdatesBuf,
            pauseUntilMs: nowMs() + 60 * 60 * 1000,
            lastError: response.errmsg ?? "session expired",
            lastEventAt: nowMs(),
          });
          this.emit({
            type: "status",
            accountId: account.accountId,
            payload: { error: response.errmsg ?? "session expired" },
          });
          await sleep(5_000);
          continue;
        }
        if ((response.ret ?? 0) !== 0) {
          this.store.saveSyncState({
            accountId: account.accountId,
            getUpdatesBuf: sync.getUpdatesBuf,
            pauseUntilMs: 0,
            lastError: response.errmsg ?? `ret=${response.ret ?? "unknown"}`,
            lastEventAt: nowMs(),
          });
          await sleep(2_000);
          continue;
        }
        const nextBuf = response.get_updates_buf ?? sync.getUpdatesBuf;
        this.store.saveSyncState({
          accountId: account.accountId,
          getUpdatesBuf: nextBuf,
          pauseUntilMs: 0,
          lastError: "",
          lastEventAt: nowMs(),
        });
        for (const message of response.msgs ?? []) {
          await this.processInboundMessage(account, message);
        }
      } catch (error) {
        this.logRuntime("getupdates_error", {
          accountId: account.accountId,
          error,
        });
        this.store.saveSyncState({
          accountId: account.accountId,
          getUpdatesBuf: sync.getUpdatesBuf,
          pauseUntilMs: 0,
          lastError: error instanceof Error ? error.message : String(error),
          lastEventAt: nowMs(),
        });
        this.emit({
          type: "status",
          accountId: account.accountId,
          payload: { error: error instanceof Error ? error.message : String(error) },
        });
        await sleep(2_000);
      }
    }
  }

  private async processInboundMessage(account: AccountRecord, message: WeixinMessage): Promise<void> {
    const peerId = message.from_user_id || message.to_user_id || "unknown";
    const createdAt = message.create_time_ms ?? nowMs();
    const text = extractText(message.item_list);
    const mediaItem = firstMediaItem(message.item_list);
    const localId = crypto.randomUUID();

    let mediaPath = "";
    let fileName = "";
    let mimeType = "";
    let mediaSize = 0;
    let messageType: MessageRecord["messageType"] = text ? "text" : "unknown";

    if (mediaItem) {
      messageType = messageTypeFromItem(mediaItem);
      fileName = inferInboundFileName(localId, mediaItem);
      mimeType = inferMimeType(mediaItem);
      const inboxDir = path.join(this.workspaceDir, "data", "inbox", account.accountId, peerId);
      const media =
        mediaItem.image_item?.media
        ?? mediaItem.video_item?.media
        ?? mediaItem.file_item?.media
        ?? mediaItem.voice_item?.media;
      const fallbackHexKey = mediaItem.image_item?.aeskey;
      if (media) {
        mediaPath = await downloadInboundMedia({
          cdnBaseUrl: account.cdnBaseUrl,
          media,
          fallbackHexKey,
          fileName,
          destDir: inboxDir,
        }).catch(() => "");
        if (mediaPath && fs.existsSync(mediaPath)) {
          mediaSize = fs.statSync(mediaPath).size;
        }
        if (messageType === "voice" && mediaPath) {
          const wavPath = await transcodeSilkFileToWav(mediaPath);
          if (wavPath && fs.existsSync(wavPath)) {
            mediaPath = wavPath;
            fileName = path.basename(wavPath);
            mimeType = "audio/wav";
            mediaSize = fs.statSync(wavPath).size;
          }
        }
      }
    }

    const record: MessageRecord = {
      id: localId,
      accountId: account.accountId,
      peerId,
      direction: "inbound",
      messageType,
      text,
      fileName,
      mimeType,
      mediaPath,
      mediaSize,
      status: "received",
      remoteMessageId: message.message_id ? String(message.message_id) : "",
      rawJson: JSON.stringify(message),
      createdAt,
      updatedAt: nowMs(),
    };
    this.logRuntime("inbound_message_received", {
      accountId: account.accountId,
      peerId,
      messageType,
      remoteMessageId: record.remoteMessageId,
      hasMedia: Boolean(mediaPath),
      textPreview: text.slice(0, 120),
    });
    this.store.saveMessage(record);
    this.touchConversation(account.accountId, peerId, {
      preview: toPreview(messageType, text, fileName),
      contextToken: message.context_token ?? this.store.getConversation(account.accountId, peerId)?.contextToken ?? "",
      messageType,
      incrementUnread: true,
      timestamp: createdAt,
    });
    this.emit({ type: "messages", accountId: account.accountId, peerId });
    this.emit({ type: "conversations", accountId: account.accountId, peerId });
    if (FORCE_ECHO_LATEST_INBOUND_VOICE && await this.sendLatestInboundVoice(account, peerId)) {
      return;
    }
    const inboundAttachments = mediaPath
      ? [{
        url: mediaPath,
        mimeType: mimeType || "application/octet-stream",
        fileName: fileName || path.basename(mediaPath),
        sendAsVoice: messageType === "voice",
      }]
      : [];
    if (text.trim() || inboundAttachments.length) {
      this.agentRouter.handleInboundMessage({
        accountId: account.accountId,
        peerId,
        text,
        media: inboundAttachments,
      });
    }
  }

  private async sendLatestInboundVoice(account: AccountRecord, peerId: string): Promise<MessageRecord | null> {
    const source = [...this.store.listMessages(account.accountId, peerId)]
      .reverse()
      .find((message) => message.direction === "inbound" && message.messageType === "voice");
    if (!source) return null;
    const voiceItem = this.extractVoiceMessageItem(source.rawJson);
    if (!voiceItem?.voice_item?.media?.encrypt_query_param || !voiceItem.voice_item.media?.aes_key) {
      return null;
    }

    const conversation = this.store.getConversation(account.accountId, peerId);
    const messageId = crypto.randomUUID();
    const createdAt = nowMs();
    const localMessage: MessageRecord = {
      id: messageId,
      accountId: account.accountId,
      peerId,
      direction: "outbound",
      messageType: "voice",
      text: voiceItem.voice_item.text ?? "",
      fileName: source.fileName,
      mimeType: source.mimeType,
      mediaPath: source.mediaPath,
      mediaSize: source.mediaSize,
      status: "pending",
      remoteMessageId: "",
      rawJson: JSON.stringify({
        replayedFrom: source.id,
        item: voiceItem,
      }),
      createdAt,
      updatedAt: createdAt,
    };
    this.store.saveMessage(localMessage);
    this.touchConversation(account.accountId, peerId, {
      preview: toPreview("voice", localMessage.text, localMessage.fileName),
      contextToken: conversation?.contextToken ?? "",
      messageType: "voice",
      incrementUnread: false,
      timestamp: createdAt,
    });
    this.emit({ type: "messages", accountId: account.accountId, peerId });

    const client = new WeixinClient({ baseUrl: account.baseUrl, token: account.token });
    try {
      await this.sendMessageWithContextFallback(client, {
        to_user_id: peerId,
        client_id: messageId,
        message_type: 2,
        message_state: 2,
        item_list: [voiceItem],
        context_token: conversation?.contextToken || undefined,
      });
      this.store.updateMessageStatus(messageId, "sent", messageId);
      return this.store.getMessage(messageId)!;
    } catch (error) {
      this.store.updateMessageStatus(messageId, "failed");
      throw error;
    } finally {
      this.emit({ type: "messages", accountId: account.accountId, peerId });
      this.emit({ type: "conversations", accountId: account.accountId, peerId });
    }
  }

  private extractVoiceMessageItem(rawJson: string): MessageItem | null {
    if (!rawJson.trim()) return null;
    try {
      const parsed = JSON.parse(rawJson) as {
        item_list?: Array<{
          voice_item?: {
            media?: {
              encrypt_query_param?: string;
              aes_key?: string;
            };
            text?: string;
            encode_type?: number;
            bits_per_sample?: number;
            sample_rate?: number;
            playtime?: number;
          };
        }>;
      };
      const voice = parsed.item_list?.[0]?.voice_item;
      if (!voice?.media?.encrypt_query_param || !voice.media.aes_key) {
        return null;
      }
      return {
        type: MessageItemType.VOICE,
        voice_item: {
          media: {
            encrypt_query_param: voice.media.encrypt_query_param,
            aes_key: voice.media.aes_key,
          },
          text: voice.text ?? "",
          encode_type: voice.encode_type,
          bits_per_sample: voice.bits_per_sample,
          sample_rate: voice.sample_rate,
          playtime: voice.playtime,
        },
      };
    } catch {
      return null;
    }
  }

  private async sendMessageWithContextFallback(client: WeixinClient, message: WeixinMessage): Promise<void> {
    try {
      await client.sendMessage(message);
      return;
    } catch (error) {
      const errorText = error instanceof Error ? error.message : String(error);
      if (!/ret=-2|context/i.test(errorText)) {
        throw error;
      }
      const retryMessage = { ...message };
      retryMessage.client_id = `${message.client_id ?? crypto.randomUUID()}-retry-${crypto.randomUUID().slice(0, 8)}`;
      const peerId = message.to_user_id ?? "";
      const retryTypingTicket = await this.prepareConversationForSend(client, peerId, "");
      if (message.context_token) {
        delete retryMessage.context_token;
      }
      this.logRuntime("send_message_retry_without_context", {
        peerId,
        clientId: message.client_id ?? "",
        retryClientId: retryMessage.client_id,
        retryMode: message.context_token ? "drop-context" : "preflight-retry",
        reason: errorText,
      });
      try {
        await client.sendMessage(retryMessage);
      } finally {
        await this.finishConversationSend(client, peerId, retryTypingTicket);
      }
    }
  }

  private async prepareConversationForSend(
    client: WeixinClient,
    peerId: string,
    contextToken = "",
  ): Promise<string> {
    const attempts = contextToken ? [contextToken, ""] : [""];
    let lastError: unknown = null;
    for (const candidate of attempts) {
      try {
        const config = await client.getConfig(peerId, candidate);
        const typingTicket = config.typing_ticket ?? "";
        this.logRuntime("send_prepare_ready", {
          peerId,
          tokenStrategy: candidate ? "context" : "empty",
          hasTypingTicket: Boolean(typingTicket),
        });
        if (typingTicket) {
          await client.sendTyping(peerId, typingTicket, 1).catch(() => undefined);
        }
        return typingTicket;
      } catch (error) {
        lastError = error;
        this.logRuntime("send_prepare_failed", {
          peerId,
          tokenStrategy: candidate ? "context" : "empty",
          error,
        });
      }
    }
    if (lastError) {
      return "";
    }
    return "";
  }

  private async finishConversationSend(client: WeixinClient, peerId: string, typingTicket: string): Promise<void> {
    if (!typingTicket || !peerId) {
      return;
    }
    await client.sendTyping(peerId, typingTicket, 2).catch(() => undefined);
  }

  private touchConversation(
    accountId: string,
    peerId: string,
    params: {
      preview: string;
      contextToken: string;
      messageType: MessageRecord["messageType"];
      incrementUnread: boolean;
      timestamp: number;
    },
  ): void {
    const existing = this.store.getConversation(accountId, peerId);
    const next: ConversationRecord = {
      accountId,
      peerId,
      title: existing?.title || peerId,
      lastMessagePreview: params.preview,
      lastMessageType: params.messageType,
      lastMessageAt: params.timestamp,
      unreadCount: params.incrementUnread ? (existing?.unreadCount ?? 0) + 1 : existing?.unreadCount ?? 0,
      contextToken: params.contextToken,
      updatedAt: nowMs(),
    };
    this.store.upsertConversation(next);
  }

  private collectDebugLogs(accountId: string, query?: DebugLogQuery): DebugLogEntry[] {
    const source = query?.source ?? "all";
    const level = query?.level ?? "all";
    const keyword = query?.keyword?.trim().toLowerCase() ?? "";
    const limit = query?.limit ?? "all";
    const targets = source === "all"
      ? DEBUG_LOG_SOURCES
      : DEBUG_LOG_SOURCES.filter((entry) => entry.source === source);

    const entries = targets
      .flatMap(({ source, fileName }) => readRecentJsonlLogs(fileName, limit).map((entry) => {
        const { timestamp, event, ...payload } = entry;
        return {
          source,
          timestamp,
          event,
          level: /error|failed/i.test(event) ? "error" as const : "info" as const,
          summary: summarizeLogEvent(source, event, payload),
          payload,
        };
      }))
      .filter((entry) => {
        const payloadAccountId = typeof entry.payload.accountId === "string" ? entry.payload.accountId : "";
        if (accountId && payloadAccountId && payloadAccountId !== accountId) {
          return false;
        }
        if (level !== "all" && entry.level !== level) {
          return false;
        }
        if (keyword) {
          const haystack = [
            entry.source,
            entry.event,
            entry.summary,
            JSON.stringify(entry.payload),
          ].join(" ").toLowerCase();
          if (!haystack.includes(keyword)) {
            return false;
          }
        }
        return true;
      })
      .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));

    if (limit === "all") {
      return entries;
    }
    return entries.slice(0, Math.max(1, limit));
  }

  private logRuntime(event: string, payload: Record<string, unknown>): void {
    appendJsonlLog("chat-service.jsonl", event, payload);
  }
}
