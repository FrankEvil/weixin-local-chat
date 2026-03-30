import crypto from "node:crypto";
import { appendJsonlLog } from "../utils/jsonl-log.js";

export const SESSION_EXPIRED_ERRCODE = -14;
const DEFAULT_LONG_POLL_TIMEOUT_MS = 35_000;
const DEFAULT_API_TIMEOUT_MS = 15_000;
const CHANNEL_VERSION = "weixin-local-chat/0.1.0";

export type QrStatus = "wait" | "scaned" | "confirmed" | "expired";

export interface QrCodeResponse {
  qrcode: string;
  qrcode_img_content: string;
}

export interface QrStatusResponse {
  status: QrStatus;
  bot_token?: string;
  ilink_bot_id?: string;
  baseurl?: string;
  ilink_user_id?: string;
}

export interface GetUpdatesResp {
  ret?: number;
  errcode?: number;
  errmsg?: string;
  msgs?: WeixinMessage[];
  get_updates_buf?: string;
  longpolling_timeout_ms?: number;
}

export interface WeixinMessage {
  seq?: number;
  message_id?: number;
  from_user_id?: string;
  to_user_id?: string;
  client_id?: string;
  create_time_ms?: number;
  session_id?: string;
  message_type?: number;
  message_state?: number;
  item_list?: MessageItem[];
  context_token?: string;
}

export interface MessageItem {
  type?: number;
  text_item?: { text?: string };
  image_item?: {
    media?: CDNMedia;
    aeskey?: string;
    mid_size?: number;
  };
  voice_item?: {
    media?: CDNMedia;
    text?: string;
    encode_type?: number;
    bits_per_sample?: number;
    sample_rate?: number;
    playtime?: number;
  };
  file_item?: {
    media?: CDNMedia;
    file_name?: string;
    len?: string;
  };
  video_item?: {
    media?: CDNMedia;
    video_size?: number;
  };
  ref_msg?: {
    title?: string;
    message_item?: MessageItem;
  };
}

export interface CDNMedia {
  encrypt_query_param?: string;
  aes_key?: string;
  encrypt_type?: number;
}

export const MessageItemType = {
  TEXT: 1,
  IMAGE: 2,
  VOICE: 3,
  FILE: 4,
  VIDEO: 5,
} as const;

export const UploadMediaType = {
  IMAGE: 1,
  VIDEO: 2,
  FILE: 3,
  VOICE: 4,
} as const;

export interface WeixinClientOptions {
  baseUrl: string;
  token?: string;
}

export interface UploadUrlResp {
  upload_param?: string;
  thumb_upload_param?: string;
}

function ensureTrailingSlash(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

function randomWechatUin(): string {
  const uint32 = crypto.randomBytes(4).readUInt32BE(0);
  return Buffer.from(String(uint32), "utf-8").toString("base64");
}

function buildHeaders(body: string, token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    AuthorizationType: "ilink_bot_token",
    "Content-Length": String(Buffer.byteLength(body, "utf-8")),
    "X-WECHAT-UIN": randomWechatUin(),
  };
  if (token?.trim()) {
    headers.Authorization = `Bearer ${token.trim()}`;
  }
  return headers;
}

function redactHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers)
      .filter(([key]) => key.toLowerCase() !== "authorization"),
  );
}

function headersToObject(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

function bodySha256(body: string): string {
  return crypto.createHash("sha256").update(body).digest("hex");
}

async function fetchText(url: string, init: RequestInit, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}: ${text}`);
    }
    return text;
  } finally {
    clearTimeout(timer);
  }
}

function logWeixinApi(event: string, payload: Record<string, unknown>): void {
  appendJsonlLog("weixin-api.jsonl", event, payload);
}

export class WeixinClient {
  constructor(private readonly options: WeixinClientOptions) {}

  async fetchQrCode(botType: string): Promise<QrCodeResponse> {
    const base = ensureTrailingSlash(this.options.baseUrl);
    const url = new URL(
      `ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(botType)}`,
      base,
    ).toString();
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`fetchQrCode failed: ${response.status} ${response.statusText}`);
    }
    return (await response.json()) as QrCodeResponse;
  }

  async pollQrStatus(qrcode: string): Promise<QrStatusResponse> {
    const base = ensureTrailingSlash(this.options.baseUrl);
    const url = new URL(
      `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`,
      base,
    ).toString();
    const response = await fetch(url, {
      headers: {
        "iLink-App-ClientVersion": "1",
      },
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`pollQrStatus failed: ${response.status} ${response.statusText} ${text}`);
    }
    return (await response.json()) as QrStatusResponse;
  }

  async getUpdates(getUpdatesBuf: string, timeoutMs = DEFAULT_LONG_POLL_TIMEOUT_MS): Promise<GetUpdatesResp> {
    const body = JSON.stringify({
      get_updates_buf: getUpdatesBuf,
      base_info: { channel_version: CHANNEL_VERSION },
    });
    const base = ensureTrailingSlash(this.options.baseUrl);
    const url = new URL("ilink/bot/getupdates", base).toString();
    try {
      const text = await fetchText(
        url,
        {
          method: "POST",
          headers: buildHeaders(body, this.options.token),
          body,
        },
        timeoutMs,
      );
      return JSON.parse(text) as GetUpdatesResp;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return { ret: 0, msgs: [], get_updates_buf: getUpdatesBuf };
      }
      throw error;
    }
  }

  async sendMessage(msg: WeixinMessage): Promise<void> {
    const body = JSON.stringify({
      msg,
      base_info: { channel_version: CHANNEL_VERSION },
    });
    const base = ensureTrailingSlash(this.options.baseUrl);
    const url = new URL("ilink/bot/sendmessage", base).toString();
    const headers = buildHeaders(body, this.options.token);
    logWeixinApi("sendmessage_request", {
      baseUrl: this.options.baseUrl,
      url,
      headers: redactHeaders(headers),
      bodySize: Buffer.byteLength(body, "utf-8"),
      bodySha256: bodySha256(body),
      msg,
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEFAULT_API_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body,
        signal: controller.signal,
      });
      const text = await response.text();
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}: ${text}`);
      }
      logWeixinApi("sendmessage_response", {
        baseUrl: this.options.baseUrl,
        url,
        clientId: msg.client_id,
        status: response.status,
        statusText: response.statusText,
        headers: headersToObject(response.headers),
        responseText: text,
      });
    } catch (error) {
      logWeixinApi("sendmessage_error", {
        baseUrl: this.options.baseUrl,
        url,
        clientId: msg.client_id,
        headers: redactHeaders(headers),
        bodySize: Buffer.byteLength(body, "utf-8"),
        bodySha256: bodySha256(body),
        msg,
        error,
      });
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async getUploadUrl(payload: {
    filekey: string;
    media_type: number;
    to_user_id: string;
    rawsize: number;
    rawfilemd5: string;
    filesize: number;
    no_need_thumb: boolean;
    aeskey: string;
  }): Promise<UploadUrlResp> {
    const body = JSON.stringify({
      ...payload,
      base_info: { channel_version: CHANNEL_VERSION },
    });
    const base = ensureTrailingSlash(this.options.baseUrl);
    const url = new URL("ilink/bot/getuploadurl", base).toString();
    const headers = buildHeaders(body, this.options.token);
    logWeixinApi("getuploadurl_request", {
      baseUrl: this.options.baseUrl,
      url,
      headers: redactHeaders(headers),
      bodySize: Buffer.byteLength(body, "utf-8"),
      bodySha256: bodySha256(body),
      payload,
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEFAULT_API_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body,
        signal: controller.signal,
      });
      const text = await response.text();
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}: ${text}`);
      }
      logWeixinApi("getuploadurl_response", {
        baseUrl: this.options.baseUrl,
        url,
        filekey: payload.filekey,
        status: response.status,
        statusText: response.statusText,
        headers: headersToObject(response.headers),
        responseText: text,
      });
      return JSON.parse(text) as UploadUrlResp;
    } catch (error) {
      logWeixinApi("getuploadurl_error", {
        baseUrl: this.options.baseUrl,
        url,
        headers: redactHeaders(headers),
        bodySize: Buffer.byteLength(body, "utf-8"),
        bodySha256: bodySha256(body),
        payload,
        error,
      });
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async getConfig(ilinkUserId: string, contextToken = ""): Promise<{ typing_ticket?: string }> {
    const body = JSON.stringify({
      ilink_user_id: ilinkUserId,
      context_token: contextToken,
      base_info: { channel_version: CHANNEL_VERSION },
    });
    const base = ensureTrailingSlash(this.options.baseUrl);
    const url = new URL("ilink/bot/getconfig", base).toString();
    const text = await fetchText(
      url,
      {
        method: "POST",
        headers: buildHeaders(body, this.options.token),
        body,
      },
      DEFAULT_API_TIMEOUT_MS,
    );
    return JSON.parse(text) as { typing_ticket?: string };
  }

  async sendTyping(ilinkUserId: string, typingTicket: string, status: 1 | 2): Promise<void> {
    const body = JSON.stringify({
      ilink_user_id: ilinkUserId,
      typing_ticket: typingTicket,
      status,
      base_info: { channel_version: CHANNEL_VERSION },
    });
    const base = ensureTrailingSlash(this.options.baseUrl);
    const url = new URL("ilink/bot/sendtyping", base).toString();
    await fetchText(
      url,
      {
        method: "POST",
        headers: buildHeaders(body, this.options.token),
        body,
      },
      DEFAULT_API_TIMEOUT_MS,
    );
  }
}
