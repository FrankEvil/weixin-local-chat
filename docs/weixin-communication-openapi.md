# 微信通讯接口文档（OpenAPI Markdown）

本文档基于当前仓库源码整理，覆盖两部分：

- 本地服务对外暴露的 HTTP / SSE 接口（标准 OpenAPI 3.1 风格）
- 服务内部依赖的微信上游通讯接口附录（`ilink/bot/*`）

## 1. OpenAPI 3.1

```yaml
openapi: 3.1.0
info:
  title: weixin-local-chat API
  version: 0.1.0
  summary: 本地微信聊天聚合服务接口
  description: |
    默认监听地址为 `http://127.0.0.1:3100`。
    当前接口未实现鉴权，调用方默认与本地进程同机部署。
servers:
  - url: http://127.0.0.1:3100
    description: 默认本地服务地址
tags:
  - name: System
  - name: Config
  - name: Account
  - name: Login
  - name: Conversation
  - name: Message
  - name: Export
  - name: Debug
  - name: Event
paths:
  /api/health:
    get:
      tags: [System]
      summary: 健康检查
      operationId: healthCheck
      responses:
        '200':
          description: 服务可用
          content:
            application/json:
              schema:
                type: object
                properties:
                  ok:
                    type: boolean
                    const: true
                  message:
                    type: string
                    example: 服务可用
                required: [ok, message]
  /api/bootstrap:
    get:
      tags: [System]
      summary: 获取启动初始化数据
      operationId: getBootstrap
      responses:
        '200':
          description: 初始化数据
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/BootstrapPayload'
        '500':
          $ref: '#/components/responses/InternalError'
  /api/config:
    get:
      tags: [Config]
      summary: 获取系统配置
      operationId: getConfig
      responses:
        '200':
          description: 当前配置
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/AppConfig'
        '500':
          $ref: '#/components/responses/InternalError'
    post:
      tags: [Config]
      summary: 保存系统配置
      operationId: saveConfig
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/ConfigSaveRequest'
      responses:
        '200':
          description: 保存后的配置
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/AppConfig'
        '500':
          $ref: '#/components/responses/InternalError'
  /api/accounts:
    get:
      tags: [Account]
      summary: 获取账号列表
      operationId: listAccounts
      responses:
        '200':
          description: 已登录账号列表
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: '#/components/schemas/AccountRecord'
        '500':
          $ref: '#/components/responses/InternalError'
  /api/accounts/select:
    post:
      tags: [Account]
      summary: 切换当前选中账号
      operationId: selectAccount
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/SelectAccountRequest'
      responses:
        '200':
          description: 切换后的账号对象；当账号不存在时返回 null
          content:
            application/json:
              schema:
                oneOf:
                  - $ref: '#/components/schemas/AccountRecord'
                  - type: 'null'
        '500':
          $ref: '#/components/responses/InternalError'
  /api/login/start:
    post:
      tags: [Login]
      summary: 发起扫码登录
      operationId: startLogin
      responses:
        '200':
          description: 新建登录会话
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/LoginSessionRecord'
        '500':
          $ref: '#/components/responses/InternalError'
  /api/login/session:
    get:
      tags: [Login]
      summary: 轮询登录会话状态
      operationId: pollLogin
      parameters:
        - $ref: '#/components/parameters/SessionKey'
      responses:
        '200':
          description: 登录会话状态
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/LoginSessionRecord'
        '500':
          $ref: '#/components/responses/InternalError'
  /api/conversations:
    get:
      tags: [Conversation]
      summary: 获取会话列表
      operationId: listConversations
      parameters:
        - $ref: '#/components/parameters/AccountIdQuery'
      responses:
        '200':
          description: 会话列表
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: '#/components/schemas/ConversationRecord'
        '500':
          $ref: '#/components/responses/InternalError'
  /api/conversations/open:
    post:
      tags: [Conversation]
      summary: 打开或初始化某个会话
      operationId: openConversation
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/ConversationActionRequest'
      responses:
        '200':
          description: 会话对象
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ConversationRecord'
        '500':
          $ref: '#/components/responses/InternalError'
  /api/conversations/read:
    post:
      tags: [Conversation]
      summary: 将会话标记为已读
      operationId: markConversationRead
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/ConversationActionRequest'
      responses:
        '200':
          description: 标记完成
          content:
            application/json:
              schema:
                type: object
                properties:
                  ok:
                    type: boolean
                    const: true
                required: [ok]
        '500':
          $ref: '#/components/responses/InternalError'
  /api/status:
    get:
      tags: [Account]
      summary: 获取账号同步状态
      operationId: getAccountStatus
      parameters:
        - $ref: '#/components/parameters/AccountIdQuery'
      responses:
        '200':
          description: 拉取微信消息的同步状态
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/SyncStateRecord'
        '500':
          $ref: '#/components/responses/InternalError'
  /api/messages:
    get:
      tags: [Message]
      summary: 获取会话消息列表
      operationId: listMessages
      parameters:
        - $ref: '#/components/parameters/AccountIdQuery'
        - $ref: '#/components/parameters/PeerIdQuery'
      responses:
        '200':
          description: 消息列表，按创建时间升序
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: '#/components/schemas/MessageRecord'
        '500':
          $ref: '#/components/responses/InternalError'
  /api/messages/search:
    get:
      tags: [Message]
      summary: 检索消息
      operationId: searchMessages
      parameters:
        - $ref: '#/components/parameters/AccountIdQuery'
        - $ref: '#/components/parameters/PeerIdQueryOptional'
        - name: q
          in: query
          required: true
          schema:
            type: string
          description: 检索关键字，匹配 `text` 与 `fileName`
      responses:
        '200':
          description: 消息搜索结果，按创建时间倒序
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: '#/components/schemas/MessageRecord'
        '500':
          $ref: '#/components/responses/InternalError'
  /api/messages/text:
    post:
      tags: [Message]
      summary: 发送文本消息
      operationId: sendText
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/SendTextRequest'
      responses:
        '200':
          description: 本地持久化后的消息对象
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/MessageRecord'
        '500':
          $ref: '#/components/responses/InternalError'
  /api/messages/media:
    post:
      tags: [Message]
      summary: 发送媒体消息
      description: |
        `bytesBase64` 为文件原始字节的 Base64 编码。
        当前服务会先上传微信 CDN，再生成本地出站消息记录。
      operationId: sendMedia
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/SendMediaRequest'
      responses:
        '200':
          description: 本地持久化后的媒体消息对象
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/MessageRecord'
        '500':
          $ref: '#/components/responses/InternalError'
  /api/media/{messageId}:
    get:
      tags: [Message]
      summary: 获取消息媒体文件
      operationId: getMediaFile
      parameters:
        - name: messageId
          in: path
          required: true
          schema:
            type: string
      responses:
        '200':
          description: 二进制媒体内容
          content:
            application/octet-stream:
              schema:
                type: string
                format: binary
            image/png:
              schema:
                type: string
                format: binary
            image/jpeg:
              schema:
                type: string
                format: binary
            audio/wav:
              schema:
                type: string
                format: binary
        '404':
          description: 媒体文件不存在
          content:
            text/plain:
              schema:
                type: string
                example: 媒体文件不存在
        '500':
          $ref: '#/components/responses/InternalError'
  /api/export/conversation:
    get:
      tags: [Export]
      summary: 导出单个会话 JSON
      operationId: exportConversation
      parameters:
        - $ref: '#/components/parameters/AccountIdQuery'
        - $ref: '#/components/parameters/PeerIdQuery'
      responses:
        '200':
          description: JSON 文件下载
          headers:
            Content-Disposition:
              schema:
                type: string
              description: 下载文件名
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ConversationExportPayload'
        '500':
          $ref: '#/components/responses/InternalError'
  /api/debug:
    get:
      tags: [Debug]
      summary: 获取调试快照
      operationId: getDebugSnapshot
      parameters:
        - $ref: '#/components/parameters/AccountIdQueryOptional'
      responses:
        '200':
          description: 调试用聚合数据
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/DebugSnapshot'
        '500':
          $ref: '#/components/responses/InternalError'
  /api/events:
    get:
      tags: [Event]
      summary: 订阅服务端事件流
      description: |
        基于 Server-Sent Events（SSE）。
        建立连接后服务端首先推送：
        `data: {"type":"bootstrap"}`
      operationId: streamEvents
      responses:
        '200':
          description: SSE 事件流
          content:
            text/event-stream:
              schema:
                type: string
                example: |
                  data: {"type":"bootstrap"}
                  
                  data: {"type":"messages","accountId":"bot-1","peerId":"user-1"}
        '500':
          $ref: '#/components/responses/InternalError'
components:
  parameters:
    AccountIdQuery:
      name: accountId
      in: query
      required: true
      schema:
        type: string
      description: 账号 ID
    AccountIdQueryOptional:
      name: accountId
      in: query
      required: false
      schema:
        type: string
      description: 账号 ID；为空时返回全局调试信息
    PeerIdQuery:
      name: peerId
      in: query
      required: true
      schema:
        type: string
      description: 会话对端 ID
    PeerIdQueryOptional:
      name: peerId
      in: query
      required: false
      schema:
        type: string
      description: 会话对端 ID；为空时执行全账号搜索
    SessionKey:
      name: sessionKey
      in: query
      required: true
      schema:
        type: string
      description: 登录会话标识
  responses:
    InternalError:
      description: 服务器内部异常
      content:
        application/json:
          schema:
            $ref: '#/components/schemas/ErrorResponse'
  schemas:
    AppConfig:
      type: object
      properties:
        baseUrl:
          type: string
          example: https://ilinkai.weixin.qq.com
        cdnBaseUrl:
          type: string
          example: https://novac2c.cdn.weixin.qq.com/c2c
        botType:
          type: string
          example: '3'
        defaultWorkspace:
          type: string
        codexWorkspace:
          type: string
        claudeWorkspace:
          type: string
        openclawWorkspace:
          type: string
        openclawContainer:
          type: string
          example: openclaw-openclaw-gateway-1
      required:
        - baseUrl
        - cdnBaseUrl
        - botType
        - defaultWorkspace
        - codexWorkspace
        - claudeWorkspace
        - openclawWorkspace
        - openclawContainer
    ConfigSaveRequest:
      allOf:
        - $ref: '#/components/schemas/AppConfig'
    AccountRecord:
      type: object
      properties:
        accountId:
          type: string
        displayName:
          type: string
        userId:
          type: string
        token:
          type: string
          description: 微信机器人 token
        baseUrl:
          type: string
        cdnBaseUrl:
          type: string
        isSelected:
          type: boolean
        lastLoginAt:
          type: integer
          format: int64
          description: 毫秒时间戳
        createdAt:
          type: integer
          format: int64
        updatedAt:
          type: integer
          format: int64
      required:
        - accountId
        - displayName
        - userId
        - token
        - baseUrl
        - cdnBaseUrl
        - isSelected
        - lastLoginAt
        - createdAt
        - updatedAt
    SyncStateRecord:
      type: object
      properties:
        accountId:
          type: string
        getUpdatesBuf:
          type: string
        pauseUntilMs:
          type: integer
          format: int64
        lastError:
          type: string
        lastEventAt:
          type: integer
          format: int64
      required:
        - accountId
        - getUpdatesBuf
        - pauseUntilMs
        - lastError
        - lastEventAt
    ConversationRecord:
      type: object
      properties:
        accountId:
          type: string
        peerId:
          type: string
        title:
          type: string
        lastMessagePreview:
          type: string
        lastMessageType:
          type: string
        lastMessageAt:
          type: integer
          format: int64
        unreadCount:
          type: integer
        contextToken:
          type: string
        updatedAt:
          type: integer
          format: int64
      required:
        - accountId
        - peerId
        - title
        - lastMessagePreview
        - lastMessageType
        - lastMessageAt
        - unreadCount
        - contextToken
        - updatedAt
    MessageRecord:
      type: object
      properties:
        id:
          type: string
        accountId:
          type: string
        peerId:
          type: string
        direction:
          type: string
          enum: [inbound, outbound]
        messageType:
          type: string
          enum: [text, image, file, video, voice, unknown]
        text:
          type: string
        fileName:
          type: string
        mimeType:
          type: string
        mediaPath:
          type: string
        mediaSize:
          type: integer
          format: int64
        status:
          type: string
          enum: [pending, sent, failed, received]
        remoteMessageId:
          type: string
        rawJson:
          type: string
        createdAt:
          type: integer
          format: int64
        updatedAt:
          type: integer
          format: int64
      required:
        - id
        - accountId
        - peerId
        - direction
        - messageType
        - text
        - fileName
        - mimeType
        - mediaPath
        - mediaSize
        - status
        - remoteMessageId
        - rawJson
        - createdAt
        - updatedAt
    LoginSessionRecord:
      type: object
      properties:
        sessionKey:
          type: string
        qrcode:
          type: string
        qrcodeUrl:
          type: string
        status:
          type: string
          enum: [wait, scaned, confirmed, expired, error]
        startedAt:
          type: integer
          format: int64
        lastCheckedAt:
          type: integer
          format: int64
        error:
          type: string
        baseUrl:
          type: string
        cdnBaseUrl:
          type: string
        botType:
          type: string
      required:
        - sessionKey
        - qrcode
        - qrcodeUrl
        - status
        - startedAt
        - lastCheckedAt
        - error
        - baseUrl
        - cdnBaseUrl
        - botType
    BootstrapPayload:
      type: object
      properties:
        config:
          $ref: '#/components/schemas/AppConfig'
        accounts:
          type: array
          items:
            $ref: '#/components/schemas/AccountRecord'
        selectedAccountId:
          type: string
      required: [config, accounts, selectedAccountId]
    SelectAccountRequest:
      type: object
      properties:
        accountId:
          type: string
      required: [accountId]
    ConversationActionRequest:
      type: object
      properties:
        accountId:
          type: string
        peerId:
          type: string
      required: [accountId, peerId]
    SendTextRequest:
      type: object
      properties:
        accountId:
          type: string
        peerId:
          type: string
        text:
          type: string
      required: [accountId, peerId, text]
    SendMediaRequest:
      type: object
      properties:
        accountId:
          type: string
        peerId:
          type: string
        fileName:
          type: string
        mimeType:
          type: string
        bytesBase64:
          type: string
          description: 原始文件内容的 Base64 编码
        caption:
          type: string
      required: [accountId, peerId, fileName, mimeType, bytesBase64, caption]
    AgentBindingRecord:
      type: object
      properties:
        accountId:
          type: string
        peerId:
          type: string
        activeProvider:
          type: string
          enum: [codex, claude, openclaw, '']
        activeSessionId:
          type: string
        updatedAt:
          type: integer
          format: int64
      required: [accountId, peerId, activeProvider, activeSessionId, updatedAt]
    AgentSessionRecord:
      type: object
      properties:
        accountId:
          type: string
        peerId:
          type: string
        provider:
          type: string
          enum: [codex, claude, openclaw]
        sessionId:
          type: string
        status:
          type: string
          enum: [idle, running, error]
        lastError:
          type: string
        lastUsedAt:
          type: integer
          format: int64
        createdAt:
          type: integer
          format: int64
        updatedAt:
          type: integer
          format: int64
      required:
        - accountId
        - peerId
        - provider
        - sessionId
        - status
        - lastError
        - lastUsedAt
        - createdAt
        - updatedAt
    ConversationExportPayload:
      type: object
      properties:
        exportedAt:
          type: string
          format: date-time
        account:
          type: object
          properties:
            accountId:
              type: string
            displayName:
              type: string
            userId:
              type: string
          required: [accountId, displayName, userId]
        conversation:
          oneOf:
            - $ref: '#/components/schemas/ConversationRecord'
            - type: 'null'
        messages:
          type: array
          items:
            $ref: '#/components/schemas/MessageRecord'
      required: [exportedAt, account, conversation, messages]
    DebugSnapshot:
      type: object
      properties:
        config:
          $ref: '#/components/schemas/AppConfig'
        account:
          oneOf:
            - $ref: '#/components/schemas/AccountRecord'
            - type: 'null'
        syncState:
          oneOf:
            - $ref: '#/components/schemas/SyncStateRecord'
            - type: 'null'
        stats:
          type: object
          properties:
            conversationCount:
              type: integer
            messageCount:
              type: integer
          required: [conversationCount, messageCount]
        agentBindings:
          type: array
          items:
            $ref: '#/components/schemas/AgentBindingRecord'
        agentSessions:
          type: array
          items:
            $ref: '#/components/schemas/AgentSessionRecord'
      required:
        - config
        - account
        - syncState
        - stats
        - agentBindings
        - agentSessions
    ErrorResponse:
      type: object
      properties:
        error:
          type: string
      required: [error]
```

## 2. 事件流说明

`GET /api/events` 返回 `text/event-stream`，事件体统一为 JSON 字符串，格式如下：

```json
{
  "type": "messages",
  "accountId": "bot-account-id",
  "peerId": "wx-user-id",
  "payload": {}
}
```

字段说明：

- `type`: `bootstrap | accounts | conversations | messages | status`
- `accountId`: 可选，账号维度事件时存在
- `peerId`: 可选，会话维度事件时存在
- `payload`: 可选，通常用于状态补充信息，例如 `{ "message": "config_saved" }` 或 `{ "error": "session expired" }`

## 3. 微信上游通讯接口附录

以下接口不是本地服务直接暴露给前端的路由，而是本项目内部通过 `WeixinClient` 调用的微信通讯接口。

### 3.1 通用约束

- 基础地址默认来自配置 `baseUrl`，默认值：`https://ilinkai.weixin.qq.com`
- 除二维码相关接口外，其余接口通常携带：
  - `Content-Type: application/json`
  - `AuthorizationType: ilink_bot_token`
  - `Authorization: Bearer <bot_token>`
  - `X-WECHAT-UIN: <随机 base64 值>`
- 请求体统一附加：

```json
{
  "base_info": {
    "channel_version": "weixin-local-chat/0.1.0"
  }
}
```

### 3.2 上游接口清单

#### `GET /ilink/bot/get_bot_qrcode`

用途：获取扫码登录二维码。

Query 参数：

- `bot_type`: 机器人类型，当前默认值为 `3`

响应示例：

```json
{
  "qrcode": "xxxx",
  "qrcode_img_content": "data:image/png;base64,..."
}
```

#### `GET /ilink/bot/get_qrcode_status`

用途：查询二维码扫码状态。

请求头：

- `iLink-App-ClientVersion: 1`

Query 参数：

- `qrcode`: 二维码标识

响应示例：

```json
{
  "status": "confirmed",
  "bot_token": "xxxxx",
  "ilink_bot_id": "bot-id",
  "baseurl": "https://ilinkai.weixin.qq.com",
  "ilink_user_id": "wxid_xxx"
}
```

状态枚举：

- `wait`
- `scaned`
- `confirmed`
- `expired`

#### `POST /ilink/bot/getupdates`

用途：长轮询获取微信消息增量。

请求示例：

```json
{
  "get_updates_buf": "",
  "base_info": {
    "channel_version": "weixin-local-chat/0.1.0"
  }
}
```

响应关键字段：

- `ret`: 0 表示成功
- `errcode`: 特殊错误码，`-14` 表示 session 失效
- `errmsg`: 错误信息
- `msgs`: 微信消息数组
- `get_updates_buf`: 下一次轮询游标
- `longpolling_timeout_ms`: 服务端建议长轮询超时

#### `POST /ilink/bot/sendmessage`

用途：发送文本或媒体消息。

请求示例：

```json
{
  "msg": {
    "to_user_id": "wx-user-id",
    "client_id": "local-message-id",
    "message_type": 2,
    "message_state": 2,
    "item_list": [
      {
        "type": 1,
        "text_item": {
          "text": "你好"
        }
      }
    ],
    "context_token": "optional-context-token"
  },
  "base_info": {
    "channel_version": "weixin-local-chat/0.1.0"
  }
}
```

媒体项类型：

- `1`: 文本
- `2`: 图片
- `3`: 语音
- `4`: 文件
- `5`: 视频

#### `POST /ilink/bot/getuploadurl`

用途：获取微信 CDN 上传参数。

请求字段：

- `filekey`
- `media_type`
- `to_user_id`
- `rawsize`
- `rawfilemd5`
- `filesize`
- `no_need_thumb`
- `aeskey`

响应示例：

```json
{
  "upload_param": "xxx",
  "thumb_upload_param": "xxx"
}
```

#### `POST /ilink/bot/getconfig`

用途：获取会话配置，当前主要用于拉取 `typing_ticket`。

请求示例：

```json
{
  "ilink_user_id": "wx-user-id",
  "context_token": "",
  "base_info": {
    "channel_version": "weixin-local-chat/0.1.0"
  }
}
```

响应示例：

```json
{
  "typing_ticket": "ticket-value"
}
```

#### `POST /ilink/bot/sendtyping`

用途：发送“正在输入”状态。

请求示例：

```json
{
  "ilink_user_id": "wx-user-id",
  "typing_ticket": "ticket-value",
  "status": 1,
  "base_info": {
    "channel_version": "weixin-local-chat/0.1.0"
  }
}
```

状态值：

- `1`: 开始输入
- `2`: 结束输入

## 4. 备注

- 本文档根据当前源码静态整理，未额外引入 Swagger 注解或自动生成器。
- `/api/login/session`、`/api/messages/text`、`/api/messages/media` 等接口在上游异常、账号不存在、会话失效时会直接返回 `500`，响应结构为 `{ "error": "..." }`。
- `GET /api/media/{messageId}` 会根据消息类型动态返回不同 MIME；语音消息会优先转成 `audio/wav` 返回。

## 5. 请求与响应示例

以下示例默认服务地址为 `http://127.0.0.1:3100`。

### 5.1 健康检查

请求：

```bash
curl http://127.0.0.1:3100/api/health
```

响应：

```json
{
  "ok": true,
  "message": "服务可用"
}
```

### 5.2 获取启动数据

请求：

```bash
curl http://127.0.0.1:3100/api/bootstrap
```

响应：

```json
{
  "config": {
    "baseUrl": "https://ilinkai.weixin.qq.com",
    "cdnBaseUrl": "https://novac2c.cdn.weixin.qq.com/c2c",
    "botType": "3",
    "defaultWorkspace": "/Users/liuzhaojun/IdeaProjects/weixin-local-chat",
    "codexWorkspace": "",
    "claudeWorkspace": "",
    "openclawWorkspace": "",
    "openclawContainer": "openclaw-openclaw-gateway-1"
  },
  "accounts": [],
  "selectedAccountId": ""
}
```

### 5.3 获取配置

请求：

```bash
curl http://127.0.0.1:3100/api/config
```

响应：

```json
{
  "baseUrl": "https://ilinkai.weixin.qq.com",
  "cdnBaseUrl": "https://novac2c.cdn.weixin.qq.com/c2c",
  "botType": "3",
  "defaultWorkspace": "/Users/liuzhaojun/IdeaProjects/weixin-local-chat",
  "codexWorkspace": "",
  "claudeWorkspace": "",
  "openclawWorkspace": "",
  "openclawContainer": "openclaw-openclaw-gateway-1"
}
```

### 5.4 保存配置

请求：

```bash
curl -X POST http://127.0.0.1:3100/api/config \
  -H 'Content-Type: application/json' \
  -d '{
    "baseUrl": "https://ilinkai.weixin.qq.com",
    "cdnBaseUrl": "https://novac2c.cdn.weixin.qq.com/c2c",
    "botType": "3",
    "defaultWorkspace": "/Users/liuzhaojun/IdeaProjects/weixin-local-chat",
    "codexWorkspace": "/Users/liuzhaojun/workspaces/codex",
    "claudeWorkspace": "/Users/liuzhaojun/workspaces/claude",
    "openclawWorkspace": "/Users/liuzhaojun/workspaces/openclaw",
    "openclawContainer": "openclaw-openclaw-gateway-1"
  }'
```

响应：

```json
{
  "baseUrl": "https://ilinkai.weixin.qq.com",
  "cdnBaseUrl": "https://novac2c.cdn.weixin.qq.com/c2c",
  "botType": "3",
  "defaultWorkspace": "/Users/liuzhaojun/IdeaProjects/weixin-local-chat",
  "codexWorkspace": "/Users/liuzhaojun/workspaces/codex",
  "claudeWorkspace": "/Users/liuzhaojun/workspaces/claude",
  "openclawWorkspace": "/Users/liuzhaojun/workspaces/openclaw",
  "openclawContainer": "openclaw-openclaw-gateway-1"
}
```

### 5.5 获取账号列表

请求：

```bash
curl http://127.0.0.1:3100/api/accounts
```

响应：

```json
[
  {
    "accountId": "4a0a06b511ad@im.bot",
    "displayName": "o9cq80yaAQxvd3EtGXjor9gkCHJY",
    "userId": "o9cq80yaAQxvd3EtGXjor9gkCHJY@im.wechat",
    "token": "bot-token",
    "baseUrl": "https://ilinkai.weixin.qq.com",
    "cdnBaseUrl": "https://novac2c.cdn.weixin.qq.com/c2c",
    "isSelected": true,
    "lastLoginAt": 1770000000000,
    "createdAt": 1770000000000,
    "updatedAt": 1770000000000
  }
]
```

### 5.6 选择当前账号

请求：

```bash
curl -X POST http://127.0.0.1:3100/api/accounts/select \
  -H 'Content-Type: application/json' \
  -d '{
    "accountId": "4a0a06b511ad@im.bot"
  }'
```

响应：

```json
{
  "accountId": "4a0a06b511ad@im.bot",
  "displayName": "o9cq80yaAQxvd3EtGXjor9gkCHJY",
  "userId": "o9cq80yaAQxvd3EtGXjor9gkCHJY@im.wechat",
  "token": "bot-token",
  "baseUrl": "https://ilinkai.weixin.qq.com",
  "cdnBaseUrl": "https://novac2c.cdn.weixin.qq.com/c2c",
  "isSelected": true,
  "lastLoginAt": 1770000000000,
  "createdAt": 1770000000000,
  "updatedAt": 1770000001000
}
```

### 5.7 发起登录

请求：

```bash
curl -X POST http://127.0.0.1:3100/api/login/start
```

响应：

```json
{
  "sessionKey": "8a3f8e50-e637-4b1d-9892-d1b94e63b39f",
  "qrcode": "wechat-qrcode-token",
  "qrcodeUrl": "data:image/png;base64,iVBORw0KGgoAAA...",
  "status": "wait",
  "startedAt": 1770000000000,
  "lastCheckedAt": 0,
  "error": "",
  "baseUrl": "https://ilinkai.weixin.qq.com",
  "cdnBaseUrl": "https://novac2c.cdn.weixin.qq.com/c2c",
  "botType": "3"
}
```

### 5.8 轮询登录状态

请求：

```bash
curl 'http://127.0.0.1:3100/api/login/session?sessionKey=8a3f8e50-e637-4b1d-9892-d1b94e63b39f'
```

响应：

```json
{
  "sessionKey": "8a3f8e50-e637-4b1d-9892-d1b94e63b39f",
  "qrcode": "wechat-qrcode-token",
  "qrcodeUrl": "data:image/png;base64,iVBORw0KGgoAAA...",
  "status": "confirmed",
  "startedAt": 1770000000000,
  "lastCheckedAt": 1770000005000,
  "error": "",
  "baseUrl": "https://ilinkai.weixin.qq.com",
  "cdnBaseUrl": "https://novac2c.cdn.weixin.qq.com/c2c",
  "botType": "3"
}
```

### 5.9 获取会话列表

请求：

```bash
curl 'http://127.0.0.1:3100/api/conversations?accountId=4a0a06b511ad@im.bot'
```

响应：

```json
[
  {
    "accountId": "4a0a06b511ad@im.bot",
    "peerId": "o9cq80yaAQxvd3EtGXjor9gkCHJY@im.wechat",
    "title": "o9cq80yaAQxvd3EtGXjor9gkCHJY@im.wechat",
    "lastMessagePreview": "你好",
    "lastMessageType": "text",
    "lastMessageAt": 1770000010000,
    "unreadCount": 0,
    "contextToken": "",
    "updatedAt": 1770000010000
  }
]
```

### 5.10 打开会话

请求：

```bash
curl -X POST http://127.0.0.1:3100/api/conversations/open \
  -H 'Content-Type: application/json' \
  -d '{
    "accountId": "4a0a06b511ad@im.bot",
    "peerId": "o9cq80yaAQxvd3EtGXjor9gkCHJY@im.wechat"
  }'
```

响应：

```json
{
  "accountId": "4a0a06b511ad@im.bot",
  "peerId": "o9cq80yaAQxvd3EtGXjor9gkCHJY@im.wechat",
  "title": "o9cq80yaAQxvd3EtGXjor9gkCHJY@im.wechat",
  "lastMessagePreview": "",
  "lastMessageType": "text",
  "lastMessageAt": 0,
  "unreadCount": 0,
  "contextToken": "",
  "updatedAt": 1770000000000
}
```

### 5.11 标记会话已读

请求：

```bash
curl -X POST http://127.0.0.1:3100/api/conversations/read \
  -H 'Content-Type: application/json' \
  -d '{
    "accountId": "4a0a06b511ad@im.bot",
    "peerId": "o9cq80yaAQxvd3EtGXjor9gkCHJY@im.wechat"
  }'
```

响应：

```json
{
  "ok": true
}
```

### 5.12 获取同步状态

请求：

```bash
curl 'http://127.0.0.1:3100/api/status?accountId=4a0a06b511ad@im.bot'
```

响应：

```json
{
  "accountId": "4a0a06b511ad@im.bot",
  "getUpdatesBuf": "cursor-token",
  "pauseUntilMs": 0,
  "lastError": "",
  "lastEventAt": 1770000010000
}
```

### 5.13 获取消息列表

请求：

```bash
curl 'http://127.0.0.1:3100/api/messages?accountId=4a0a06b511ad@im.bot&peerId=o9cq80yaAQxvd3EtGXjor9gkCHJY@im.wechat'
```

响应：

```json
[
  {
    "id": "message-1",
    "accountId": "4a0a06b511ad@im.bot",
    "peerId": "o9cq80yaAQxvd3EtGXjor9gkCHJY@im.wechat",
    "direction": "outbound",
    "messageType": "text",
    "text": "你好",
    "fileName": "",
    "mimeType": "text/plain",
    "mediaPath": "",
    "mediaSize": 6,
    "status": "sent",
    "remoteMessageId": "message-1",
    "rawJson": "",
    "createdAt": 1770000010000,
    "updatedAt": 1770000012000
  }
]
```

### 5.14 搜索消息

请求：

```bash
curl 'http://127.0.0.1:3100/api/messages/search?accountId=4a0a06b511ad@im.bot&peerId=o9cq80yaAQxvd3EtGXjor9gkCHJY@im.wechat&q=%E4%BD%A0%E5%A5%BD'
```

响应：

```json
[
  {
    "id": "message-1",
    "accountId": "4a0a06b511ad@im.bot",
    "peerId": "o9cq80yaAQxvd3EtGXjor9gkCHJY@im.wechat",
    "direction": "outbound",
    "messageType": "text",
    "text": "你好",
    "fileName": "",
    "mimeType": "text/plain",
    "mediaPath": "",
    "mediaSize": 6,
    "status": "sent",
    "remoteMessageId": "message-1",
    "rawJson": "",
    "createdAt": 1770000010000,
    "updatedAt": 1770000012000
  }
]
```

### 5.15 发送文本消息

请求：

```bash
curl -X POST http://127.0.0.1:3100/api/messages/text \
  -H 'Content-Type: application/json' \
  -d '{
    "accountId": "4a0a06b511ad@im.bot",
    "peerId": "o9cq80yaAQxvd3EtGXjor9gkCHJY@im.wechat",
    "text": "你好，这是本地服务发出的测试消息"
  }'
```

响应：

```json
{
  "id": "8c59d2cf-7efe-46d4-a9f0-65fc378f57df",
  "accountId": "4a0a06b511ad@im.bot",
  "peerId": "o9cq80yaAQxvd3EtGXjor9gkCHJY@im.wechat",
  "direction": "outbound",
  "messageType": "text",
  "text": "你好，这是本地服务发出的测试消息",
  "fileName": "",
  "mimeType": "text/plain",
  "mediaPath": "",
  "mediaSize": 54,
  "status": "sent",
  "remoteMessageId": "8c59d2cf-7efe-46d4-a9f0-65fc378f57df",
  "rawJson": "",
  "createdAt": 1770000020000,
  "updatedAt": 1770000021000
}
```

### 5.16 发送媒体消息

请求：

```bash
curl -X POST http://127.0.0.1:3100/api/messages/media \
  -H 'Content-Type: application/json' \
  -d '{
    "accountId": "4a0a06b511ad@im.bot",
    "peerId": "o9cq80yaAQxvd3EtGXjor9gkCHJY@im.wechat",
    "fileName": "example.png",
    "mimeType": "image/png",
    "bytesBase64": "iVBORw0KGgoAAAANSUhEUgAA...",
    "caption": "这是图片说明"
  }'
```

响应：

```json
{
  "id": "media-message-1",
  "accountId": "4a0a06b511ad@im.bot",
  "peerId": "o9cq80yaAQxvd3EtGXjor9gkCHJY@im.wechat",
  "direction": "outbound",
  "messageType": "image",
  "text": "这是图片说明",
  "fileName": "example.png",
  "mimeType": "image/png",
  "mediaPath": "/Users/liuzhaojun/IdeaProjects/weixin-local-chat/data/outbox/4a0a06b511ad@im.bot/o9cq80yaAQxvd3EtGXjor9gkCHJY@im.wechat/media-message-1-example.png",
  "mediaSize": 20480,
  "status": "sent",
  "remoteMessageId": "media-message-1",
  "rawJson": "{\"kind\":\"image\"}",
  "createdAt": 1770000030000,
  "updatedAt": 1770000031000
}
```

### 5.17 获取媒体文件

请求：

```bash
curl -L 'http://127.0.0.1:3100/api/media/media-message-1' --output example.png
```

成功时返回文件二进制流，典型响应头：

```http
HTTP/1.1 200 OK
Content-Type: image/png
Content-Disposition: inline; filename="example.png"
```

不存在时响应：

```text
媒体文件不存在
```

### 5.18 导出会话

请求：

```bash
curl -L 'http://127.0.0.1:3100/api/export/conversation?accountId=4a0a06b511ad@im.bot&peerId=o9cq80yaAQxvd3EtGXjor9gkCHJY@im.wechat'
```

响应：

```json
{
  "exportedAt": "2026-03-27T08:00:00.000Z",
  "account": {
    "accountId": "4a0a06b511ad@im.bot",
    "displayName": "o9cq80yaAQxvd3EtGXjor9gkCHJY",
    "userId": "o9cq80yaAQxvd3EtGXjor9gkCHJY@im.wechat"
  },
  "conversation": {
    "accountId": "4a0a06b511ad@im.bot",
    "peerId": "o9cq80yaAQxvd3EtGXjor9gkCHJY@im.wechat",
    "title": "o9cq80yaAQxvd3EtGXjor9gkCHJY@im.wechat",
    "lastMessagePreview": "你好",
    "lastMessageType": "text",
    "lastMessageAt": 1770000010000,
    "unreadCount": 0,
    "contextToken": "",
    "updatedAt": 1770000010000
  },
  "messages": []
}
```

### 5.19 获取调试快照

请求：

```bash
curl 'http://127.0.0.1:3100/api/debug?accountId=4a0a06b511ad@im.bot'
```

响应：

```json
{
  "config": {
    "baseUrl": "https://ilinkai.weixin.qq.com",
    "cdnBaseUrl": "https://novac2c.cdn.weixin.qq.com/c2c",
    "botType": "3",
    "defaultWorkspace": "/Users/liuzhaojun/IdeaProjects/weixin-local-chat",
    "codexWorkspace": "",
    "claudeWorkspace": "",
    "openclawWorkspace": "",
    "openclawContainer": "openclaw-openclaw-gateway-1"
  },
  "account": {
    "accountId": "4a0a06b511ad@im.bot",
    "displayName": "o9cq80yaAQxvd3EtGXjor9gkCHJY",
    "userId": "o9cq80yaAQxvd3EtGXjor9gkCHJY@im.wechat",
    "token": "bot-token",
    "baseUrl": "https://ilinkai.weixin.qq.com",
    "cdnBaseUrl": "https://novac2c.cdn.weixin.qq.com/c2c",
    "isSelected": true,
    "lastLoginAt": 1770000000000,
    "createdAt": 1770000000000,
    "updatedAt": 1770000000000
  },
  "syncState": {
    "accountId": "4a0a06b511ad@im.bot",
    "getUpdatesBuf": "cursor-token",
    "pauseUntilMs": 0,
    "lastError": "",
    "lastEventAt": 1770000010000
  },
  "stats": {
    "conversationCount": 1,
    "messageCount": 12
  },
  "agentBindings": [],
  "agentSessions": []
}
```

### 5.20 订阅事件流

请求：

```bash
curl -N http://127.0.0.1:3100/api/events
```

响应示例：

```text
data: {"type":"bootstrap"}

data: {"type":"accounts","accountId":"4a0a06b511ad@im.bot"}

data: {"type":"messages","accountId":"4a0a06b511ad@im.bot","peerId":"o9cq80yaAQxvd3EtGXjor9gkCHJY@im.wechat"}
```

### 5.21 通用错误响应

响应：

```json
{
  "error": "账号不存在，请先扫码登录"
}
```
