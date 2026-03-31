# 微信上游接口文档（OpenAPI Markdown）

本文档仅描述本项目依赖的微信上游通讯接口，不包含本地服务 `/api/*` 路由。

## 1. OpenAPI 3.1

```yaml
openapi: 3.1.0
info:
  title: Weixin Upstream Communication API
  version: 0.1.0
  summary: weixin-local-chat 依赖的微信上游接口
  description: |
    当前文档根据 `src/api/weixin.ts` 的调用逻辑整理。
    实际基础地址由本地配置 `baseUrl` 提供，默认值为 `https://ilinkai.weixin.qq.com`。
servers:
  - url: https://ilinkai.weixin.qq.com
    description: 默认微信上游地址
tags:
  - name: Login
  - name: Message
  - name: Media
  - name: Config
paths:
  /ilink/bot/get_bot_qrcode:
    get:
      tags: [Login]
      summary: 获取扫码登录二维码
      operationId: getBotQrCode
      parameters:
        - name: bot_type
          in: query
          required: true
          schema:
            type: string
            example: '3'
      responses:
        '200':
          description: 二维码信息
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/QrCodeResponse'
        '500':
          $ref: '#/components/responses/UpstreamError'
  /ilink/bot/get_qrcode_status:
    get:
      tags: [Login]
      summary: 查询二维码状态
      operationId: getQrCodeStatus
      parameters:
        - name: qrcode
          in: query
          required: true
          schema:
            type: string
      responses:
        '200':
          description: 二维码状态
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/QrStatusResponse'
        '500':
          $ref: '#/components/responses/UpstreamError'
  /ilink/bot/getupdates:
    post:
      tags: [Message]
      summary: 长轮询拉取消息更新
      operationId: getUpdates
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/GetUpdatesRequest'
      responses:
        '200':
          description: 消息增量结果
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/GetUpdatesResp'
        '500':
          $ref: '#/components/responses/UpstreamError'
  /ilink/bot/sendmessage:
    post:
      tags: [Message]
      summary: 发送微信消息
      operationId: sendMessage
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/SendMessageRequest'
      responses:
        '200':
          description: 上游返回原始文本；当前项目未约束固定 JSON 结构
          content:
            text/plain:
              schema:
                type: string
        '500':
          $ref: '#/components/responses/UpstreamError'
  /ilink/bot/getuploadurl:
    post:
      tags: [Media]
      summary: 获取媒体上传参数
      operationId: getUploadUrl
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/GetUploadUrlRequest'
      responses:
        '200':
          description: 上传参数
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/UploadUrlResp'
        '500':
          $ref: '#/components/responses/UpstreamError'
  /ilink/bot/getconfig:
    post:
      tags: [Config]
      summary: 获取会话配置
      operationId: getConfig
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/GetConfigRequest'
      responses:
        '200':
          description: 会话配置
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/GetConfigResponse'
        '500':
          $ref: '#/components/responses/UpstreamError'
  /ilink/bot/sendtyping:
    post:
      tags: [Config]
      summary: 发送输入状态
      operationId: sendTyping
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/SendTypingRequest'
      responses:
        '200':
          description: 上游返回原始文本；当前项目未约束固定 JSON 结构
          content:
            text/plain:
              schema:
                type: string
        '500':
          $ref: '#/components/responses/UpstreamError'
components:
  responses:
    UpstreamError:
      description: 上游接口异常
      content:
        text/plain:
          schema:
            type: string
  schemas:
    BaseInfo:
      type: object
      properties:
        channel_version:
          type: string
          example: weixin-local-chat/0.1.0
      required: [channel_version]
    QrCodeResponse:
      type: object
      properties:
        qrcode:
          type: string
        qrcode_img_content:
          type: string
          description: 二维码图片内容，通常为 data URL
      required: [qrcode, qrcode_img_content]
    QrStatusResponse:
      type: object
      properties:
        status:
          type: string
          enum: [wait, scaned, confirmed, expired]
        bot_token:
          type: string
        ilink_bot_id:
          type: string
        baseurl:
          type: string
        ilink_user_id:
          type: string
      required: [status]
    GetUpdatesRequest:
      type: object
      properties:
        get_updates_buf:
          type: string
        base_info:
          $ref: '#/components/schemas/BaseInfo'
      required: [get_updates_buf, base_info]
    GetUpdatesResp:
      type: object
      properties:
        ret:
          type: integer
        errcode:
          type: integer
          description: `-14` 表示 session 失效
        errmsg:
          type: string
        msgs:
          type: array
          items:
            $ref: '#/components/schemas/WeixinMessage'
        get_updates_buf:
          type: string
        longpolling_timeout_ms:
          type: integer
          format: int64
      additionalProperties: true
    SendMessageRequest:
      type: object
      properties:
        msg:
          $ref: '#/components/schemas/WeixinMessage'
        base_info:
          $ref: '#/components/schemas/BaseInfo'
      required: [msg, base_info]
    WeixinMessage:
      type: object
      properties:
        seq:
          type: integer
        message_id:
          type: integer
        from_user_id:
          type: string
        to_user_id:
          type: string
        client_id:
          type: string
        create_time_ms:
          type: integer
          format: int64
        session_id:
          type: string
        message_type:
          type: integer
        message_state:
          type: integer
        item_list:
          type: array
          items:
            $ref: '#/components/schemas/MessageItem'
        context_token:
          type: string
      additionalProperties: true
    MessageItem:
      type: object
      properties:
        type:
          type: integer
          enum: [1, 2, 3, 4, 5]
        text_item:
          type: object
          properties:
            text:
              type: string
        image_item:
          type: object
          properties:
            media:
              $ref: '#/components/schemas/CDNMedia'
            aeskey:
              type: string
            mid_size:
              type: integer
        voice_item:
          type: object
          properties:
            media:
              $ref: '#/components/schemas/CDNMedia'
            text:
              type: string
        file_item:
          type: object
          properties:
            media:
              $ref: '#/components/schemas/CDNMedia'
            file_name:
              type: string
            len:
              type: string
        video_item:
          type: object
          properties:
            media:
              $ref: '#/components/schemas/CDNMedia'
            video_size:
              type: integer
        ref_msg:
          type: object
          properties:
            title:
              type: string
            message_item:
              $ref: '#/components/schemas/MessageItem'
      additionalProperties: true
    CDNMedia:
      type: object
      properties:
        encrypt_query_param:
          type: string
        aes_key:
          type: string
        encrypt_type:
          type: integer
      additionalProperties: true
    GetUploadUrlRequest:
      type: object
      properties:
        filekey:
          type: string
        media_type:
          type: integer
          description: `1=image`, `2=video`, `3=file`
        to_user_id:
          type: string
        rawsize:
          type: integer
          format: int64
        rawfilemd5:
          type: string
        filesize:
          type: integer
          format: int64
        no_need_thumb:
          type: boolean
        aeskey:
          type: string
        base_info:
          $ref: '#/components/schemas/BaseInfo'
      required:
        - filekey
        - media_type
        - to_user_id
        - rawsize
        - rawfilemd5
        - filesize
        - no_need_thumb
        - aeskey
        - base_info
    UploadUrlResp:
      type: object
      properties:
        upload_param:
          type: string
        thumb_upload_param:
          type: string
      additionalProperties: true
    GetConfigRequest:
      type: object
      properties:
        ilink_user_id:
          type: string
        context_token:
          type: string
        base_info:
          $ref: '#/components/schemas/BaseInfo'
      required: [ilink_user_id, context_token, base_info]
    GetConfigResponse:
      type: object
      properties:
        typing_ticket:
          type: string
      additionalProperties: true
    SendTypingRequest:
      type: object
      properties:
        ilink_user_id:
          type: string
        typing_ticket:
          type: string
        status:
          type: integer
          enum: [1, 2]
        base_info:
          $ref: '#/components/schemas/BaseInfo'
      required: [ilink_user_id, typing_ticket, status, base_info]
```

## 2. 请求头约定

### 2.1 二维码相关接口

`GET /ilink/bot/get_bot_qrcode`：

- 无额外请求头要求

`GET /ilink/bot/get_qrcode_status`：

- `iLink-App-ClientVersion: 1`

### 2.2 已登录接口

以下接口通常要求：

- `Content-Type: application/json`
- `AuthorizationType: ilink_bot_token`
- `Authorization: Bearer <bot_token>`
- `X-WECHAT-UIN: <随机 base64 值>`

适用接口：

- `POST /ilink/bot/getupdates`
- `POST /ilink/bot/sendmessage`
- `POST /ilink/bot/getuploadurl`
- `POST /ilink/bot/getconfig`
- `POST /ilink/bot/sendtyping`

## 3. 请求与响应示例

### 3.1 获取二维码

请求：

```bash
curl 'https://ilinkai.weixin.qq.com/ilink/bot/get_bot_qrcode?bot_type=3'
```

响应：

```json
{
  "qrcode": "wechat-qrcode-token",
  "qrcode_img_content": "data:image/png;base64,iVBORw0KGgoAAA..."
}
```

### 3.2 查询二维码状态

请求：

```bash
curl 'https://ilinkai.weixin.qq.com/ilink/bot/get_qrcode_status?qrcode=wechat-qrcode-token' \
  -H 'iLink-App-ClientVersion: 1'
```

响应：

```json
{
  "status": "confirmed",
  "bot_token": "bot-token",
  "ilink_bot_id": "4a0a06b511ad@im.bot",
  "baseurl": "https://ilinkai.weixin.qq.com",
  "ilink_user_id": "o9cq80yaAQxvd3EtGXjor9gkCHJY@im.wechat"
}
```

### 3.3 拉取消息更新

请求：

```bash
curl 'https://ilinkai.weixin.qq.com/ilink/bot/getupdates' \
  -X POST \
  -H 'Content-Type: application/json' \
  -H 'AuthorizationType: ilink_bot_token' \
  -H 'Authorization: Bearer bot-token' \
  -H 'X-WECHAT-UIN: MTIzNDU2Nzg=' \
  -d '{
    "get_updates_buf": "",
    "base_info": {
      "channel_version": "weixin-local-chat/0.1.0"
    }
  }'
```

响应：

```json
{
  "ret": 0,
  "errmsg": "",
  "msgs": [
    {
      "message_id": 123456789,
      "from_user_id": "o9cq80yaAQxvd3EtGXjor9gkCHJY@im.wechat",
      "to_user_id": "4a0a06b511ad@im.bot",
      "create_time_ms": 1770000100000,
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
      "context_token": ""
    }
  ],
  "get_updates_buf": "next-cursor",
  "longpolling_timeout_ms": 35000
}
```

### 3.4 发送文本消息

请求：

```bash
curl 'https://ilinkai.weixin.qq.com/ilink/bot/sendmessage' \
  -X POST \
  -H 'Content-Type: application/json' \
  -H 'AuthorizationType: ilink_bot_token' \
  -H 'Authorization: Bearer bot-token' \
  -H 'X-WECHAT-UIN: MTIzNDU2Nzg=' \
  -d '{
    "msg": {
      "to_user_id": "o9cq80yaAQxvd3EtGXjor9gkCHJY@im.wechat",
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
      "context_token": ""
    },
    "base_info": {
      "channel_version": "weixin-local-chat/0.1.0"
    }
  }'
```

响应：

```text
ok
```

### 3.5 获取上传参数

请求：

```bash
curl 'https://ilinkai.weixin.qq.com/ilink/bot/getuploadurl' \
  -X POST \
  -H 'Content-Type: application/json' \
  -H 'AuthorizationType: ilink_bot_token' \
  -H 'Authorization: Bearer bot-token' \
  -H 'X-WECHAT-UIN: MTIzNDU2Nzg=' \
  -d '{
    "filekey": "local-file-key",
    "media_type": 1,
    "to_user_id": "o9cq80yaAQxvd3EtGXjor9gkCHJY@im.wechat",
    "rawsize": 20480,
    "rawfilemd5": "5d41402abc4b2a76b9719d911017c592",
    "filesize": 20480,
    "no_need_thumb": true,
    "aeskey": "hex-aes-key",
    "base_info": {
      "channel_version": "weixin-local-chat/0.1.0"
    }
  }'
```

响应：

```json
{
  "upload_param": "upload-token",
  "thumb_upload_param": ""
}
```

### 3.6 获取会话配置

请求：

```bash
curl 'https://ilinkai.weixin.qq.com/ilink/bot/getconfig' \
  -X POST \
  -H 'Content-Type: application/json' \
  -H 'AuthorizationType: ilink_bot_token' \
  -H 'Authorization: Bearer bot-token' \
  -H 'X-WECHAT-UIN: MTIzNDU2Nzg=' \
  -d '{
    "ilink_user_id": "o9cq80yaAQxvd3EtGXjor9gkCHJY@im.wechat",
    "context_token": "",
    "base_info": {
      "channel_version": "weixin-local-chat/0.1.0"
    }
  }'
```

响应：

```json
{
  "typing_ticket": "typing-ticket"
}
```

### 3.7 发送输入状态

请求：

```bash
curl 'https://ilinkai.weixin.qq.com/ilink/bot/sendtyping' \
  -X POST \
  -H 'Content-Type: application/json' \
  -H 'AuthorizationType: ilink_bot_token' \
  -H 'Authorization: Bearer bot-token' \
  -H 'X-WECHAT-UIN: MTIzNDU2Nzg=' \
  -d '{
    "ilink_user_id": "o9cq80yaAQxvd3EtGXjor9gkCHJY@im.wechat",
    "typing_ticket": "typing-ticket",
    "status": 1,
    "base_info": {
      "channel_version": "weixin-local-chat/0.1.0"
    }
  }'
```

响应：

```text
ok
```

## 4. 状态与枚举

二维码状态：

- `wait`
- `scaned`
- `confirmed`
- `expired`

消息项类型：

- `1`: 文本
- `2`: 图片
- `3`: 语音
- `4`: 文件
- `5`: 视频

上传媒体类型：

- `1`: 图片
- `2`: 视频
- `3`: 文件

输入状态：

- `1`: 开始输入
- `2`: 结束输入

## 5. 备注

- 本文档基于当前源码调用行为整理，不代表微信官方完整接口集合。
- `sendmessage` 与 `sendtyping` 在当前项目里按纯文本响应处理，因此文档中将其 200 响应声明为 `text/plain`。
- `getupdates` 的长轮询超时在本地代码中默认按 35 秒控制；普通 API 超时默认按 15 秒控制。
