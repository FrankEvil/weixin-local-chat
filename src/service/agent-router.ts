import crypto from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { SqliteStore } from "../store/sqlite.js";
import type { AgentJobRecord, AgentProvider, AgentSessionRecord, AppConfig, RuntimeDiagnostics, ProviderRuntimeStatus } from "../types.js";

const execFileAsync = promisify(execFile);
const ANSI_PATTERN = /\u001B\[[0-9;]*m/g;
const MAX_WECHAT_MESSAGE_LENGTH = 1600;
const DEFAULT_OPENCLAW_CONTAINER = "openclaw-openclaw-gateway-1";
const DEFAULT_OPENCLAW_LOCAL_HOME = path.join(os.homedir(), ".openclaw");
const DEFAULT_OPENCLAW_LOCAL_COMMAND = path.join(DEFAULT_OPENCLAW_LOCAL_HOME, "bin", "openclaw");
const DEFAULT_OPENCLAW_DOCKER_HOME = "/home/node/.openclaw";
const OPENCLAW_TEXT_KEYS = [
  "reply",
  "response",
  "message",
  "text",
  "output",
  "final",
  "finalText",
  "assistant",
  "content",
] as const;
const OPENCLAW_CONTAINER_KEYS = ["result", "data", "payload", "payloads", "event", "answer"] as const;

interface HandleInboundTextParams {
  accountId: string;
  peerId: string;
  text: string;
}

interface HandleInboundMessageParams {
  accountId: string;
  peerId: string;
  text: string;
  media?: AgentMediaAttachment[];
}

interface AgentExecutionResult {
  provider: AgentProvider;
  sessionId: string;
  reply: string;
  media: AgentMediaAttachment[];
}

interface AgentMediaAttachment {
  url: string;
  mimeType: string;
  fileName: string;
  sendAsVoice: boolean;
}

interface OpenClawSessionLogEntry {
  timestamp?: string;
  type?: string;
  message?: {
    role?: string;
    toolName?: string;
    details?: { aggregated?: string };
    content?: Array<{ type?: string; text?: string }>;
  };
}

interface OpenClawExecToolPayload {
  output?: string;
  format?: string;
}

interface AgentLogContext {
  provider: AgentProvider;
  accountId: string;
  peerId: string;
  sessionId: string;
}

type OpenClawMode = AppConfig["openclawMode"];
type ResolvedOpenClawRuntime =
  | {
      mode: "local";
      command: string;
      workspace: string;
      dataDir: string;
    }
  | {
      mode: "docker";
      container: string;
      workspace: string;
      dataDir: string;
    };

type SendReplyFn = (params: { accountId: string; peerId: string; text: string }) => Promise<void>;
type SendMediaFn = (params: {
  accountId: string;
  peerId: string;
  fileName: string;
  mimeType: string;
  bytesBase64: string;
  caption: string;
  sendAsVoice?: boolean;
}) => Promise<void>;

const MEDIA_URL_KEYS = ["mediaUrl", "media_url", "url", "src", "href", "fileUrl", "audioUrl", "imageUrl"] as const;
const MIME_TYPE_KEYS = ["mimeType", "mime_type", "contentType", "content_type", "mediaType", "media_type"] as const;
const FILE_NAME_KEYS = ["fileName", "filename", "name", "title"] as const;
const VOICE_MIME_PREFIXES = ["audio/", "application/ogg"] as const;
const VOICE_FILE_EXTENSIONS = [".silk", ".wav", ".mp3", ".m4a", ".aac", ".ogg", ".opus"] as const;
const IMAGE_FILE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".svg"] as const;
const VIDEO_FILE_EXTENSIONS = [".mp4", ".mov", ".mkv", ".webm"] as const;

function nowMs(): number {
  return Date.now();
}

function stripAnsi(text: string): string {
  return text.replaceAll(ANSI_PATTERN, "").trim();
}

function normalizeReply(text: string, fallback: string): string {
  const cleaned = stripAnsi(text).replace(/\r\n/g, "\n").trim();
  if (!cleaned) return fallback;
  return cleaned;
}

function parseAgentCommand(text: string): { provider?: AgentProvider; prompt: string; exit: boolean } | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) {
    return null;
  }
  if (/^\/exit(?:\s+.*)?$/i.test(trimmed)) {
    return { exit: true, prompt: "", provider: undefined };
  }
  const match = trimmed.match(/^\/(codex|claude|openclaw)\b([\s\S]*)$/i);
  if (!match) {
    return null;
  }
  return {
    provider: match[1].toLowerCase() as AgentProvider,
    prompt: match[2]?.trim() ?? "",
    exit: false,
  };
}

function buildBindingKey(accountId: string, peerId: string, provider: AgentProvider): string {
  return `${accountId}::${peerId}::${provider}`;
}

function wrapProviderPrompt(provider: AgentProvider, workspace: string, userPrompt: string): string {
  const workspaceNote = workspace ? `当前工作目录：${workspace}` : "当前工作目录未显式指定。";
  const resultInstruction = provider === "openclaw"
    ? [
      "请以适合微信直接发送的中文结果回复，文字保持简洁。",
      "如果用户要求语音、图片、音频、文件等媒体，你必须实际生成对应媒体，不要只用文字描述“已经生成好了”。",
      "如果你生成了媒体，请保留可发送的媒体结果；可以附带一小段说明文字，但不要只返回说明文字。",
      `当前助手：${provider}。`,
    ].join(" ")
    : `请以适合微信直接发送的中文文本回复。若需要分点，保持简洁。当前助手：${provider}。`;
  return [
    "你正在通过微信聊天桥接和用户对话。",
    "请直接回复用户，优先给出结论和可执行建议，不要解释 CLI 参数或内部桥接实现。",
    workspaceNote,
    "",
    "用户消息：",
    userPrompt.trim(),
    "",
    resultInstruction,
  ].join("\n");
}

function summarizeInboundAttachment(attachment: AgentMediaAttachment, index: number): string {
  const fileName = attachment.fileName || `附件 ${index + 1}`;
  const mimeType = attachment.mimeType || "application/octet-stream";
  return `${index + 1}. ${fileName} (${mimeType})\n路径：${attachment.url}`;
}

function buildInboundAgentPrompt(params: { text: string; media: AgentMediaAttachment[] }): string {
  const normalizedText = params.text.trim();
  const sections: string[] = [];

  if (normalizedText) {
    sections.push(`用户消息：\n${normalizedText}`);
  }

  if (params.media.length) {
    sections.push([
      "随附媒体：",
      ...params.media.map((attachment, index) => summarizeInboundAttachment(attachment, index)),
      "请结合这些本地文件一起理解和处理本轮消息。",
    ].join("\n"));
  }

  if (!sections.length) {
    return "";
  }

  return sections.join("\n\n");
}

function resolveWorkspace(provider: AgentProvider, config: AppConfig, fallbackWorkspace: string): string {
  const defaultWorkspace = config.defaultWorkspace.trim() || fallbackWorkspace;
  if (provider === "codex") {
    return config.codexWorkspace.trim() || defaultWorkspace;
  }
  if (provider === "claude") {
    return config.claudeWorkspace.trim() || defaultWorkspace;
  }
  return config.openclawWorkspace.trim() || defaultWorkspace;
}

function normalizeOpenClawMode(mode: string): OpenClawMode {
  if (mode === "docker" || mode === "local") {
    return mode;
  }
  return "auto";
}

function resolveOpenClawDataDir(config: AppConfig, mode: "docker" | "local"): string {
  const configured = config.openclawDataDir.trim();
  if (configured) {
    return configured;
  }
  return mode === "docker" ? DEFAULT_OPENCLAW_DOCKER_HOME : DEFAULT_OPENCLAW_LOCAL_HOME;
}

function resolveOpenClawWorkspace(config: AppConfig, fallbackWorkspace: string, mode: "docker" | "local"): string {
  const configured = config.openclawWorkspace.trim();
  if (mode === "docker") {
    return configured;
  }
  return configured || config.defaultWorkspace.trim() || fallbackWorkspace;
}

function uniqueNonEmpty(values: Array<string | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim() ?? "").filter(Boolean))];
}

function isCommandUnavailableError(error: unknown): boolean {
  const code = typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: string }).code ?? "")
    : "";
  return code === "ENOENT" || code === "EACCES";
}

async function canUseCommand(command: string, args: string[]): Promise<boolean> {
  try {
    await execFileAsync(command, args, {
      timeout: 5_000,
      maxBuffer: 512 * 1024,
    });
    return true;
  } catch (error) {
    return !isCommandUnavailableError(error);
  }
}

async function detectLocalOpenClawCommand(config: AppConfig): Promise<string> {
  const candidates = config.openclawCommand.trim()
    ? [config.openclawCommand.trim()]
    : uniqueNonEmpty(["openclaw", DEFAULT_OPENCLAW_LOCAL_COMMAND]);
  for (const candidate of candidates) {
    if (await canUseCommand(candidate, ["--help"])) {
      return candidate;
    }
  }
  return "";
}

async function isDockerContainerRunning(container: string): Promise<boolean> {
  const trimmed = container.trim();
  if (!trimmed) {
    return false;
  }
  try {
    const { stdout } = await execFileAsync("docker", [
      "inspect",
      "-f",
      "{{.State.Running}}",
      trimmed,
    ], {
      timeout: 5_000,
      maxBuffer: 512 * 1024,
    });
    return stdout.trim() === "true";
  } catch {
    return false;
  }
}

function ensureWorkspaceDirectory(workspace: string, provider: AgentProvider): void {
  if (!workspace) {
    if (provider === "openclaw") return;
    throw new Error(`未配置 ${provider} 工作目录`);
  }
  if (!fs.existsSync(workspace)) {
    throw new Error(`${provider} 工作目录不存在：${workspace}`);
  }
  if (!fs.statSync(workspace).isDirectory()) {
    throw new Error(`${provider} 工作目录不是目录：${workspace}`);
  }
}

function describeWorkspaceStatus(workspace: string): { workspace: string; ok: boolean; details: string } {
  const trimmed = workspace.trim();
  if (!trimmed) {
    return { workspace: "", ok: false, details: "未配置工作目录" };
  }
  if (!fs.existsSync(trimmed)) {
    return { workspace: trimmed, ok: false, details: "工作目录不存在" };
  }
  if (!fs.statSync(trimmed).isDirectory()) {
    return { workspace: trimmed, ok: false, details: "工作目录不是目录" };
  }
  return { workspace: trimmed, ok: true, details: "工作目录可用" };
}

function parseCodexAssistantMessage(sessionFile: string): string {
  const lines = fs.readFileSync(sessionFile, "utf-8").split("\n").filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const parsed = JSON.parse(lines[index]) as {
        type?: string;
        payload?: {
          type?: string;
          message?: string;
          role?: string;
          content?: Array<{ type?: string; text?: string }>;
        };
      };
      if (parsed.type === "event_msg" && parsed.payload?.type === "agent_message" && parsed.payload.message) {
        return parsed.payload.message;
      }
      if (parsed.type === "response_item" && parsed.payload?.type === "message" && parsed.payload.role === "assistant") {
        const text = (parsed.payload.content ?? [])
          .filter((item) => item.type === "output_text" && item.text)
          .map((item) => item.text)
          .join("\n")
          .trim();
        if (text) {
          return text;
        }
      }
    } catch {
      // Ignore malformed JSONL lines and keep scanning backward.
    }
  }
  return "";
}

function parseCodexSessionMetaId(sessionFile: string): string {
  const firstLine = fs.readFileSync(sessionFile, "utf-8").split("\n").find((line) => line.trim()) ?? "";
  if (!firstLine) return "";
  try {
    const parsed = JSON.parse(firstLine) as {
      type?: string;
      payload?: { id?: string; cwd?: string };
    };
    if (parsed.type === "session_meta" && parsed.payload?.id) {
      return parsed.payload.id;
    }
  } catch {
    return "";
  }
  return "";
}

function parseCodexSessionMetaCwd(sessionFile: string): string {
  const firstLine = fs.readFileSync(sessionFile, "utf-8").split("\n").find((line) => line.trim()) ?? "";
  if (!firstLine) return "";
  try {
    const parsed = JSON.parse(firstLine) as {
      type?: string;
      payload?: { id?: string; cwd?: string };
    };
    if (parsed.type === "session_meta" && parsed.payload?.cwd) {
      return parsed.payload.cwd;
    }
  } catch {
    return "";
  }
  return "";
}

function collectFiles(rootDir: string): string[] {
  if (!fs.existsSync(rootDir)) return [];
  const output: string[] = [];
  const stack = [rootDir];
  while (stack.length) {
    const current = stack.pop()!;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (entry.isFile()) {
        output.push(fullPath);
      }
    }
  }
  return output;
}

function findCodexSessionFileById(sessionId: string): string {
  const rootDir = path.join(os.homedir(), ".codex", "sessions");
  for (const filePath of collectFiles(rootDir)) {
    if (filePath.includes(sessionId)) {
      return filePath;
    }
  }
  return "";
}

function findLatestCodexSession(workspace: string, startedAt: number): { sessionId: string; filePath: string } | null {
  const rootDir = path.join(os.homedir(), ".codex", "sessions");
  let winner: { sessionId: string; filePath: string; mtimeMs: number } | null = null;
  for (const filePath of collectFiles(rootDir)) {
    if (!filePath.endsWith(".jsonl")) continue;
    const stat = fs.statSync(filePath);
    if (stat.mtimeMs + 1500 < startedAt) continue;
    const sessionCwd = parseCodexSessionMetaCwd(filePath);
    if (sessionCwd !== workspace) continue;
    const sessionId = parseCodexSessionMetaId(filePath);
    if (!sessionId) continue;
    if (!winner || stat.mtimeMs > winner.mtimeMs) {
      winner = { sessionId, filePath, mtimeMs: stat.mtimeMs };
    }
  }
  if (!winner) return null;
  return { sessionId: winner.sessionId, filePath: winner.filePath };
}

function parseOpenClawResult(stdout: string): { reply: string; media: AgentMediaAttachment[] } {
  const cleaned = stripAnsi(stdout);
  if (!cleaned) return { reply: "", media: [] };
  const parsedWhole = tryParseJson(cleaned);
  if (parsedWhole !== null) {
    const payloads = extractOpenClawPayloads(parsedWhole);
    if (payloads.length) {
      const reply = cleanOpenClawReply(payloads.map((payload) => payload.text).filter(Boolean).join("\n\n"));
      const media = payloads
        .filter((payload) => payload.url)
        .map((payload) => ({
          url: payload.url,
          mimeType: payload.mimeType,
          fileName: payload.fileName,
          sendAsVoice: payload.sendAsVoice,
        }));
      return { reply, media };
    }
  }
  const direct = extractTextFromJsonLike(cleaned);
  if (direct) {
    return { reply: cleanOpenClawReply(direct), media: [] };
  }
  return { reply: cleanOpenClawReply(cleaned), media: [] };
}

function extractOpenClawPayloads(value: unknown): Array<{
  text: string;
  url: string;
  mimeType: string;
  fileName: string;
  sendAsVoice: boolean;
}> {
  if (!value || typeof value !== "object") {
    return [];
  }
  const record = value as Record<string, unknown>;
  const result = record.result;
  if (!result || typeof result !== "object") {
    return [];
  }
  const resultRecord = result as Record<string, unknown>;
  const payloads = resultRecord.payloads;
  if (!Array.isArray(payloads) || !payloads.length) {
    return [];
  }
  return payloads
    .map((payload, index) => extractOpenClawPayload(payload, index))
    .filter((payload) => Boolean(payload.text || payload.url));
}

function extractOpenClawPayload(payload: unknown, index: number): {
  text: string;
  url: string;
  mimeType: string;
  fileName: string;
  sendAsVoice: boolean;
} {
  if (!payload || typeof payload !== "object") {
    return { text: "", url: "", mimeType: "", fileName: "", sendAsVoice: false };
  }
  const payloadRecord = payload as Record<string, unknown>;
  const rawText = typeof payloadRecord.text === "string" ? payloadRecord.text.trim() : "";
  const embeddedMediaPath = extractMediaPathFromText(rawText);
  const text = stripMediaPathLines(rawText);
  const url = firstNonEmptyString(payloadRecord, MEDIA_URL_KEYS) || embeddedMediaPath;
  const mimeType = firstNonEmptyString(payloadRecord, MIME_TYPE_KEYS);
  const fileName = firstNonEmptyString(payloadRecord, FILE_NAME_KEYS) || inferFileNameFromUrl(url, mimeType, index);
  return {
    text,
    url,
    mimeType,
    fileName,
    sendAsVoice: isVoiceMediaHint(mimeType, fileName),
  };
}

function extractMediaPathFromText(text: string): string {
  if (!text.trim()) {
    return "";
  }
  const lines = text.split("\n");
  for (const line of lines) {
    const match = line.match(/^\s*MEDIA_PATH:\s*(.+?)\s*$/i);
    if (match?.[1]) {
      return match[1].trim();
    }
  }
  return "";
}

function stripMediaPathLines(text: string): string {
  return text
    .split("\n")
    .filter((line) => !/^\s*MEDIA_PATH:\s*.+$/i.test(line))
    .join("\n")
    .trim();
}

function extractTextFromJsonLike(rawText: string): string {
  const parsedWhole = tryParseJson(rawText);
  if (parsedWhole !== null) {
    return extractBestReply(parsedWhole);
  }
  const lines = rawText.split("\n").map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const parsedLine = tryParseJson(lines[index]);
    if (parsedLine !== null) {
      const reply = extractBestReply(parsedLine);
      if (reply) {
        return reply;
      }
    }
  }
  return "";
}

function tryParseJson(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractBestReply(value: unknown): string {
  if (typeof value === "string") {
    const cleaned = value.trim();
    if (!cleaned) return "";
    const nested = tryParseJson(cleaned);
    if (nested !== null && nested !== value) {
      return extractBestReply(nested);
    }
    return cleaned;
  }
  if (Array.isArray(value)) {
    const segments = value
      .map((item) => extractBestReply(item))
      .filter(Boolean);
    return segments.join("\n").trim();
  }
  if (!value || typeof value !== "object") {
    return "";
  }
  const record = value as Record<string, unknown>;
  if (typeof record.type === "string") {
    const loweredType = record.type.toLowerCase();
    if (["text", "output_text", "markdown", "plain_text"].includes(loweredType)) {
      for (const key of ["text", "content", "value", "body"]) {
        const extracted = extractBestReply(record[key]);
        if (extracted) {
          return extracted;
        }
      }
    }
    if (["message", "assistant_message", "response"].includes(loweredType)) {
      for (const key of ["content", "message", "text", "reply", "output"]) {
        const extracted = extractBestReply(record[key]);
        if (extracted) {
          return extracted;
        }
      }
    }
  }
  for (const key of OPENCLAW_TEXT_KEYS) {
    const extracted = extractBestReply(record[key]);
    if (extracted) {
      return extracted;
    }
  }
  for (const key of OPENCLAW_CONTAINER_KEYS) {
    const extracted = extractBestReply(record[key]);
    if (extracted) {
      return extracted;
    }
  }
  return "";
}

function firstNonEmptyString(record: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function isVoiceMediaHint(mimeType: string, fileName: string): boolean {
  const lowerMime = mimeType.toLowerCase();
  const lowerFileName = fileName.toLowerCase();
  return VOICE_MIME_PREFIXES.some((prefix) => lowerMime.startsWith(prefix))
    || VOICE_FILE_EXTENSIONS.some((ext) => lowerFileName.endsWith(ext));
}

function inferMimeTypeFromFileName(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (VOICE_FILE_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
    if (lower.endsWith(".wav")) return "audio/wav";
    if (lower.endsWith(".mp3")) return "audio/mpeg";
    if (lower.endsWith(".m4a")) return "audio/mp4";
    if (lower.endsWith(".aac")) return "audio/aac";
    if (lower.endsWith(".ogg") || lower.endsWith(".opus")) return "audio/ogg";
    if (lower.endsWith(".silk")) return "audio/silk";
    return "audio/*";
  }
  if (IMAGE_FILE_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
    if (lower.endsWith(".png")) return "image/png";
    if (lower.endsWith(".gif")) return "image/gif";
    if (lower.endsWith(".webp")) return "image/webp";
    if (lower.endsWith(".svg")) return "image/svg+xml";
    if (lower.endsWith(".bmp")) return "image/bmp";
    return "image/jpeg";
  }
  if (VIDEO_FILE_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
    return "video/mp4";
  }
  return "application/octet-stream";
}

function inferFileNameFromUrl(url: string, mimeType: string, index: number): string {
  const fallbackExtension = extensionFromMimeType(mimeType);
  if (!url) {
    return `agent-media-${index + 1}${fallbackExtension}`;
  }
  if (url.startsWith("data:")) {
    return `agent-media-${index + 1}${fallbackExtension}`;
  }
  try {
    if (url.startsWith("file://")) {
      const filePath = fileURLToPath(url);
      return path.basename(filePath) || `agent-media-${index + 1}${fallbackExtension}`;
    }
    const parsed = new URL(url);
    const baseName = path.basename(parsed.pathname);
    return baseName || `agent-media-${index + 1}${fallbackExtension}`;
  } catch {
    const baseName = path.basename(url);
    return baseName || `agent-media-${index + 1}${fallbackExtension}`;
  }
}

function extensionFromMimeType(mimeType: string): string {
  const lower = mimeType.toLowerCase();
  if (!lower) return ".bin";
  if (lower.includes("png")) return ".png";
  if (lower.includes("gif")) return ".gif";
  if (lower.includes("webp")) return ".webp";
  if (lower.includes("svg")) return ".svg";
  if (lower.includes("bmp")) return ".bmp";
  if (lower.includes("jpeg") || lower.includes("jpg")) return ".jpg";
  if (lower.includes("wav")) return ".wav";
  if (lower.includes("mpeg")) return ".mp3";
  if (lower.includes("mp4")) return lower.startsWith("audio/") ? ".m4a" : ".mp4";
  if (lower.includes("aac")) return ".aac";
  if (lower.includes("ogg")) return ".ogg";
  if (lower.includes("opus")) return ".opus";
  if (lower.includes("silk")) return ".silk";
  return ".bin";
}

function fileNameFromContentDisposition(contentDisposition: string | null): string {
  if (!contentDisposition) return "";
  const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    return decodeURIComponent(utf8Match[1]).trim();
  }
  const basicMatch = contentDisposition.match(/filename="?([^"]+)"?/i);
  return basicMatch?.[1]?.trim() ?? "";
}

function parseDataUrl(mediaUrl: string): { bytes: Buffer; mimeType: string } | null {
  const match = mediaUrl.match(/^data:([^;,]+)?(?:;charset=[^;,]+)?(;base64)?,([\s\S]+)$/i);
  if (!match) {
    return null;
  }
  const mimeType = match[1]?.trim() || "application/octet-stream";
  const isBase64 = Boolean(match[2]);
  const body = match[3] ?? "";
  const bytes = isBase64
    ? Buffer.from(body, "base64")
    : Buffer.from(decodeURIComponent(body), "utf-8");
  return { bytes, mimeType };
}

function summarizeAgentResult(result: AgentExecutionResult): string {
  if (result.reply.trim()) {
    return result.reply;
  }
  if (result.media.length) {
    return `[媒体 ${result.media.length} 项]`;
  }
  return "";
}

function isLikelyMediaPath(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return VOICE_FILE_EXTENSIONS.some((ext) => lower.endsWith(ext))
    || IMAGE_FILE_EXTENSIONS.some((ext) => lower.endsWith(ext))
    || VIDEO_FILE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function cleanOpenClawReply(text: string): string {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) {
    return "";
  }
  const filtered = lines.filter((line) => !isLikelyNoiseLine(line));
  if (filtered.length) {
    return filtered.join("\n").trim();
  }
  return lines.join("\n").trim();
}

function isLikelyNoiseLine(line: string): boolean {
  const normalized = line.trim();
  if (!normalized) return true;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(normalized)) {
    return true;
  }
  if (/^\/[A-Za-z0-9._/-]+$/.test(normalized)) {
    return true;
  }
  if (/^[A-Za-z0-9._-]+\.md$/i.test(normalized)) {
    return true;
  }
  if (/^(openai-codex|gpt-\d+(?:\.\d+)?|run|once|off)$/i.test(normalized)) {
    return true;
  }
  if (/^[A-Za-z0-9._-]{2,40}$/.test(normalized) && !/[\u4e00-\u9fff]/.test(normalized) && !/[ .,:;!?]/.test(normalized)) {
    return true;
  }
  return false;
}

function splitLongReply(text: string, maxLength = MAX_WECHAT_MESSAGE_LENGTH): string[] {
  const cleaned = text.replace(/\r\n/g, "\n").trim();
  if (!cleaned) return [];
  if (cleaned.length <= maxLength) return [cleaned];

  const chunks: string[] = [];
  const paragraphGroups = cleaned.split(/\n{2,}/);
  let current = "";

  const pushChunk = (value: string) => {
    const trimmed = value.trim();
    if (trimmed) {
      chunks.push(trimmed);
    }
  };

  for (const group of paragraphGroups) {
    const paragraph = group.trim();
    if (!paragraph) continue;
    if (!current) {
      if (paragraph.length <= maxLength) {
        current = paragraph;
        continue;
      }
      pushChunkSmart(chunks, paragraph, maxLength);
      continue;
    }
    const candidate = `${current}\n\n${paragraph}`;
    if (candidate.length <= maxLength) {
      current = candidate;
      continue;
    }
    pushChunk(current);
    if (paragraph.length <= maxLength) {
      current = paragraph;
      continue;
    }
    pushChunkSmart(chunks, paragraph, maxLength);
    current = "";
  }
  pushChunk(current);
  return chunks;
}

function pushChunkSmart(chunks: string[], text: string, maxLength: number): void {
  const sentenceParts = splitByDelimiters(text, /(?<=[。！？!?；;])\s*/);
  if (sentenceParts.length > 1) {
    pushMergedParts(chunks, sentenceParts, maxLength);
    return;
  }
  const clauseParts = splitByDelimiters(text, /(?<=[，、,：:])\s*/);
  if (clauseParts.length > 1) {
    pushMergedParts(chunks, clauseParts, maxLength);
    return;
  }
  for (let index = 0; index < text.length; index += maxLength) {
    chunks.push(text.slice(index, index + maxLength).trim());
  }
}

function splitByDelimiters(text: string, pattern: RegExp): string[] {
  return text.split(pattern).map((item) => item.trim()).filter(Boolean);
}

function pushMergedParts(chunks: string[], parts: string[], maxLength: number): void {
  let current = "";
  for (const part of parts) {
    if (!current) {
      if (part.length <= maxLength) {
        current = part;
        continue;
      }
      pushChunkSmart(chunks, part, maxLength);
      continue;
    }
    const candidate = `${current}\n${part}`;
    if (candidate.length <= maxLength) {
      current = candidate;
      continue;
    }
    chunks.push(current.trim());
    if (part.length <= maxLength) {
      current = part;
      continue;
    }
    pushChunkSmart(chunks, part, maxLength);
    current = "";
  }
  if (current.trim()) {
    chunks.push(current.trim());
  }
}

export class AgentRouter {
  private readonly queueMap = new Map<string, Promise<void>>();
  private readonly logFilePath: string;

  constructor(
    private readonly store: SqliteStore,
    private readonly workspaceDir: string,
    private readonly sendReply: SendReplyFn,
    private readonly sendMedia: SendMediaFn,
  ) {
    const logDir = path.join(this.workspaceDir, "data", "logs");
    fs.mkdirSync(logDir, { recursive: true });
    this.logFilePath = path.join(logDir, "agent-router.jsonl");
  }

  async getRuntimeDiagnostics(configOverride?: AppConfig): Promise<RuntimeDiagnostics> {
    const config = configOverride ?? this.store.getConfig();
    const defaultWorkspace = config.defaultWorkspace.trim() || this.workspaceDir;
    const codexWorkspace = describeWorkspaceStatus(resolveWorkspace("codex", config, this.workspaceDir));
    const claudeWorkspace = describeWorkspaceStatus(resolveWorkspace("claude", config, this.workspaceDir));
    const codexAvailable = await canUseCommand("codex", ["--help"]);
    const claudeAvailable = await canUseCommand("claude", ["--help"]);

    const providers: ProviderRuntimeStatus[] = [
      {
        provider: "codex",
        available: codexAvailable && codexWorkspace.ok,
        command: "codex",
        workspace: codexWorkspace.workspace,
        details: codexAvailable ? codexWorkspace.details : "未找到 codex 命令",
      },
      {
        provider: "claude",
        available: claudeAvailable && claudeWorkspace.ok,
        command: "claude",
        workspace: claudeWorkspace.workspace,
        details: claudeAvailable ? claudeWorkspace.details : "未找到 claude 命令",
      },
    ];

    try {
      const runtime = await this.resolveOpenClawRuntime(config);
      providers.push({
        provider: "openclaw",
        available: true,
        command: runtime.mode === "local" ? runtime.command : "docker",
        workspace: runtime.workspace || "(容器默认目录)",
        details: runtime.mode === "local"
          ? "已解析为本地 CLI 模式"
          : `已解析为 Docker 模式（${runtime.container}）`,
        resolvedMode: runtime.mode,
        container: runtime.mode === "docker" ? runtime.container : undefined,
        dataDir: runtime.dataDir,
      });
    } catch (error) {
      const configuredMode = normalizeOpenClawMode(config.openclawMode);
      providers.push({
        provider: "openclaw",
        available: false,
        command: configuredMode === "docker" ? "docker" : (config.openclawCommand.trim() || "openclaw"),
        workspace: configuredMode === "docker"
          ? (config.openclawWorkspace.trim() || "(容器默认目录)")
          : resolveOpenClawWorkspace(config, this.workspaceDir, "local"),
        details: error instanceof Error ? error.message : String(error),
        resolvedMode: configuredMode === "auto" ? undefined : configuredMode,
        container: config.openclawContainer.trim() || DEFAULT_OPENCLAW_CONTAINER,
        dataDir: resolveOpenClawDataDir(config, configuredMode === "docker" ? "docker" : "local"),
      });
    }

    return {
      checkedAt: new Date().toISOString(),
      defaultWorkspace,
      providers,
    };
  }

  private async resolveOpenClawRuntime(config: AppConfig): Promise<ResolvedOpenClawRuntime> {
    const configuredMode = normalizeOpenClawMode(config.openclawMode);
    const configuredContainer = config.openclawContainer.trim();
    const hasExplicitLocalCommand = Boolean(config.openclawCommand.trim());
    const hasCustomContainer = Boolean(configuredContainer) && configuredContainer !== DEFAULT_OPENCLAW_CONTAINER;

    const tryLocal = async (): Promise<ResolvedOpenClawRuntime | null> => {
      const command = await detectLocalOpenClawCommand(config);
      if (!command) {
        return null;
      }
      const workspace = resolveOpenClawWorkspace(config, this.workspaceDir, "local");
      try {
        ensureWorkspaceDirectory(workspace, "openclaw");
      } catch (error) {
        if (configuredMode === "local") {
          throw error;
        }
        return null;
      }
      return {
        mode: "local",
        command,
        workspace,
        dataDir: resolveOpenClawDataDir(config, "local"),
      };
    };

    const tryDocker = async (): Promise<ResolvedOpenClawRuntime | null> => {
      const containers = uniqueNonEmpty([
        configuredContainer,
        configuredContainer ? undefined : DEFAULT_OPENCLAW_CONTAINER,
      ]);
      for (const container of containers) {
        if (!await isDockerContainerRunning(container)) {
          continue;
        }
        return {
          mode: "docker",
          container,
          workspace: resolveOpenClawWorkspace(config, this.workspaceDir, "docker"),
          dataDir: resolveOpenClawDataDir(config, "docker"),
        };
      }
      return null;
    };

    if (configuredMode === "local") {
      const runtime = await tryLocal();
      if (runtime) return runtime;
      throw new Error("OpenClaw 已配置为本地模式，但未找到可用命令。请设置 openclawCommand，或确认 PATH / ~/.openclaw/bin/openclaw 可用。");
    }

    if (configuredMode === "docker") {
      const runtime = await tryDocker();
      if (runtime) return runtime;
      throw new Error("OpenClaw 已配置为 Docker 模式，但未找到可运行容器。请检查 openclawContainer 配置和 Docker 状态。");
    }

    const resolvers = hasExplicitLocalCommand
      ? [tryLocal, tryDocker]
      : hasCustomContainer
        ? [tryDocker, tryLocal]
        : [tryLocal, tryDocker];
    for (const resolveRuntime of resolvers) {
      const runtime = await resolveRuntime();
      if (runtime) {
        return runtime;
      }
    }
    throw new Error("自动检测 OpenClaw 失败：未找到本地 openclaw 命令，也未发现可运行的 Docker 容器。请配置 openclawMode / openclawCommand / openclawContainer。");
  }

  private async describeOpenClawRuntime(config: AppConfig): Promise<{ mode: "local" | "docker"; workspace: string }> {
    try {
      const runtime = await this.resolveOpenClawRuntime(config);
      return {
        mode: runtime.mode,
        workspace: runtime.workspace || "(容器默认目录)",
      };
    } catch {
      const mode = normalizeOpenClawMode(config.openclawMode);
      if (mode === "docker") {
        return {
          mode: "docker",
          workspace: config.openclawWorkspace.trim() || "(容器默认目录)",
        };
      }
      return {
        mode: "local",
        workspace: resolveOpenClawWorkspace(config, this.workspaceDir, "local"),
      };
    }
  }

  handleInboundText(params: HandleInboundTextParams): void {
    this.handleInboundMessage({
      ...params,
      media: [],
    });
  }

  handleInboundMessage(params: HandleInboundMessageParams): void {
    const trimmed = params.text.trim();
    const attachments = params.media ?? [];
    const command = trimmed ? parseAgentCommand(trimmed) : null;
    if (command?.exit) {
      this.enqueue(`${params.accountId}::${params.peerId}::exit`, async () => {
        this.store.clearAgentBinding(params.accountId, params.peerId);
        await this.sendReply({
          accountId: params.accountId,
          peerId: params.peerId,
          text: "已退出 Agent 模式，后续普通消息不会自动转发。",
        });
      });
      return;
    }

    if (command?.provider) {
      const session = this.store.getAgentSession(params.accountId, params.peerId, command.provider);
      this.store.upsertAgentBinding({
        accountId: params.accountId,
        peerId: params.peerId,
        activeProvider: command.provider,
        activeSessionId: session?.sessionId ?? "",
        updatedAt: nowMs(),
      });
      if (!command.prompt) {
        const config = this.store.getConfig();
        this.enqueue(buildBindingKey(params.accountId, params.peerId, command.provider), async () => {
          if (command.provider === "openclaw") {
            const runtime = await this.describeOpenClawRuntime(config);
            await this.sendReply({
              accountId: params.accountId,
              peerId: params.peerId,
              text: `已切换到 /${command.provider}。后续普通消息会转给它。\n运行方式：${runtime.mode}\n工作目录：${runtime.workspace}`,
            });
            return;
          }
          const workspace = resolveWorkspace(command.provider!, config, this.workspaceDir);
          await this.sendReply({
            accountId: params.accountId,
            peerId: params.peerId,
            text: `已切换到 /${command.provider}。后续普通消息会转给它。\n工作目录：${workspace}`,
          });
        });
        return;
      }
      this.enqueue(buildBindingKey(params.accountId, params.peerId, command.provider), async () => {
        await this.runAgentTurn({
          accountId: params.accountId,
          peerId: params.peerId,
          provider: command.provider!,
          prompt: buildInboundAgentPrompt({
            text: command.prompt,
            media: attachments,
          }),
        });
      });
      return;
    }

    const binding = this.store.getAgentBinding(params.accountId, params.peerId);
    if (!binding?.activeProvider) {
      return;
    }
    const prompt = buildInboundAgentPrompt({
      text: trimmed,
      media: attachments,
    });
    if (!prompt) {
      return;
    }
    const activeProvider = binding.activeProvider;
    this.enqueue(buildBindingKey(params.accountId, params.peerId, activeProvider), async () => {
      await this.runAgentTurn({
        accountId: params.accountId,
        peerId: params.peerId,
        provider: activeProvider,
        prompt,
      });
    });
  }

  private enqueue(key: string, task: () => Promise<void>): void {
    const prev = this.queueMap.get(key) ?? Promise.resolve();
    const next = prev.catch(() => undefined).then(task);
    this.queueMap.set(key, next.finally(() => {
      if (this.queueMap.get(key) === next) {
        this.queueMap.delete(key);
      }
    }));
  }

  private async sendLongReply(params: { accountId: string; peerId: string; text: string }): Promise<void> {
    const chunks = splitLongReply(params.text);
    if (!chunks.length) {
      return;
    }
    for (const chunk of chunks) {
      await this.sendReply({
        accountId: params.accountId,
        peerId: params.peerId,
        text: chunk,
      });
    }
  }

  private async sendMediaReply(params: {
    accountId: string;
    peerId: string;
    media: AgentMediaAttachment[];
  }): Promise<void> {
    for (const attachment of params.media) {
      const downloaded = await this.fetchMediaAttachment(attachment);
      await this.sendMedia({
        accountId: params.accountId,
        peerId: params.peerId,
        fileName: downloaded.fileName,
        mimeType: downloaded.mimeType,
        bytesBase64: downloaded.bytes.toString("base64"),
        caption: "",
        sendAsVoice: downloaded.sendAsVoice,
      });
    }
  }

  private async fetchMediaAttachment(attachment: AgentMediaAttachment): Promise<{
    bytes: Buffer;
    mimeType: string;
    fileName: string;
    sendAsVoice: boolean;
  }> {
    const dataUrl = parseDataUrl(attachment.url);
    if (dataUrl) {
      const fileName = attachment.fileName || `agent-media${extensionFromMimeType(dataUrl.mimeType)}`;
      return {
        bytes: dataUrl.bytes,
        mimeType: attachment.mimeType || dataUrl.mimeType,
        fileName,
        sendAsVoice: attachment.sendAsVoice || isVoiceMediaHint(attachment.mimeType || dataUrl.mimeType, fileName),
      };
    }

    if (attachment.url.startsWith("file://")) {
      const localPath = fileURLToPath(attachment.url);
      const bytes = fs.readFileSync(localPath);
      const fileName = attachment.fileName || path.basename(localPath);
      const mimeType = attachment.mimeType || inferMimeTypeFromFileName(fileName);
      return {
        bytes,
        mimeType,
        fileName,
        sendAsVoice: attachment.sendAsVoice || isVoiceMediaHint(mimeType, fileName),
      };
    }

    if (path.isAbsolute(attachment.url) && fs.existsSync(attachment.url)) {
      const bytes = fs.readFileSync(attachment.url);
      const fileName = attachment.fileName || path.basename(attachment.url);
      const mimeType = attachment.mimeType || inferMimeTypeFromFileName(fileName);
      return {
        bytes,
        mimeType,
        fileName,
        sendAsVoice: attachment.sendAsVoice || isVoiceMediaHint(mimeType, fileName),
      };
    }

    const relativeLocalPath = path.resolve(this.workspaceDir, attachment.url);
    if (fs.existsSync(relativeLocalPath) && fs.statSync(relativeLocalPath).isFile()) {
      const bytes = fs.readFileSync(relativeLocalPath);
      const fileName = attachment.fileName || path.basename(relativeLocalPath);
      const mimeType = attachment.mimeType || inferMimeTypeFromFileName(fileName);
      return {
        bytes,
        mimeType,
        fileName,
        sendAsVoice: attachment.sendAsVoice || isVoiceMediaHint(mimeType, fileName),
      };
    }

    const response = await fetch(attachment.url);
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`媒体下载失败：${response.status} ${response.statusText} ${text}`.trim());
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    const contentDispositionName = fileNameFromContentDisposition(response.headers.get("content-disposition"));
    const fileName = attachment.fileName || contentDispositionName || inferFileNameFromUrl(response.url || attachment.url, attachment.mimeType, 0);
    const mimeType = attachment.mimeType || response.headers.get("content-type")?.split(";")[0]?.trim() || inferMimeTypeFromFileName(fileName);
    return {
      bytes,
      mimeType,
      fileName,
      sendAsVoice: attachment.sendAsVoice || isVoiceMediaHint(mimeType, fileName),
    };
  }

  private async runAgentTurn(params: {
    accountId: string;
    peerId: string;
    provider: AgentProvider;
    prompt: string;
  }): Promise<void> {
    const session = this.store.getAgentSession(params.accountId, params.peerId, params.provider);
    const now = nowMs();
    const queuedJob: AgentJobRecord = {
      id: crypto.randomUUID(),
      accountId: params.accountId,
      peerId: params.peerId,
      provider: params.provider,
      sessionId: session?.sessionId ?? "",
      prompt: params.prompt,
      status: "running",
      responseText: "",
      error: "",
      createdAt: now,
      updatedAt: now,
    };
    this.store.saveAgentJob(queuedJob);
    const sessionRecord: AgentSessionRecord = {
      accountId: params.accountId,
      peerId: params.peerId,
      provider: params.provider,
      sessionId: session?.sessionId ?? "",
      status: "running",
      lastError: "",
      lastUsedAt: now,
      createdAt: session?.createdAt ?? now,
      updatedAt: now,
    };
    this.store.upsertAgentSession(sessionRecord);
    this.store.upsertAgentBinding({
      accountId: params.accountId,
      peerId: params.peerId,
      activeProvider: params.provider,
      activeSessionId: session?.sessionId ?? "",
      updatedAt: now,
    });
    this.logEvent("job_started", {
      provider: params.provider,
      accountId: params.accountId,
      peerId: params.peerId,
      sessionId: session?.sessionId ?? "",
      prompt: params.prompt,
      jobId: queuedJob.id,
    });

    try {
      const result = await this.executeTurn({
        provider: params.provider,
        accountId: params.accountId,
        peerId: params.peerId,
        prompt: params.prompt,
        sessionId: session?.sessionId ?? "",
      });
      const finishedAt = nowMs();
      this.store.upsertAgentSession({
        ...sessionRecord,
        sessionId: result.sessionId,
        status: "idle",
        lastError: "",
        lastUsedAt: finishedAt,
        updatedAt: finishedAt,
      });
      this.store.upsertAgentBinding({
        accountId: params.accountId,
        peerId: params.peerId,
        activeProvider: params.provider,
        activeSessionId: result.sessionId,
        updatedAt: finishedAt,
      });
      const resultSummary = summarizeAgentResult(result);
      this.store.saveAgentJob({
        ...queuedJob,
        sessionId: result.sessionId,
        status: "succeeded",
        responseText: resultSummary,
        error: "",
        updatedAt: finishedAt,
      });
      this.logEvent("job_succeeded", {
        provider: params.provider,
        accountId: params.accountId,
        peerId: params.peerId,
        sessionId: result.sessionId,
        jobId: queuedJob.id,
        responsePreview: resultSummary.slice(0, 800),
        responseLength: resultSummary.length,
        mediaCount: result.media.length,
      });
      if (result.reply.trim()) {
        await this.sendLongReply({
          accountId: params.accountId,
          peerId: params.peerId,
          text: result.reply,
        });
      }
      if (result.media.length) {
        await this.sendMediaReply({
          accountId: params.accountId,
          peerId: params.peerId,
          media: result.media,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failedAt = nowMs();
      this.store.upsertAgentSession({
        ...sessionRecord,
        status: "error",
        lastError: message,
        updatedAt: failedAt,
      });
      this.store.saveAgentJob({
        ...queuedJob,
        status: "failed",
        error: message,
        updatedAt: failedAt,
      });
      this.logEvent("job_failed", {
        provider: params.provider,
        accountId: params.accountId,
        peerId: params.peerId,
        sessionId: session?.sessionId ?? "",
        jobId: queuedJob.id,
        error: message,
      });
      await this.sendLongReply({
        accountId: params.accountId,
        peerId: params.peerId,
        text: `/${params.provider} 执行失败：${message}`,
      });
    }
  }

  private async executeTurn(params: {
    provider: AgentProvider;
    accountId: string;
    peerId: string;
    prompt: string;
    sessionId: string;
  }): Promise<AgentExecutionResult> {
    if (params.provider === "codex") {
      return this.executeCodexTurn(params);
    }
    if (params.provider === "claude") {
      return this.executeClaudeTurn(params);
    }
    return this.executeOpenClawTurn(params);
  }

  private async executeCodexTurn(params: {
    provider: AgentProvider;
    accountId: string;
    peerId: string;
    prompt: string;
    sessionId: string;
  }): Promise<AgentExecutionResult> {
    const config = this.store.getConfig();
    const workspace = resolveWorkspace("codex", config, this.workspaceDir);
    ensureWorkspaceDirectory(workspace, "codex");
    const startedAt = nowMs();
    const prompt = wrapProviderPrompt("codex", workspace, params.prompt);
    const args = params.sessionId
      ? ["-a", "never", "-s", "workspace-write", "exec", "resume", "--skip-git-repo-check", params.sessionId, prompt]
      : ["-a", "never", "-s", "workspace-write", "exec", "--skip-git-repo-check", prompt];
    const { stdout, stderr } = await execFileAsync("codex", args, {
      cwd: workspace,
      maxBuffer: 8 * 1024 * 1024,
    });
    this.logProviderRaw("codex", {
      provider: "codex",
      accountId: params.accountId,
      peerId: params.peerId,
      sessionId: params.sessionId,
    }, {
      workspace,
      args,
      stdout,
      stderr,
    });
    const resolvedSessionId = params.sessionId || findLatestCodexSession(workspace, startedAt)?.sessionId || "";
    if (!resolvedSessionId) {
      throw new Error(`Codex 未返回可恢复的会话 id。${stripAnsi(stderr || stdout)}`.trim());
    }
    const sessionFile = findCodexSessionFileById(resolvedSessionId);
    const reply = sessionFile ? parseCodexAssistantMessage(sessionFile) : stripAnsi(stdout);
    return {
      provider: "codex",
      sessionId: resolvedSessionId,
      reply: normalizeReply(reply, "Codex 已完成本轮处理，但没有返回可发送的文本。"),
      media: [],
    };
  }

  private async executeClaudeTurn(params: {
    provider: AgentProvider;
    accountId: string;
    peerId: string;
    prompt: string;
    sessionId: string;
  }): Promise<AgentExecutionResult> {
    const config = this.store.getConfig();
    const workspace = resolveWorkspace("claude", config, this.workspaceDir);
    ensureWorkspaceDirectory(workspace, "claude");
    const resolvedSessionId = params.sessionId || crypto.randomUUID();
    const prompt = wrapProviderPrompt("claude", workspace, params.prompt);
    const args = params.sessionId
      ? [
        "-p",
        "--output-format",
        "text",
        "--resume",
        params.sessionId,
        "--permission-mode",
        "plan",
        prompt,
      ]
      : [
        "-p",
        "--output-format",
        "text",
        "--session-id",
        resolvedSessionId,
        "--permission-mode",
        "plan",
        prompt,
      ];
    let stdout = "";
    let stderr = "";
    try {
      const result = await execFileAsync("claude", args, {
        cwd: workspace,
        maxBuffer: 8 * 1024 * 1024,
        timeout: 180_000,
      });
      stdout = result.stdout;
      stderr = result.stderr ?? "";
    } catch (error) {
      const execError = error as Error & { stdout?: string; stderr?: string };
      stdout = execError.stdout ?? "";
      stderr = execError.stderr ?? "";
      this.logProviderRaw("claude", {
        provider: "claude",
        accountId: params.accountId,
        peerId: params.peerId,
        sessionId: resolvedSessionId,
      }, {
        workspace,
        args,
        stdout,
        stderr,
        error: execError.message,
      });
      throw new Error(stripAnsi(stderr || stdout || execError.message || "Claude 执行失败"));
    }
    this.logProviderRaw("claude", {
      provider: "claude",
      accountId: params.accountId,
      peerId: params.peerId,
      sessionId: resolvedSessionId,
    }, {
      workspace,
      args,
      stdout,
      stderr,
    });
    return {
      provider: "claude",
      sessionId: resolvedSessionId,
      reply: normalizeReply(stdout, "Claude 已完成本轮处理，但没有返回可发送的文本。"),
      media: [],
    };
  }

  private async executeOpenClawTurn(params: {
    provider: AgentProvider;
    accountId: string;
    peerId: string;
    prompt: string;
    sessionId: string;
  }): Promise<AgentExecutionResult> {
    const config = this.store.getConfig();
    const runtime = await this.resolveOpenClawRuntime(config);
    const resolvedSessionId = params.sessionId || crypto.randomUUID();
    const startedAt = nowMs();
    const workspaceLabel = runtime.workspace || "(容器默认目录)";
    const prompt = wrapProviderPrompt("openclaw", workspaceLabel, params.prompt);
    const baseArgs = [
      "agent",
      "--json",
      "--session-id",
      resolvedSessionId,
      "--message",
      prompt,
      "--timeout",
      "180",
    ];
    const commandArgs = runtime.mode === "docker"
      ? [
        "exec",
        ...(runtime.workspace ? ["-w", runtime.workspace] : []),
        runtime.container,
        "openclaw",
        ...baseArgs,
      ]
      : baseArgs;
    const command = runtime.mode === "docker" ? "docker" : runtime.command;
    const cwd = runtime.mode === "docker"
      ? this.workspaceDir
      : runtime.workspace || this.workspaceDir;
    const { stdout, stderr } = await execFileAsync(command, commandArgs, {
      cwd,
      maxBuffer: 8 * 1024 * 1024,
    });
    this.logProviderRaw("openclaw", {
      provider: "openclaw",
      accountId: params.accountId,
      peerId: params.peerId,
      sessionId: resolvedSessionId,
    }, {
      mode: runtime.mode,
      workspace: workspaceLabel,
      dataDir: runtime.dataDir,
      container: runtime.mode === "docker" ? runtime.container : "",
      command: runtime.mode === "local" ? runtime.command : command,
      args: commandArgs,
      stdout,
      stderr,
    });
    const parsed = parseOpenClawResult(stdout);
    const fallbackMedia = parsed.media.length
      ? []
      : await this.collectOpenClawGeneratedMedia({
        runtime,
        sessionId: resolvedSessionId,
        startedAt,
      }).catch(() => []);
    return {
      provider: "openclaw",
      sessionId: resolvedSessionId,
      reply: parsed.reply,
      media: parsed.media.length ? parsed.media : fallbackMedia,
    };
  }

  private async collectOpenClawGeneratedMedia(params: {
    runtime: ResolvedOpenClawRuntime;
    sessionId: string;
    startedAt: number;
  }): Promise<AgentMediaAttachment[]> {
    const sessionLogPath = path.join(params.runtime.dataDir, "agents", "main", "sessions", `${params.sessionId}.jsonl`);
    const lines = await this.readOpenClawSessionLogLines(params.runtime, sessionLogPath);
    const attachments: AgentMediaAttachment[] = [];
    const seenPaths = new Set<string>();

    for (let index = lines.length - 1; index >= 0; index -= 1) {
      let parsedLine: OpenClawSessionLogEntry | null = null;
      try {
        parsedLine = JSON.parse(lines[index]) as OpenClawSessionLogEntry;
      } catch {
        continue;
      }
      if (!parsedLine?.timestamp || Date.parse(parsedLine.timestamp) + 1000 < params.startedAt) {
        continue;
      }
      if (parsedLine.type !== "message" || parsedLine.message?.role !== "toolResult" || parsedLine.message.toolName !== "exec") {
        continue;
      }

      const rawPayload = parsedLine.message.details?.aggregated
        || parsedLine.message.content?.find((item: { type?: string; text?: string }) => item.type === "text" && item.text)?.text
        || "";
      if (!rawPayload) {
        continue;
      }
      let toolJson: OpenClawExecToolPayload | null = null;
      try {
        toolJson = JSON.parse(rawPayload) as OpenClawExecToolPayload;
      } catch {
        continue;
      }
      const containerPath = toolJson?.output?.trim() ?? "";
      if (!containerPath || seenPaths.has(containerPath) || !isLikelyMediaPath(containerPath)) {
        continue;
      }
      seenPaths.add(containerPath);
      const copiedPath = await this.copyOpenClawMediaToHost(params.runtime, containerPath);
      attachments.push({
        url: copiedPath,
        mimeType: inferMimeTypeFromFileName(containerPath),
        fileName: path.basename(containerPath),
        sendAsVoice: isVoiceMediaHint(toolJson?.format ? `audio/${toolJson.format}` : "", containerPath),
      });
    }

    return attachments.reverse();
  }

  private async readOpenClawSessionLogLines(runtime: ResolvedOpenClawRuntime, sessionLogPath: string): Promise<string[]> {
    if (runtime.mode === "docker") {
      const { stdout } = await execFileAsync("docker", [
        "exec",
        runtime.container,
        "sh",
        "-lc",
        `tail -n 400 ${sessionLogPath}`,
      ], {
        cwd: this.workspaceDir,
        maxBuffer: 8 * 1024 * 1024,
      });
      return stdout.split("\n").filter(Boolean);
    }
    if (!fs.existsSync(sessionLogPath) || !fs.statSync(sessionLogPath).isFile()) {
      return [];
    }
    return fs.readFileSync(sessionLogPath, "utf-8").split("\n").filter(Boolean).slice(-400);
  }

  private resolveOpenClawLocalFilePath(runtime: Extract<ResolvedOpenClawRuntime, { mode: "local" }>, filePath: string): string {
    const trimmed = filePath.trim();
    if (!trimmed) {
      return trimmed;
    }
    if (trimmed.startsWith("~")) {
      return path.join(os.homedir(), trimmed.slice(1));
    }
    if (path.isAbsolute(trimmed)) {
      return trimmed;
    }
    const candidates = [
      path.resolve(runtime.workspace || this.workspaceDir, trimmed),
      path.resolve(runtime.dataDir, trimmed),
    ];
    return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0];
  }

  private async copyOpenClawMediaToHost(runtime: ResolvedOpenClawRuntime, sourcePath: string): Promise<string> {
    const targetDir = path.join(this.workspaceDir, "data", "openclaw-media");
    fs.mkdirSync(targetDir, { recursive: true });
    const fileName = path.basename(sourcePath);
    const targetPath = path.join(targetDir, `${crypto.randomUUID()}-${fileName}`);
    if (runtime.mode === "docker") {
      await execFileAsync("docker", [
        "cp",
        `${runtime.container}:${sourcePath}`,
        targetPath,
      ], {
        cwd: this.workspaceDir,
        maxBuffer: 8 * 1024 * 1024,
      });
      return targetPath;
    }
    const localSourcePath = this.resolveOpenClawLocalFilePath(runtime, sourcePath);
    if (!fs.existsSync(localSourcePath) || !fs.statSync(localSourcePath).isFile()) {
      throw new Error(`OpenClaw 本地媒体文件不存在：${localSourcePath}`);
    }
    fs.copyFileSync(localSourcePath, targetPath);
    return targetPath;
  }

  private logProviderRaw(provider: AgentProvider, context: AgentLogContext, payload: Record<string, unknown>): void {
    this.logEvent(`${provider}_raw`, {
      provider: context.provider,
      sessionId: context.sessionId,
      ...payload,
    });
  }

  private logEvent(event: string, payload: Record<string, unknown>): void {
    const entry = JSON.stringify({
      timestamp: new Date().toISOString(),
      event,
      ...payload,
    });
    fs.appendFileSync(this.logFilePath, `${entry}\n`, "utf-8");
    if (/(error|failed)/i.test(event)) {
      console.error(`[agent-router] ${entry}`);
    }
  }
}
