# 微信上游接口文档（OpenAPI Markdown）

本文档仅描述本项目依赖的微信上游通讯接口，不包含本地服务 `/api/*` 路由。

## 1. OpenAPI 3.1 规范

完整的 OpenAPI 3.1 规范文件请查看：[weixin-upstream-openapi-3.1.yaml](./weixin-upstream-openapi-3.1.yaml)

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
