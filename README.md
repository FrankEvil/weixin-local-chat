# 微信本地工作台 (WeChat Local Chat)

<div align="center">

[English](./README_EN.md) | 中文

</div>

## 📖 项目简介

微信本地工作台是一款本地部署的微信聊天聚合服务，支持多账号管理、实时消息收发、AI Agent 集成等功能。通过微信上游接口（ilink API）实现消息的接收与发送，提供直观的 Web 界面进行管理。

## ✨ 主要功能

### 🎯 核心功能
- **多账号管理**：支持同时管理多个微信账号，独立会话与消息
- **实时消息同步**：基于 SSE（Server-Sent Events）实现消息实时推送
- **多媒体支持**：文本、图片、视频、语音、文件等多种消息类型
- **会话搜索**：支持按关键词搜索历史消息
- **数据导出**：支持导出会话记录

### 🤖 Agent 集成

支持三种 AI Agent 模式，通过微信消息中的指令触发。Agent 可以理解上下文、执行代码、生成媒体内容，并将结果自动发送回微信。

#### /codex - Codex Agent

代码生成与编辑助手，基于 OpenAI Codex CLI。

**使用方式**：
- `/codex <prompt>` - 发送新任务给 Codex
- `/codex` - 切换到 Codex 模式，后续普通消息自动转发
- `/exit` - 退出 Agent 模式

**特性**：
- 自动恢复会话：支持多轮对话，自动追踪会话 ID
- 工作目录：在指定目录下执行代码操作
- 智能分段：长回复自动按段落拆分，避免微信消息长度限制
- 会话持久化：会话记录保存在 `~/.codex/sessions/` 目录

**示例**：
```
/codex 帮我写一个 Python 脚本，统计当前目录下所有文件的行数
```

#### /claude - Claude Agent

对话与分析助手，基于 Anthropic Claude CLI。

**使用方式**：
- `/claude <prompt>` - 发送新任务给 Claude
- `/claude` - 切换到 Claude 模式，后续普通消息自动转发
- `/exit` - 退出 Agent 模式

**特性**：
- 会话恢复：支持 `--resume` 恢复历史会话
- 计划模式：默认使用 `plan` 权限模式，安全执行
- 超时控制：单次执行最长 180 秒
- 智能解析：自动提取 Claude 输出中的有效文本

**示例**：
```
/claude 分析这段代码的性能问题：function fibonacci(n) { return n <= 1 ? n : fibonacci(n-1) + fibonacci(n-2); }
```

#### /openclaw - OpenClaw Agent

支持 auto / local / docker 三种运行模式的通用 Agent。

**使用方式**：
- `/openclaw <prompt>` - 发送任务给 OpenClaw
- `/openclaw` - 切换到 OpenClaw 模式

**运行模式**：
- `auto` - 自动检测本地命令或 Docker 容器
- `local` - 使用本地安装的 `openclaw` CLI
- `docker` - 通过 Docker 容器执行

**特性**：
- 媒体生成：支持生成图片、语音、视频等媒体内容
- 自动发送：生成的媒体文件自动发送到微信
- 容器化支持：可在 Docker 中运行，无需本地安装

### 📢 通知系统

支持通过外部 API 发送通知消息到微信，适用于监控告警、任务完成提醒等场景。

#### 配置步骤

1. 首次启动时，控制台会显示 notify token：
   ```
   [weixin-local-chat] notify token: <your-token>
   ```

2. 在「设置」中配置：
   - **默认通知账号**：选择接收通知的微信账号
   - **默认通知会话**：选择接收通知的会话（可选，默认使用最新会话）

#### API 调用

**端点**：`POST /api/notify`

**请求头**：
```
Authorization: Bearer <your-notify-token>
Content-Type: application/json
```

**请求体**：
```json
{
  "title": "告警标题",
  "content": "通知内容详情",
  "accountId": "可选，指定接收通知的账号 ID"
}
```

**响应**：
```json
{
  "ok": true,
  "data": {
    "id": "message-id",
    "content": "格式化后的通知文本"
  }
}
```

#### 通知格式

通知消息会自动格式化，包含：
- 🎨 智能图标：根据标题关键词自动选择图标（⚠️告警、❌错误、✅成功、ℹ️信息）
- 📝 标题与内容：结构化显示
- 🕐 时间戳：自动添加发送时间

**示例效果**：
```
⚠️ 【服务器告警】
CPU 使用率超过 90%，请及时处理
━━━━━━━━━━━━
🕐 2025/01/01 12:30:00
```

#### 使用场景

- **监控告警**：Prometheus、Grafana 等监控系统触发告警时发送通知
- **CI/CD 通知**：构建完成、部署成功等事件通知
- **定时任务**：Cron 任务执行完成后的结果通知
- **Webhook 回调**：接收第三方服务的 Webhook 并转发到微信

### 🎨 用户体验
- **深色/浅色主题**：支持主题切换，自动适配系统偏好
- **响应式设计**：适配桌面与移动端
- **调试面板**：实时查看同步状态、Agent 绑定、运行日志

## 🛠️ 技术栈

### 后端
- **Runtime**: Node.js >= 18
- **Language**: TypeScript
- **Database**: SQLite (better-sqlite3)
- **API**: RESTful + SSE (Server-Sent Events)

### 前端
- **Framework**: Vue 3 (Composition API)
- **State Management**: Pinia
- **UI Library**: Naive UI
- **Build Tool**: Vite

## 📦 安装与配置

### 前置要求
- Node.js >= 18
- npm 或 yarn

### 安装步骤

```bash
# 克隆项目
git clone https://github.com/your-username/weixin-local-chat.git
cd weixin-local-chat

# 安装依赖
npm install

# 构建项目
npm run build

# 启动服务
npm start
```

### 开发模式

```bash
# 启动前端开发服务器（支持热重载）
npm run dev:web

# 启动后端服务（需另开终端）
npm run build:server && npm start
```

### 配置说明

服务启动后，访问 `http://127.0.0.1:3100` 打开 Web 界面。

首次启动会自动生成管理员密码，请在控制台查看：
```
[weixin-local-chat] admin password: <your-password>
[weixin-local-chat] notify token: <your-token>
```

登录后可在「设置」中：
- 修改管理员密码
- 配置微信 API 地址（默认 `https://ilinkai.weixin.qq.com`）
- 配置 Agent 工作目录
- 管理通知 Token

### 🐳 Docker 部署

#### 前置要求
- Docker >= 20.10
- Docker Compose >= 2.0

#### 使用 Docker Compose（推荐）

```bash
# 克隆项目
git clone https://github.com/your-username/weixin-local-chat.git
cd weixin-local-chat

# 启动服务
docker-compose up -d

# 查看日志
docker-compose logs -f

# 停止服务
docker-compose down
```

#### 使用 Docker 命令

```bash
# 构建镜像
docker build -t weixin-local-chat .

# 运行容器
docker run -d \
  --name weixin-local-chat \
  -p 3100:3100 \
  -v $(pwd)/data:/app/data \
  weixin-local-chat

# 查看日志
docker logs -f weixin-local-chat

# 停止容器
docker stop weixin-local-chat
```

#### 环境变量

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `NODE_ENV` | `production` | 运行环境 |
| `HOST` | `0.0.0.0` | 服务绑定地址 |
| `PORT` | `3100` | 服务端口 |

#### 数据持久化

Docker 部署时，所有数据存储在 `./data` 目录（挂载到容器内的 `/app/data`）：
- `weixin.db` - SQLite 数据库
- `media/` - 媒体文件缓存

#### 健康检查

容器内置健康检查，每 30 秒检查一次服务状态：

```bash
# 查看容器健康状态
docker inspect --format='{{.State.Health.Status}}' weixin-local-chat
```

## 🚀 使用指南

### 扫码登录
1. 点击「扫码登录」按钮
2. 使用手机微信扫描二维码
3. 确认登录后等待账号同步

### 发送消息
1. 在左侧账号面板选择目标账号
2. 在会话列表选择或新建会话
3. 在底部输入框输入消息内容
4. 点击「发送」或按 Enter 发送

### Agent 指令

在微信消息输入框中输入指令即可触发 Agent。

#### 基本用法

```
/codex 帮我写一个 Python 脚本
/claude 分析这段代码的性能问题
/openclaw 生成一张风景图片
```

#### 模式切换

```
/codex        # 切换到 Codex 模式，后续消息自动转发给 Codex
/claude       # 切换到 Claude 模式
/openclaw     # 切换到 OpenClaw 模式
/exit         # 退出 Agent 模式
```

#### 多轮对话

Agent 会自动追踪会话上下文，支持多轮对话：
```
/codex 写一个排序算法
# Codex 返回代码后，直接发送：
时间复杂度是多少？
# Agent 会基于上文继续回答
```

#### 媒体附件

发送消息时附带图片、文件等，Agent 可以处理这些附件：
```
/openclaw 帮我分析这张图片的内容
# 同时发送一张图片
```

### 通知 API

通过外部 API 发送通知到微信：

```bash
curl -X POST http://127.0.0.1:3100/api/notify \
  -H "Authorization: Bearer <your-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "部署完成",
    "content": "项目已成功部署到生产环境"
  }'
```

详细配置请参阅 [通知系统](#-通知系统) 章节。

### 调试面板
点击顶部「调试」按钮打开调试面板，可查看：
- **概览**：当前账号、消息统计、同步状态
- **运行日志**：按来源和级别筛选日志
- **原始 JSON**：完整调试数据

## 📁 项目结构

```
weixin-local-chat/
├── src/                      # 后端源码
│   ├── api/                  # 微信上游 API 封装
│   ├── auth/                 # 认证相关
│   ├── media/                # 媒体处理（CDN、转码）
│   ├── server/               # HTTP 服务器
│   ├── service/              # 业务逻辑
│   │   ├── chat-service.ts   # 聊天服务核心
│   │   └── agent-router.ts   # Agent 路由
│   ├── store/                # SQLite 数据库
│   ├── utils/                # 工具函数
│   └── index.ts              # 入口文件
├── public/                   # 前端源码
│   └── src/
│       ├── api/              # API 客户端
│       ├── components/       # Vue 组件
│       ├── stores/           # Pinia 状态管理
│       ├── views/            # 页面视图
│       └── types.ts          # TypeScript 类型定义
├── docs/                     # 文档目录
│   ├── weixin-communication-openapi.md    # 本地服务 API 文档
│   ├── weixin-upstream-openapi.md          # 微信上游接口文档
│   └── weixin-upstream-openapi-3.1.yaml   # 微信上游接口 OpenAPI 规范
├── data/                     # 运行时数据（不提交）
├── dist/                     # 构建输出（不提交）
├── Dockerfile                # Docker 多阶段构建配置
├── docker-compose.yml        # Docker Compose 编排配置
├── .dockerignore             # Docker 构建忽略文件
├── package.json
├── tsconfig.json
└── vite.config.mts
```

## 📚 文档说明

### docs 目录

| 文件 | 说明 |
|------|------|
| [weixin-communication-openapi.md](./docs/weixin-communication-openapi.md) | 本地服务对外暴露的 HTTP/SSE 接口文档，包含完整的 API 路由、请求参数和响应格式 |
| [weixin-upstream-openapi.md](./docs/weixin-upstream-openapi.md) | 项目依赖的微信上游通讯接口文档，描述 `ilink/bot/*` 等接口的调用方式 |
| [weixin-upstream-openapi-3.1.yaml](./docs/weixin-upstream-openapi-3.1.yaml) | 微信上游接口的 OpenAPI 3.1 规范文件，可用于生成客户端代码或接口测试 |

### API 接口分类

**本地服务接口** (`/api/*`)
- `System` - 系统健康检查
- `Config` - 配置管理与验证
- `Account` - 账号管理（列表、选择、重命名、删除）
- `Login` - 扫码登录（启动、轮询、状态查询）
- `Conversation` - 会话管理（列表、打开、选择、清空）
- `Message` - 消息操作（发送、搜索、计数、历史加载）
- `Media` - 媒体文件下载
- `Export` - 数据导出
- `Debug` - 调试信息与日志
- `Event` - SSE 事件推送

**微信上游接口** (`ilink/bot/*`)
- 扫码登录（获取二维码、查询状态）
- 消息拉取（增量更新、历史消息）
- 消息发送（文本、媒体）
- 会话配置（输入状态、置顶会话）

## 🔧 常用命令

```bash
# 类型检查
npm run typecheck:web

# 清理构建
npm run clean

# 完整构建
npm run build
```

## ⚠️ 注意事项

1. **安全性**：服务默认绑定 `127.0.0.1`，仅限本机访问
2. **数据存储**：所有数据存储在本地 `data/` 目录，包括 SQLite 数据库和媒体文件
3. **密码管理**：首次启动生成的密码仅显示一次，请妥善保存
4. **依赖版本**：请确保 Node.js 版本 >= 18

## 🐛 问题反馈

如遇到问题，请提供以下信息：
- 操作系统和 Node.js 版本
- 完整的错误日志（控制台输出）
- 复现步骤

## 📄 许可证

[待补充]

## 🙏 致谢

- [Vue.js](https://vuejs.org/) - 渐进式 JavaScript 框架
- [Naive UI](https://www.naiveui.com/) - Vue 3 组件库
- [Pinia](https://pinia.vuejs.org/) - Vue 状态管理
- [Vite](https://vitejs.dev/) - 下一代前端构建工具
