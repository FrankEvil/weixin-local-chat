import crypto, { createCipheriv, createDecipheriv } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { UploadMediaType, type CDNMedia, type MessageItem } from "../api/weixin.js";
import type { UploadKind } from "../types.js";
import { WeixinClient } from "../api/weixin.js";
import { appendJsonlLog } from "../utils/jsonl-log.js";

function buildCdnUploadUrl(cdnBaseUrl: string, uploadParam: string, filekey: string): string {
  return `${cdnBaseUrl}/upload?encrypted_query_param=${encodeURIComponent(uploadParam)}&filekey=${encodeURIComponent(filekey)}`;
}

function buildCdnDownloadUrl(cdnBaseUrl: string, encryptedQueryParam: string): string {
  return `${cdnBaseUrl}/download?encrypted_query_param=${encodeURIComponent(encryptedQueryParam)}`;
}

function encryptAesEcb(buffer: Buffer, key: Buffer): Buffer {
  const cipher = createCipheriv("aes-128-ecb", key, null);
  return Buffer.concat([cipher.update(buffer), cipher.final()]);
}

function decryptAesEcb(buffer: Buffer, key: Buffer): Buffer {
  const decipher = createDecipheriv("aes-128-ecb", key, null);
  return Buffer.concat([decipher.update(buffer), decipher.final()]);
}

function aesEcbPaddedSize(plaintextSize: number): number {
  return Math.ceil((plaintextSize + 1) / 16) * 16;
}

function parseAesKey(aesKeyBase64: string): Buffer {
  const decoded = Buffer.from(aesKeyBase64, "base64");
  if (decoded.length === 16) {
    return decoded;
  }
  if (decoded.length === 32 && /^[0-9a-fA-F]{32}$/.test(decoded.toString("ascii"))) {
    return Buffer.from(decoded.toString("ascii"), "hex");
  }
  throw new Error(`Unsupported aes_key encoding, decoded length=${decoded.length}`);
}

function fileExt(name: string): string {
  return path.extname(name).toLowerCase();
}

export function detectUploadKind(fileName: string, mimeType: string): UploadKind {
  const lowerMime = mimeType.toLowerCase();
  const ext = fileExt(fileName);
  if (
    lowerMime.startsWith("audio/")
    || [".silk", ".wav", ".mp3", ".m4a", ".aac", ".ogg", ".opus"].includes(ext)
  ) {
    return "voice";
  }
  if (lowerMime.startsWith("image/") || [".jpg", ".jpeg", ".png", ".gif", ".webp"].includes(ext)) {
    return "image";
  }
  if (lowerMime.startsWith("video/") || [".mp4", ".mov", ".mkv", ".webm"].includes(ext)) {
    return "video";
  }
  return "file";
}

function replaceFileExtension(fileName: string, nextExtension: string): string {
  const parsed = path.parse(fileName);
  return `${parsed.name || "voice"}${nextExtension}`;
}

const TARGET_WECHAT_VOICE_SAMPLE_RATE = 16_000;

function toUploadMediaType(kind: UploadKind): number {
  if (kind === "image") return UploadMediaType.IMAGE;
  if (kind === "video") return UploadMediaType.VIDEO;
  if (kind === "voice") return UploadMediaType.VOICE;
  return UploadMediaType.FILE;
}

function logWeixinMedia(event: string, payload: Record<string, unknown>): void {
  appendJsonlLog("weixin-media.jsonl", event, payload);
}

export interface UploadedMedia {
  kind: UploadKind;
  fileName: string;
  mimeType: string;
  plaintextSize: number;
  ciphertextSize: number;
  aesKeyHex: string;
  encryptedQueryParam: string;
}

export interface VoiceItemMetadata {
  encodeType?: number;
  bitsPerSample?: number;
  sampleRate?: number;
  playtime?: number;
}

export interface NormalizedVoiceMedia {
  bytes: Buffer;
  fileName: string;
  mimeType: string;
  metadata?: VoiceItemMetadata;
}

interface Pcm16MonoWavData {
  sampleRate: number;
  bitsPerSample: number;
  pcm: Int16Array;
}

function extractPcm16MonoWav(bytes: Buffer): Pcm16MonoWavData | null {
  if (bytes.length < 44) return null;
  if (bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WAVE") {
    return null;
  }

  let offset = 12;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let channels = 0;
  let audioFormat = 0;
  let dataOffset = -1;
  let dataSize = 0;

  while (offset + 8 <= bytes.length) {
    const chunkId = bytes.toString("ascii", offset, offset + 4);
    const chunkSize = bytes.readUInt32LE(offset + 4);
    const chunkDataOffset = offset + 8;
    if (chunkDataOffset + chunkSize > bytes.length) {
      return null;
    }

    if (chunkId === "fmt " && chunkSize >= 16) {
      audioFormat = bytes.readUInt16LE(chunkDataOffset);
      channels = bytes.readUInt16LE(chunkDataOffset + 2);
      sampleRate = bytes.readUInt32LE(chunkDataOffset + 4);
      bitsPerSample = bytes.readUInt16LE(chunkDataOffset + 14);
    } else if (chunkId === "data") {
      dataOffset = chunkDataOffset;
      dataSize = chunkSize;
      break;
    }

    offset = chunkDataOffset + chunkSize + (chunkSize % 2);
  }

  if (audioFormat !== 1 || channels !== 1 || bitsPerSample !== 16 || dataOffset < 0 || dataSize <= 0) {
    return null;
  }

  const pcmBytes = bytes.subarray(dataOffset, dataOffset + dataSize);
  const pcm = new Int16Array(pcmBytes.buffer.slice(
    pcmBytes.byteOffset,
    pcmBytes.byteOffset + pcmBytes.byteLength,
  ));
  return {
    sampleRate,
    bitsPerSample,
    pcm,
  };
}

function resamplePcm16Mono(input: Int16Array, fromRate: number, toRate: number): Int16Array {
  if (fromRate === toRate || input.length === 0) {
    return input;
  }
  const outputLength = Math.max(1, Math.round(input.length * toRate / fromRate));
  const output = new Int16Array(outputLength);
  const ratio = fromRate / toRate;

  for (let index = 0; index < outputLength; index += 1) {
    const sourceIndex = index * ratio;
    const left = Math.floor(sourceIndex);
    const right = Math.min(left + 1, input.length - 1);
    const weight = sourceIndex - left;
    const sample = input[left] * (1 - weight) + input[right] * weight;
    output[index] = Math.max(-32768, Math.min(32767, Math.round(sample)));
  }
  return output;
}

export async function normalizeOutboundVoiceMedia(params: {
  fileName: string;
  mimeType: string;
  bytes: Buffer;
}): Promise<NormalizedVoiceMedia> {
  const { bytes } = params;
  const { encode, getDuration, getWavFileInfo, isSilk, isWav } = await import("silk-wasm");

  if (isSilk(bytes)) {
    return {
      bytes,
      fileName: params.fileName.toLowerCase().endsWith(".silk")
        ? params.fileName
        : replaceFileExtension(params.fileName, ".silk"),
      mimeType: "audio/silk",
      metadata: {
        encodeType: 4,
        bitsPerSample: 16,
        sampleRate: TARGET_WECHAT_VOICE_SAMPLE_RATE,
        playtime: getDuration(bytes),
      },
    };
  }

  if (isWav(bytes)) {
    const wavInfo = getWavFileInfo(bytes);
    const pcm16Mono = extractPcm16MonoWav(bytes);
    const wavForEncode = pcm16Mono && pcm16Mono.sampleRate !== TARGET_WECHAT_VOICE_SAMPLE_RATE
      ? pcmBytesToWav(
        new Uint8Array(
          resamplePcm16Mono(
            pcm16Mono.pcm,
            pcm16Mono.sampleRate,
            TARGET_WECHAT_VOICE_SAMPLE_RATE,
          ).buffer,
        ),
        TARGET_WECHAT_VOICE_SAMPLE_RATE,
      )
      : bytes;
    const encoded = await encode(wavForEncode, 0);
    return {
      bytes: Buffer.from(encoded.data),
      fileName: replaceFileExtension(params.fileName, ".silk"),
      mimeType: "audio/silk",
      metadata: {
        encodeType: 4,
        bitsPerSample: wavInfo.fmt.bitsPerSample,
        sampleRate: pcm16Mono ? TARGET_WECHAT_VOICE_SAMPLE_RATE : wavInfo.fmt.sampleRate,
        playtime: encoded.duration,
      },
    };
  }

  return {
    bytes,
    fileName: params.fileName,
    mimeType: params.mimeType,
  };
}

export async function uploadMedia(params: {
  client: WeixinClient;
  cdnBaseUrl: string;
  peerId: string;
  fileName: string;
  mimeType: string;
  bytes: Buffer;
  kindOverride?: UploadKind;
}): Promise<UploadedMedia> {
  const kind = params.kindOverride ?? detectUploadKind(params.fileName, params.mimeType);
  const filekey = crypto.randomBytes(16).toString("hex");
  const aesKey = crypto.randomBytes(16);
  const rawsize = params.bytes.length;
  const rawfilemd5 = crypto.createHash("md5").update(params.bytes).digest("hex");
  const filesize = aesEcbPaddedSize(rawsize);

  const uploadResp = await params.client.getUploadUrl({
    filekey,
    media_type: toUploadMediaType(kind),
    to_user_id: params.peerId,
    rawsize,
    rawfilemd5,
    filesize,
    no_need_thumb: true,
    aeskey: aesKey.toString("hex"),
  });

  logWeixinMedia("cdn_prepare_upload", {
    peerId: params.peerId,
    fileName: params.fileName,
    mimeType: params.mimeType,
    kind,
    filekey,
    rawsize,
    rawfilemd5,
    filesize,
    uploadMediaType: toUploadMediaType(kind),
    uploadParamPresent: Boolean(uploadResp.upload_param),
  });

  if (!uploadResp.upload_param) {
    throw new Error("getUploadUrl missing upload_param");
  }

  const uploadUrl = buildCdnUploadUrl(params.cdnBaseUrl, uploadResp.upload_param, filekey);
  const encrypted = encryptAesEcb(params.bytes, aesKey);
  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
    },
    body: new Uint8Array(encrypted),
  });
  const responseText = await response.text().catch(() => "");
  logWeixinMedia("cdn_upload_response", {
    peerId: params.peerId,
    fileName: params.fileName,
    kind,
    uploadUrl,
    status: response.status,
    statusText: response.statusText,
    encryptedSize: encrypted.length,
    responseText,
    encryptedQueryParam: response.headers.get("x-encrypted-param"),
  });
  if (!response.ok) {
    throw new Error(`CDN upload failed: ${response.status} ${response.statusText} ${responseText}`);
  }
  const encryptedQueryParam = response.headers.get("x-encrypted-param");
  if (!encryptedQueryParam) {
    throw new Error("CDN upload success but missing x-encrypted-param");
  }

  return {
    kind,
    fileName: params.fileName,
    mimeType: params.mimeType,
    plaintextSize: rawsize,
    ciphertextSize: filesize,
    aesKeyHex: aesKey.toString("hex"),
    encryptedQueryParam,
  };
}

export function uploadedMediaToItem(
  uploaded: UploadedMedia,
  options?: { voiceText?: string; voiceMetadata?: VoiceItemMetadata },
): MessageItem {
  const media: CDNMedia = {
    encrypt_query_param: uploaded.encryptedQueryParam,
    // Match the official plugin's encoding: base64 of the hex string, not base64 of raw 16 bytes.
    aes_key: Buffer.from(uploaded.aesKeyHex).toString("base64"),
  };

  if (uploaded.kind === "image") {
    return {
      type: 2,
      image_item: {
        media: {
          ...media,
          encrypt_type: 1,
        },
        aeskey: uploaded.aesKeyHex,
        mid_size: uploaded.ciphertextSize,
      },
    };
  }
  if (uploaded.kind === "video") {
    return {
      type: 5,
      video_item: {
        media: {
          ...media,
          encrypt_type: 1,
        },
        video_size: uploaded.ciphertextSize,
      },
    };
  }
  if (uploaded.kind === "voice") {
    return {
      type: 3,
      voice_item: {
        media,
        text: options?.voiceText?.trim() ?? "",
        encode_type: options?.voiceMetadata?.encodeType,
        bits_per_sample: options?.voiceMetadata?.bitsPerSample,
        sample_rate: options?.voiceMetadata?.sampleRate,
        playtime: options?.voiceMetadata?.playtime,
      },
    };
  }
  return {
    type: 4,
    file_item: {
      media: {
        ...media,
        encrypt_type: 1,
      },
      file_name: uploaded.fileName,
      len: String(uploaded.plaintextSize),
    },
  };
}

export async function downloadInboundMedia(params: {
  cdnBaseUrl: string;
  media: CDNMedia;
  fallbackHexKey?: string;
  fileName: string;
  destDir: string;
}): Promise<string> {
  const encryptedQueryParam = params.media.encrypt_query_param;
  if (!encryptedQueryParam) {
    throw new Error("downloadInboundMedia missing encrypted_query_param");
  }

  const url = buildCdnDownloadUrl(params.cdnBaseUrl, encryptedQueryParam);
  const response = await fetch(url);
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`CDN download failed: ${response.status} ${response.statusText} ${text}`);
  }
  const encrypted = Buffer.from(await response.arrayBuffer());
  const key =
    params.fallbackHexKey?.trim()
      ? Buffer.from(params.fallbackHexKey, "hex")
      : params.media.aes_key
        ? parseAesKey(params.media.aes_key)
        : null;
  const plaintext = key ? decryptAesEcb(encrypted, key) : encrypted;
  fs.mkdirSync(params.destDir, { recursive: true });
  const targetPath = path.join(params.destDir, params.fileName);
  fs.writeFileSync(targetPath, plaintext);
  return targetPath;
}

function pcmBytesToWav(pcm: Uint8Array, sampleRate: number): Buffer {
  const pcmBytes = pcm.byteLength;
  const totalSize = 44 + pcmBytes;
  const buf = Buffer.allocUnsafe(totalSize);
  let offset = 0;

  buf.write("RIFF", offset);
  offset += 4;
  buf.writeUInt32LE(totalSize - 8, offset);
  offset += 4;
  buf.write("WAVE", offset);
  offset += 4;

  buf.write("fmt ", offset);
  offset += 4;
  buf.writeUInt32LE(16, offset);
  offset += 4;
  buf.writeUInt16LE(1, offset);
  offset += 2;
  buf.writeUInt16LE(1, offset);
  offset += 2;
  buf.writeUInt32LE(sampleRate, offset);
  offset += 4;
  buf.writeUInt32LE(sampleRate * 2, offset);
  offset += 4;
  buf.writeUInt16LE(2, offset);
  offset += 2;
  buf.writeUInt16LE(16, offset);
  offset += 2;

  buf.write("data", offset);
  offset += 4;
  buf.writeUInt32LE(pcmBytes, offset);
  offset += 4;
  Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength).copy(buf, offset);

  return buf;
}

export async function transcodeSilkFileToWav(filePath: string): Promise<string | null> {
  try {
    const silkBuf = fs.readFileSync(filePath);
    const { decode } = await import("silk-wasm");
    const result = await decode(silkBuf, 24_000);
    const wav = pcmBytesToWav(result.data, 24_000);
    const wavPath = filePath.replace(/\.silk$/i, "") + ".wav";
    fs.writeFileSync(wavPath, wav);
    return wavPath;
  } catch {
    return null;
  }
}
