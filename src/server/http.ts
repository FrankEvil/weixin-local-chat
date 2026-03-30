import fs from "node:fs";
import path from "node:path";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { EventEmitter } from "node:events";
import { URL } from "node:url";

import { ChatService } from "../service/chat-service.js";
import type { ServerEvent } from "../types.js";

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

async function readJson<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const body = Buffer.concat(chunks).toString("utf-8");
  return (body ? JSON.parse(body) : {}) as T;
}

function guessContentType(filePath: string): string {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (filePath.endsWith(".png")) return "image/png";
  if (filePath.endsWith(".jpg") || filePath.endsWith(".jpeg")) return "image/jpeg";
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

export class AppServer {
  private readonly eventEmitter = new EventEmitter();
  private readonly sseClients = new Set<ServerResponse>();

  constructor(
    private readonly service: ChatService,
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
        json(res, 500, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const method = req.method ?? "GET";
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const pathname = url.pathname;

    if (method === "GET" && pathname === "/api/health") {
      json(res, 200, { ok: true, message: "服务可用" });
      return;
    }

    if (method === "GET" && pathname === "/api/bootstrap") {
      json(res, 200, this.service.getBootstrap());
      return;
    }

    if (method === "GET" && pathname === "/api/config") {
      json(res, 200, this.service.getConfig());
      return;
    }

    if (method === "POST" && pathname === "/api/config") {
      const body = await readJson<{
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
      }>(req);
      json(res, 200, this.service.saveConfig({
        baseUrl: body.baseUrl ?? "",
        cdnBaseUrl: body.cdnBaseUrl ?? "",
        botType: body.botType ?? "3",
        defaultWorkspace: body.defaultWorkspace ?? "",
        codexWorkspace: body.codexWorkspace ?? "",
        claudeWorkspace: body.claudeWorkspace ?? "",
        openclawMode: body.openclawMode ?? "auto",
        openclawWorkspace: body.openclawWorkspace ?? "",
        openclawCommand: body.openclawCommand ?? "",
        openclawDataDir: body.openclawDataDir ?? "",
        openclawContainer: body.openclawContainer ?? "",
      }));
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
      json(res, 200, this.service.listMessages(accountId, peerId));
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
      const body = await readJson<{
        accountId: string;
        peerId: string;
        fileName: string;
        mimeType: string;
        bytesBase64: string;
        caption: string;
        sendAsVoice?: boolean;
      }>(req);
      json(res, 200, await this.service.sendMedia(body));
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
      json(res, 200, this.service.getDebugSnapshot(accountId));
      return;
    }

    if (method === "GET" && pathname === "/api/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write("data: " + JSON.stringify({ type: "bootstrap" }) + "\n\n");
      this.sseClients.add(res);
      req.on("close", () => {
        this.sseClients.delete(res);
      });
      return;
    }

    if (method === "GET" && pathname === "/") {
      serveFile(res, path.join(this.publicDir, "index.html"));
      return;
    }

    if (method === "GET" && (pathname === "/app.css" || pathname === "/app.js")) {
      serveFile(res, path.join(this.publicDir, pathname.slice(1)));
      return;
    }

    text(res, 404, "Not Found");
  }
}
