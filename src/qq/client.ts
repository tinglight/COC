import type { AppConfig } from "../config.js";
import type { MessageTarget, OutgoingQQMessage, QQImageSource } from "./types.js";

interface AccessTokenState {
  token: string;
  expiresAt: number;
}

interface UploadMediaResponse {
  file_info?: string;
}

export class QQOpenApiClient {
  private accessToken?: AccessTokenState;

  constructor(private readonly config: Pick<AppConfig, "appId" | "appSecret" | "apiBaseUrl" | "tokenUrl">) {}

  async sendTextMessage(target: MessageTarget, content: string, msgId?: string, msgSeq = 1): Promise<void> {
    await this.sendMessage(target, { type: "text", content }, msgId, msgSeq);
  }

  async sendMarkdownMessage(target: MessageTarget, content: string, msgId?: string, msgSeq = 1): Promise<void> {
    await this.sendMessage(target, { type: "markdown", content }, msgId, msgSeq);
  }

  async sendImageMessage(target: MessageTarget, image: QQImageSource | string, msgId?: string, msgSeq = 1): Promise<void> {
    const source = typeof image === "string" ? { url: image } : image;
    const fileInfo = await this.uploadImage(target, source);
    await this.sendMessage(target, { type: "media", fileInfo }, msgId, msgSeq);
  }

  async sendMessage(target: MessageTarget, message: OutgoingQQMessage, msgId?: string, msgSeq = 1): Promise<void> {
    const body = buildMessageBody(message, msgId, msgSeq);

    if (target.type === "group") {
      await this.post(`/v2/groups/${encodeURIComponent(target.groupOpenid)}/messages`, body);
      return;
    }

    await this.post(`/v2/users/${encodeURIComponent(target.userOpenid)}/messages`, body);
  }

  private async uploadImage(target: MessageTarget, source: QQImageSource): Promise<string> {
    const body = {
      file_type: 1,
      srv_send_msg: false,
      ...buildImageSourceBody(source)
    };
    const path = target.type === "group"
      ? `/v2/groups/${encodeURIComponent(target.groupOpenid)}/files`
      : `/v2/users/${encodeURIComponent(target.userOpenid)}/files`;
    const payload = await this.post(path, body) as UploadMediaResponse;
    if (!payload.file_info) {
      throw new Error(`QQ image upload did not return file_info: ${JSON.stringify(payload)}`);
    }
    return payload.file_info;
  }

  private async post(path: string, body: unknown): Promise<unknown> {
    const token = await this.getAccessToken();
    const response = await fetch(`${this.config.apiBaseUrl}${path}`, {
      method: "POST",
      headers: {
        "Authorization": `QQBot ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8_000)
    });

    const text = await response.text();
    const payload = text === "" ? undefined : JSON.parse(text) as unknown;
    if (!response.ok) {
      throw new Error(`QQ API ${response.status}: ${text}`);
    }
    return payload;
  }

  private async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.accessToken && this.accessToken.expiresAt - now > 60_000) {
      return this.accessToken.token;
    }
    if (this.config.appId === "" || this.config.appSecret === "") {
      throw new Error("QQ_APP_ID and QQ_APP_SECRET are required to send QQ messages");
    }

    const response = await fetch(this.config.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appId: this.config.appId, clientSecret: this.config.appSecret }),
      signal: AbortSignal.timeout(8_000)
    });
    const payload = await response.json() as { access_token?: string; expires_in?: number | string };
    if (!response.ok || !payload.access_token) {
      throw new Error(`Failed to get QQ access token: ${JSON.stringify(payload)}`);
    }

    const expiresInSeconds = Number(payload.expires_in ?? 7200);
    this.accessToken = {
      token: payload.access_token,
      expiresAt: now + expiresInSeconds * 1000
    };
    return this.accessToken.token;
  }
}

function buildMessageBody(message: OutgoingQQMessage, msgId: string | undefined, msgSeq: number): Record<string, unknown> {
  const base = msgId == null ? {} : { msg_id: msgId, msg_seq: msgSeq };
  if (message.type === "text") {
    return {
      content: message.content,
      msg_type: 0,
      ...base
    };
  }

  if (message.type === "markdown") {
    return {
      msg_type: 2,
      markdown: {
        content: message.content
      },
      ...base
    };
  }

  return {
    msg_type: 7,
    media: {
      file_info: message.fileInfo
    },
    ...base
  };
}

function buildImageSourceBody(source: QQImageSource): { url: string } | { file_data: string } {
  if ("url" in source) {
    const url = source.url.trim();
    if (!/^https?:\/\//i.test(url)) {
      throw new Error("QQ image URL must start with http:// or https://");
    }
    return { url };
  }

  const fileData = source.fileData.trim();
  if (fileData === "") {
    throw new Error("QQ image fileData must not be empty");
  }
  return { file_data: fileData };
}
