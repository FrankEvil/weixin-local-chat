import fs from "node:fs";
import path from "node:path";

import { AppServer } from "./server/http.js";
import { AuthService } from "./service/auth-service.js";
import { ChatService } from "./service/chat-service.js";
import { SqliteStore } from "./store/sqlite.js";
import type { ServerEvent } from "./types.js";

const workspaceDir = process.cwd();
const dbPath = path.join(workspaceDir, "data", "app.sqlite");
const builtPublicDir = path.join(workspaceDir, "dist", "public");
const fallbackPublicDir = path.join(workspaceDir, "public");
const publicDir = fs.existsSync(builtPublicDir) ? builtPublicDir : fallbackPublicDir;

let appServer: AppServer;
const store = new SqliteStore(dbPath);
const authService = new AuthService(store);

const service = new ChatService(
  store,
  workspaceDir,
  (event: ServerEvent) => appServer.emit(event),
);

appServer = new AppServer(service, authService, publicDir);

await service.init();
const startupSecrets = authService.init();

if (startupSecrets.generatedPassword) {
  console.log("[weixin-local-chat] 已生成初始登录密码，请妥善保存：");
  console.log(`[weixin-local-chat] admin password: ${startupSecrets.generatedPassword}`);
}

if (startupSecrets.generatedNotifyToken) {
  console.log("[weixin-local-chat] 已生成通知 token：");
  console.log(`[weixin-local-chat] notify token: ${startupSecrets.generatedNotifyToken}`);
}

const port = Number(process.env.PORT || 3100);
const server = appServer.createHttpServer();

server.listen(port, "127.0.0.1", () => {
  console.log(`[weixin-local-chat] listening on http://127.0.0.1:${port}`);
});
