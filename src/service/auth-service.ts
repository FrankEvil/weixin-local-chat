import crypto from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import { SqliteStore } from "../store/sqlite.js";
import type { AppConfig, AuthStatusPayload } from "../types.js";

const SESSION_COOKIE_NAME = "weixin_local_chat_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface SessionRecord {
  sessionId: string;
  createdAt: number;
  expiresAt: number;
}

function nowMs(): number {
  return Date.now();
}

function randomSecret(length = 24): string {
  return crypto.randomBytes(length).toString("base64url");
}

function hashPassword(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, 64).toString("hex");
}

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header?.trim()) {
    return {};
  }
  return Object.fromEntries(
    header.split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        if (index < 0) {
          return [part, ""];
        }
        return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      }),
  );
}

export class AuthService {
  private readonly sessions = new Map<string, SessionRecord>();

  constructor(private readonly store: SqliteStore) {}

  init(): { generatedPassword?: string; generatedNotifyToken?: string } {
    this.clearExpiredSessions();
    const generatedPassword = this.ensurePassword();
    const generatedNotifyToken = this.ensureNotifyToken();
    return {
      generatedPassword,
      generatedNotifyToken,
    };
  }

  getStatus(req: IncomingMessage): AuthStatusPayload {
    return {
      authenticated: this.isAuthenticated(req),
    };
  }

  isAuthenticated(req: IncomingMessage): boolean {
    const sessionId = this.readSessionId(req);
    if (!sessionId) {
      return false;
    }
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }
    if (session.expiresAt <= nowMs()) {
      this.sessions.delete(sessionId);
      return false;
    }
    session.expiresAt = nowMs() + SESSION_TTL_MS;
    return true;
  }

  login(password: string, res: ServerResponse): void {
    const normalized = password.trim();
    if (!normalized) {
      throw new Error("密码不能为空");
    }
    const credentials = this.store.getAuthCredentials();
    if (!credentials.passwordHash || !credentials.passwordSalt) {
      throw new Error("管理员密码尚未初始化，请重启服务");
    }
    const expectedHash = hashPassword(normalized, credentials.passwordSalt);
    const left = Buffer.from(expectedHash, "hex");
    const right = Buffer.from(credentials.passwordHash, "hex");
    if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) {
      throw new Error("密码错误");
    }
    const sessionId = crypto.randomUUID();
    this.sessions.set(sessionId, {
      sessionId,
      createdAt: nowMs(),
      expiresAt: nowMs() + SESSION_TTL_MS,
    });
    this.writeSessionCookie(res, sessionId);
  }

  logout(req: IncomingMessage, res: ServerResponse): void {
    const sessionId = this.readSessionId(req);
    if (sessionId) {
      this.sessions.delete(sessionId);
    }
    this.clearSessionCookie(res);
  }

  changePassword(req: IncomingMessage, res: ServerResponse, currentPassword: string, newPassword: string): void {
    if (!this.isAuthenticated(req)) {
      throw new Error("未登录");
    }
    const nextPassword = newPassword.trim();
    if (nextPassword.length < 8) {
      throw new Error("新密码至少 8 位");
    }
    const credentials = this.store.getAuthCredentials();
    const currentHash = hashPassword(currentPassword.trim(), credentials.passwordSalt);
    const left = Buffer.from(currentHash, "hex");
    const right = Buffer.from(credentials.passwordHash, "hex");
    if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) {
      throw new Error("当前密码不正确");
    }
    const salt = randomSecret(16);
    const updatedAt = nowMs();
    this.store.saveAuthCredentials({
      passwordHash: hashPassword(nextPassword, salt),
      passwordSalt: salt,
      passwordUpdatedAt: updatedAt,
    });
    this.sessions.clear();
    const sessionId = crypto.randomUUID();
    this.sessions.set(sessionId, {
      sessionId,
      createdAt: updatedAt,
      expiresAt: updatedAt + SESSION_TTL_MS,
    });
    this.writeSessionCookie(res, sessionId);
  }

  regenerateNotifyToken(): AppConfig {
    const config = this.store.getConfig();
    const nextConfig = {
      ...config,
      notifyToken: randomSecret(24),
    };
    this.store.saveConfig(nextConfig);
    return this.store.getConfig();
  }

  verifyNotifyToken(req: IncomingMessage): boolean {
    const config = this.store.getConfig();
    const expected = config.notifyToken.trim();
    if (!expected) {
      return false;
    }
    const authorization = String(req.headers.authorization ?? "");
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    return match?.[1]?.trim() === expected;
  }

  private ensurePassword(): string | undefined {
    const credentials = this.store.getAuthCredentials();
    if (credentials.passwordHash && credentials.passwordSalt) {
      return undefined;
    }
    const generatedPassword = randomSecret(12);
    const salt = randomSecret(16);
    this.store.saveAuthCredentials({
      passwordHash: hashPassword(generatedPassword, salt),
      passwordSalt: salt,
      passwordUpdatedAt: nowMs(),
    });
    return generatedPassword;
  }

  private ensureNotifyToken(): string | undefined {
    const config = this.store.getConfig();
    if (config.notifyToken.trim()) {
      return undefined;
    }
    const generatedNotifyToken = randomSecret(24);
    this.store.saveConfig({
      ...config,
      notifyToken: generatedNotifyToken,
    });
    return generatedNotifyToken;
  }

  private readSessionId(req: IncomingMessage): string {
    return parseCookies(req.headers.cookie)[SESSION_COOKIE_NAME] ?? "";
  }

  private writeSessionCookie(res: ServerResponse, sessionId: string): void {
    res.setHeader("Set-Cookie", `${SESSION_COOKIE_NAME}=${encodeURIComponent(sessionId)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`);
  }

  private clearSessionCookie(res: ServerResponse): void {
    res.setHeader("Set-Cookie", `${SESSION_COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
  }

  private clearExpiredSessions(): void {
    const threshold = nowMs();
    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.expiresAt <= threshold) {
        this.sessions.delete(sessionId);
      }
    }
  }
}
