import fs from "node:fs";
import path from "node:path";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { EventEmitter } from "node:events";
import { URL } from "node:url";

import { ChatService } from "../service/chat-service.js";
import { AuthService } from "../service/auth-service.js";
import type { AppConfig, DebugLogQuery, DebugLogSource, ServerEvent } from "../types.js";

function json(res: ServerResponse, statusCode: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function text(res: ServerResponse, statusCode: number, payload: string, contentType = "text/plain; charset=utf-8"): void {
  res.writeHead(statusCode, {
    "Content-Type": contentType,
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function unauthorized(res: ServerResponse, message: string): void {
  json(res, 401, {
    ok: false,
    error: message,
  });
}

async function readJson<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const body = Buffer.concat(chunks).toString("utf-8");
  return (body ? JSON.parse(body) : {}) as T;
}

async function readBodyBuffer(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function parseBoolean(value: string | undefined): boolean {
  return value === "true" || value === "1" || value === "yes" || value === "on";
}

function decodeMultipartFilename(fileName: string): string {
  const normalized = fileName.trim();
  if (!normalized) return "upload.bin";
  return path.basename(Buffer.from(normalized, "latin1").toString("utf-8"));
}

function parseMultipartForm(body: Buffer, contentType: string): {
  fields: Record<string, string>;
  file: { fieldName: string; fileName: string; mimeType: string; bytes: Buffer } | null;
} {
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  const boundary = boundaryMatch?.[1] ?? boundaryMatch?.[2];
  if (!boundary) {
    throw new Error("multipart/form-data 缺少 boundary");
  }

  const marker = `--${boundary}`;
  const raw = body.toString("latin1");
  const parts = raw.split(marker);
  const fields: Record<string, string> = {};
  let file: { fieldName: string; fileName: string; mimeType: string; bytes: Buffer } | null = null;

  for (const part of parts) {
    if (!part || part === "--" || part === "--\r\n") {
      continue;
    }

    let normalized = part;
    if (normalized.startsWith("\r\n")) normalized = normalized.slice(2);
    if (normalized.endsWith("\r\n")) normalized = normalized.slice(0, -2);
    if (normalized.endsWith("--")) normalized = normalized.slice(0, -2);
    if (!normalized) continue;

    const headerEnd = normalized.indexOf("\r\n\r\n");
    if (headerEnd < 0) continue;

    const headerText = normalized.slice(0, headerEnd);
    const bodyText = normalized.slice(headerEnd + 4);
    const headers = Object.fromEntries(
      headerText
        .split("\r\n")
        .map((line) => {
          const index = line.indexOf(":");
          if (index < 0) return ["", ""];
          return [line.slice(0, index).trim().toLowerCase(), line.slice(index + 1).trim()];
        })
        .filter(([key]) => key),
    );

    const disposition = headers["content-disposition"] ?? "";
    const nameMatch = disposition.match(/name="([^"]+)"/i);
    const fileNameMatch = disposition.match(/filename="([^"]*)"/i);
    const fieldName = nameMatch?.[1];
    if (!fieldName) continue;

    const bytes = Buffer.from(bodyText, "latin1");
    if (fileNameMatch && fileNameMatch[1]) {
      file = {
        fieldName,
        fileName: decodeMultipartFilename(fileNameMatch[1]),
        mimeType: headers["content-type"] || "application/octet-stream",
        bytes,
      };
      continue;
    }

    fields[fieldName] = bytes.toString("utf-8");
  }

  return { fields, file };
}

function guessContentType(filePath: string): string {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".js") || filePath.endsWith(".mjs")) return "application/javascript; charset=utf-8";
  if (filePath.endsWith(".json")) return "application/json; charset=utf-8";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  if (filePath.endsWith(".png")) return "image/png";
  if (filePath.endsWith(".jpg") || filePath.endsWith(".jpeg")) return "image/jpeg";
  if (filePath.endsWith(".gif")) return "image/gif";
  if (filePath.endsWith(".webp")) return "image/webp";
  if (filePath.endsWith(".ico")) return "image/x-icon";
  if (filePath.endsWith(".woff2")) return "font/woff2";
  if (filePath.endsWith(".wasm")) return "application/wasm";
  return "application/octet-stream";
}

function serveFile(res: ServerResponse, filePath: string): void {
  if (!fs.existsSync(filePath)) {
    text(res, 404, "Not Found");
    return;
  }
  const stat = fs.statSync(filePath);
  res.writeHead(200, {
    "Content-Type": guessContentType(filePath),
    "Content-Length": stat.size,
  });
  fs.createReadStream(filePath).pipe(res);
}

function normalizeConfig(body: Partial<AppConfig>): AppConfig {
  return {
    baseUrl: body.baseUrl ?? "",
    cdnBaseUrl: body.cdnBaseUrl ?? "",
    botType: body.botType ?? "3",
    notifyToken: body.notifyToken ?? "",
    defaultNotifyAccountId: body.defaultNotifyAccountId ?? "",
    defaultNotifyPeerId: body.defaultNotifyPeerId ?? "",
    defaultWorkspace: body.defaultWorkspace ?? "",
    codexWorkspace: body.codexWorkspace ?? "",
    claudeWorkspace: body.claudeWorkspace ?? "",
    openclawMode: body.openclawMode ?? "auto",
    openclawWorkspace: body.openclawWorkspace ?? "",
    openclawCommand: body.openclawCommand ?? "",
    openclawDataDir: body.openclawDataDir ?? "",
    openclawContainer: body.openclawContainer ?? "",
  };
}

function resolveStaticAsset(publicDir: string, pathname: string): string {
  if (pathname === "/") {
    return path.join(publicDir, "index.html");
  }
  const decoded = decodeURIComponent(pathname);
  const normalized = path.normalize(path.join(publicDir, decoded.replace(/^\//, "")));
  const relative = path.relative(publicDir, normalized);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return "";
  }
  if (!fs.existsSync(normalized) || !fs.statSync(normalized).isFile()) {
    return "";
  }
  return normalized;
}

function parseDebugLogQuery(url: URL): DebugLogQuery {
  const source = (url.searchParams.get("logSource") ?? "all") as DebugLogSource;
  const level = (url.searchParams.get("logLevel") ?? "all") as DebugLogQuery["level"];
  const keyword = url.searchParams.get("logKeyword") ?? "";
  const rawLimit = (url.searchParams.get("logLimit") ?? "all").trim().toLowerCase();
  const limit = rawLimit === "all"
    ? "all"
    : Number.isFinite(Number(rawLimit)) && Number(rawLimit) > 0
      ? Number(rawLimit)
      : "all";
  return { source, level, keyword, limit };
}

function isStaticRequest(method: string, pathname: string): boolean {
  return method === "GET" && !pathname.startsWith("/api/");
}

function isPublicApiRequest(method: string, pathname: string): boolean {
  return (method === "GET" && pathname === "/api/health")
    || (method === "GET" && pathname === "/api/auth/status")
    || (method === "POST" && pathname === "/api/auth/login")
    || (method === "POST" && pathname === "/api/notify");
}

export class AppServer {
  private readonly eventEmitter = new EventEmitter();
  private readonly sseClients = new Set<ServerResponse>();

  constructor(
    private readonly service: ChatService,
    private readonly authService: AuthService,
    private readonly publicDir: string,
  ) {}

  emit(event: ServerEvent): void {
    this.eventEmitter.emit("event", event);
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    for (const client of this.sseClients) {
      client.write(payload);
    }
  }

  createHttpServer() {
    return createServer(async (req, res) => {
      try {
        await this.handle(req, res);
      } catch (error) {
        console.error("[http]", error);
        json(res, 500, {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const method = req.method ?? "GET";
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const pathname = url.pathname;

    if (!isStaticRequest(method, pathname) && pathname.startsWith("/api/")) {
      if (method === "POST" && pathname === "/api/notify") {
        if (!this.authService.verifyNotifyToken(req)) {
          unauthorized(res, "通知 token 无效");
          return;
        }
      } else if (!isPublicApiRequest(method, pathname) && !this.authService.isAuthenticated(req)) {
        unauthorized(res, "请先登录");
        return;
      }
    }

    if (method === "GET" && pathname === "/api/health") {
      json(res, 200, { ok: true, message: "服务可用" });
      return;
    }

    if (method === "GET" && pathname === "/api/auth/status") {
      json(res, 200, this.authService.getStatus(req));
      return;
    }

    if (method === "POST" && pathname === "/api/auth/login") {
      const body = await readJson<{ password: string }>(req);
      this.authService.login(body.password ?? "", res);
      json(res, 200, { ok: true });
      return;
    }

    if (method === "POST" && pathname === "/api/auth/logout") {
      this.authService.logout(req, res);
      json(res, 200, { ok: true });
      return;
    }

    if (method === "POST" && pathname === "/api/auth/password") {
      const body = await readJson<{ currentPassword: string; newPassword: string }>(req);
      this.authService.changePassword(req, res, body.currentPassword ?? "", body.newPassword ?? "");
      json(res, 200, { ok: true });
      return;
    }

    if (method === "POST" && pathname === "/api/auth/notify-token/regenerate") {
      json(res, 200, this.authService.regenerateNotifyToken());
      return;
    }

    if (method === "GET" && pathname === "/api/bootstrap") {
      json(res, 200, this.service.getBootstrap());
      return;
    }

    if (method === "GET" && pathname === "/api/runtime/diagnostics") {
      json(res, 200, await this.service.getRuntimeDiagnostics());
      return;
    }

    if (method === "GET" && pathname === "/api/config") {
      json(res, 200, this.service.getConfig());
      return;
    }

    if (method === "POST" && pathname === "/api/config") {
      const body = await readJson<Partial<AppConfig>>(req);
      json(res, 200, this.service.saveConfig(normalizeConfig({
        ...this.service.getConfig(),
        ...body,
      })));
      return;
    }

    if (method === "POST" && pathname === "/api/config/validate") {
      const body = await readJson<Partial<AppConfig>>(req);
      json(res, 200, await this.service.validateConfig(normalizeConfig({
        ...this.service.getConfig(),
        ...body,
      })));
      return;
    }

    if (method === "GET" && pathname === "/api/accounts") {
      json(res, 200, this.service.listAccounts());
      return;
    }

    if (method === "POST" && pathname === "/api/accounts/select") {
      const body = await readJson<{ accountId: string }>(req);
      json(res, 200, this.service.selectAccount(body.accountId));
      return;
    }

    if (method === "POST" && pathname === "/api/accounts/update") {
      const body = await readJson<{ accountId: string; displayName: string }>(req);
      json(res, 200, this.service.renameAccount(body.accountId, body.displayName));
      return;
    }

    if (method === "POST" && pathname === "/api/accounts/history/clear") {
      const body = await readJson<{ accountId: string }>(req);
      json(res, 200, this.service.clearAccountHistory(body.accountId));
      return;
    }

    if (method === "POST" && pathname === "/api/accounts/delete") {
      const body = await readJson<{ accountId: string }>(req);
      this.service.deleteAccount(body.accountId);
      json(res, 200, { ok: true });
      return;
    }

    if (method === "POST" && pathname === "/api/login/start") {
      json(res, 200, await this.service.startLogin());
      return;
    }

    if (method === "GET" && pathname === "/api/login/session") {
      const sessionKey = url.searchParams.get("sessionKey") ?? "";
      json(res, 200, await this.service.pollLogin(sessionKey));
      return;
    }

    if (method === "GET" && pathname === "/api/conversations") {
      const accountId = url.searchParams.get("accountId") ?? "";
      json(res, 200, this.service.listConversations(accountId));
      return;
    }

    if (method === "POST" && pathname === "/api/conversations/open") {
      const body = await readJson<{ accountId: string; peerId: string }>(req);
      json(res, 200, this.service.openConversation(body.accountId, body.peerId));
      return;
    }

    if (method === "POST" && pathname === "/api/conversations/read") {
      const body = await readJson<{ accountId: string; peerId: string }>(req);
      this.service.markConversationRead(body.accountId, body.peerId);
      json(res, 200, { ok: true });
      return;
    }

    if (method === "GET" && pathname === "/api/status") {
      const accountId = url.searchParams.get("accountId") ?? "";
      json(res, 200, this.service.getAccountStatus(accountId));
      return;
    }

    if (method === "GET" && pathname === "/api/messages") {
      const accountId = url.searchParams.get("accountId") ?? "";
      const peerId = url.searchParams.get("peerId") ?? "";
      const beforeCreatedAt = Number(url.searchParams.get("before") ?? "0");
      const limit = Number(url.searchParams.get("limit") ?? "60");
      json(res, 200, this.service.listMessages(
        accountId,
        peerId,
        Number.isFinite(beforeCreatedAt) ? beforeCreatedAt : 0,
        Number.isFinite(limit) && limit > 0 ? limit : 60,
      ));
      return;
    }

    if (method === "GET" && pathname === "/api/messages/count") {
      const accountId = url.searchParams.get("accountId") ?? "";
      const peerId = url.searchParams.get("peerId") ?? "";
      json(res, 200, { total: this.service.countMessages(accountId, peerId) });
      return;
    }

    if (method === "GET" && pathname === "/api/messages/search") {
      const accountId = url.searchParams.get("accountId") ?? "";
      const peerId = url.searchParams.get("peerId") ?? "";
      const q = url.searchParams.get("q") ?? "";
      json(res, 200, this.service.searchMessages(accountId, q, peerId));
      return;
    }

    if (method === "POST" && pathname === "/api/messages/text") {
      const body = await readJson<{ accountId: string; peerId: string; text: string }>(req);
      json(res, 200, await this.service.sendText(body));
      return;
    }

    if (method === "POST" && pathname === "/api/messages/media") {
      const requestContentType = String(req.headers["content-type"] ?? "");
      if (requestContentType.includes("multipart/form-data")) {
        const multipart = parseMultipartForm(await readBodyBuffer(req), requestContentType);
        if (!multipart.file) {
          json(res, 400, { ok: false, error: "未检测到上传文件" });
          return;
        }
        json(res, 200, await this.service.sendMedia({
          accountId: multipart.fields.accountId ?? "",
          peerId: multipart.fields.peerId ?? "",
          fileName: multipart.file.fileName,
          mimeType: multipart.file.mimeType,
          bytes: multipart.file.bytes,
          caption: multipart.fields.caption ?? "",
          sendAsVoice: parseBoolean(multipart.fields.sendAsVoice),
        }));
        return;
      }

      const body = await readJson<{
        accountId: string;
        peerId: string;
        fileName: string;
        mimeType: string;
        bytesBase64?: string;
        caption: string;
        sendAsVoice?: boolean;
      }>(req);
      json(res, 200, await this.service.sendMedia(body));
      return;
    }

    if (method === "POST" && pathname === "/api/notify") {
      const queryPayload = {
        accountId: url.searchParams.get("accountId") ?? undefined,
        title: url.searchParams.get("title") ?? undefined,
      };
      const requestContentType = String(req.headers["content-type"] ?? "");
      if (requestContentType.includes("application/json")) {
        const body = await readJson<{ accountId?: string; title?: string; content?: string; text?: string }>(req);
        json(res, 200, await this.service.sendNotification({
          ...queryPayload,
          ...body,
        }));
        return;
      }
      const body = (await readBodyBuffer(req)).toString("utf-8");
      json(res, 200, await this.service.sendNotification({
        ...queryPayload,
        text: body,
      }));
      return;
    }

    if (method === "GET" && pathname.startsWith("/api/media/")) {
      const messageId = pathname.slice("/api/media/".length);
      const media = await this.service.getMediaFile(messageId);
      if (!media) {
        text(res, 404, "媒体文件不存在");
        return;
      }
      const stat = fs.statSync(media.path);
      res.writeHead(200, {
        "Content-Type": media.mimeType,
        "Content-Disposition": `inline; filename="${encodeURIComponent(media.fileName)}"`,
        "Content-Length": stat.size,
      });
      fs.createReadStream(media.path).pipe(res);
      return;
    }

    if (method === "GET" && pathname === "/api/export/conversation") {
      const accountId = url.searchParams.get("accountId") ?? "";
      const peerId = url.searchParams.get("peerId") ?? "";
      const payload = this.service.exportConversation(accountId, peerId);
      const body = JSON.stringify(payload, null, 2);
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(`conversation-${peerId || "unknown"}.json`)}"`,
        "Content-Length": Buffer.byteLength(body),
      });
      res.end(body);
      return;
    }

    if (method === "GET" && pathname === "/api/debug") {
      const accountId = url.searchParams.get("accountId") ?? "";
      json(res, 200, this.service.getDebugSnapshot(accountId, parseDebugLogQuery(url)));
      return;
    }

    if (method === "POST" && pathname === "/api/debug/logs/clear") {
      const body = await readJson<{ source?: DebugLogSource }>(req);
      this.service.clearDebugLogs(body.source ?? "all");
      json(res, 200, { ok: true });
      return;
    }

    if (method === "GET" && pathname === "/api/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write(`data: ${JSON.stringify({ type: "bootstrap" })}\n\n`);
      this.sseClients.add(res);
      req.on("close", () => {
        this.sseClients.delete(res);
      });
      return;
    }

    if (method === "GET" && !pathname.startsWith("/api/")) {
      const assetPath = resolveStaticAsset(this.publicDir, pathname);
      if (assetPath) {
        serveFile(res, assetPath);
        return;
      }
      serveFile(res, path.join(this.publicDir, "index.html"));
      return;
    }

    text(res, 404, "Not Found");
  }
}
