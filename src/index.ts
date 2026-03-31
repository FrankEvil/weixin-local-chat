import fs from "node:fs";
import path from "node:path";

import { AppServer } from "./server/http.js";
import { ChatService } from "./service/chat-service.js";
import { SqliteStore } from "./store/sqlite.js";
import type { ServerEvent } from "./types.js";

const workspaceDir = process.cwd();
const dbPath = path.join(workspaceDir, "data", "app.sqlite");
const builtPublicDir = path.join(workspaceDir, "dist", "public");
const fallbackPublicDir = path.join(workspaceDir, "public");
const publicDir = fs.existsSync(builtPublicDir) ? builtPublicDir : fallbackPublicDir;

let appServer: AppServer;

const service = new ChatService(
  new SqliteStore(dbPath),
  workspaceDir,
  (event: ServerEvent) => appServer.emit(event),
);

appServer = new AppServer(service, publicDir);

await service.init();

const port = Number(process.env.PORT || 3100);
const server = appServer.createHttpServer();

server.listen(port, "127.0.0.1", () => {
  console.log(`[weixin-local-chat] listening on http://127.0.0.1:${port}`);
});
