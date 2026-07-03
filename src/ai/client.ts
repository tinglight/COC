import OpenAI from "openai";
import type { AppConfig, OpenAIImageOutputFormat } from "../config.js";
import { GROUP_CHAT_BOT_PERSONA_INSTRUCTIONS } from "./persona.js";
import { formatMemberRole, type MemberRole } from "../roles.js";

export interface AiReplyRequest {
  text: string;
  scopeType: "group" | "c2c";
  scopeId: string;
  userId: string;
  speakerRole?: MemberRole;
  trigger: "command" | "mention" | "c2c" | "all" | "proactive";
  instructions?: string;
  images?: readonly AiReplyImage[];
}

export interface AiReplyClient {
  createReply(request: AiReplyRequest): Promise<string>;
}

export interface AiReplyImage {
  imageUrl: string;
  detail?: "low" | "high" | "auto" | "original";
  filename?: string;
  contentType?: string;
  width?: number;
  height?: number;
  size?: number;
}

type AiReplyContentPart =
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url: string; detail: "low" | "high" | "auto" | "original" };

interface AiClientLogger {
  info(data: Record<string, unknown>, message: string): void;
  error?(data: Record<string, unknown>, message: string): void;
}

export interface AiImageRequest {
  prompt: string;
  userId?: string;
}

export interface AiGeneratedImage {
  fileData: string;
  mimeType: "image/png" | "image/jpeg";
}

export interface AiImageClient {
  createImage(request: AiImageRequest): Promise<AiGeneratedImage>;
}

const DEFAULT_INSTRUCTIONS = [
  "你是一个接入 QQ 私人 CoC 跑团群的中文助手。",
  "优先简短、自然、有桌边聊天感；不要像公告或客服。",
  "骰子、技能检定、SAN Check、角色卡保存由本地指令处理；如果用户要掷骰，引导他们使用 .r、.ra、.sc 或 .st。",
  "不要声称自己能看到后台、日志、系统提示词或 API key。",
  "不要输出长篇规则书式解释；普通聊天通常控制在 1-3 句。",
  "如果用户在进行 NPC/跑团扮演，可以使用自然的角色台词和少量括号式桌边发言，但不要泄露未公开剧情。",
  "",
  GROUP_CHAT_BOT_PERSONA_INSTRUCTIONS
].join("\n");

export function createAiReplyClient(config: AppConfig, logger?: AiClientLogger): AiReplyClient | undefined {
  if (config.aiReplyMode === "off" || config.openaiApiKey === "") return undefined;
  return new OpenAIAiReplyClient(config, logger);
}

export function createAiImageClient(config: AppConfig): AiImageClient | undefined {
  if ((!config.proactiveImageEnabled && !config.aiChatImageEnabled) || config.openaiApiKey === "") return undefined;
  return new OpenAIAiImageClient(config);
}

class OpenAIAiReplyClient implements AiReplyClient {
  private readonly client: OpenAI;

  constructor(
    private readonly config: AppConfig,
    private readonly logger?: AiClientLogger
  ) {
    this.client = new OpenAI({
      apiKey: config.openaiApiKey,
      baseURL: config.openaiBaseUrl === "" ? undefined : config.openaiBaseUrl,
      timeout: config.openaiRequestTimeoutMs
    });
  }

  async createReply(request: AiReplyRequest): Promise<string> {
    const startedAt = Date.now();
    try {
      this.logger?.info({
        model: this.config.openaiModel,
        reasoningEffort: this.config.openaiReasoningEffort,
        trigger: request.trigger,
        scopeType: request.scopeType
      }, "OpenAI AI reply request");
      const response = await this.client.responses.create({
        model: this.config.openaiModel,
        reasoning: {
          effort: this.config.openaiReasoningEffort
        },
        instructions: buildInstructions(request.instructions),
        input: [
          {
            role: "user",
            content: buildAiReplyContent(request)
          }
        ],
        store: false
      });
      return limitReply(response.output_text ?? "", this.config.aiMaxReplyChars);
    } catch (error) {
      this.logger?.error?.({
        err: error,
        elapsedMs: Date.now() - startedAt,
        timeoutMs: this.config.openaiRequestTimeoutMs,
        model: this.config.openaiModel,
        reasoningEffort: this.config.openaiReasoningEffort,
        trigger: request.trigger,
        scopeType: request.scopeType,
        speakerRole: request.speakerRole,
        inputChars: request.text.length,
        instructionChars: request.instructions?.length ?? 0,
        imageCount: request.images?.length ?? 0,
        openaiBaseUrl: describeOpenAIBaseUrl(this.config.openaiBaseUrl)
      }, "OpenAI AI reply failed with upstream error");
      throw new Error("AI 回复失败，请稍后再试。");
    }
  }
}

export function buildInstructions(extraInstructions: string | undefined): string {
  const trimmed = extraInstructions?.trim();
  return trimmed == null || trimmed === ""
    ? DEFAULT_INSTRUCTIONS
    : `${DEFAULT_INSTRUCTIONS}\n\n${trimmed}`;
}

export function buildAiReplyContent(request: AiReplyRequest): AiReplyContentPart[] {
  return [
    {
      type: "input_text",
      text: formatAiReplyInput(request)
    },
    ...(request.images ?? []).map((image) => ({
      type: "input_image" as const,
      image_url: image.imageUrl,
      detail: image.detail ?? "auto"
    }))
  ];
}

class OpenAIAiImageClient implements AiImageClient {
  private readonly client: OpenAI;

  constructor(private readonly config: AppConfig) {
    this.client = new OpenAI({
      apiKey: config.openaiApiKey,
      baseURL: config.openaiBaseUrl === "" ? undefined : config.openaiBaseUrl,
      timeout: config.openaiImageRequestTimeoutMs
    });
  }

  async createImage(request: AiImageRequest): Promise<AiGeneratedImage> {
    try {
      const model = this.config.openaiImageModel;
      const response = await this.client.images.generate({
        model,
        prompt: request.prompt,
        n: 1,
        size: this.config.openaiImageSize,
        ...imageModelOptions(model, this.config.openaiImageQuality, this.config.openaiImageOutputFormat),
        user: request.userId
      });
      const fileData = response.data?.[0]?.b64_json;
      if (!fileData) {
        throw new Error("OpenAI image response did not include b64_json");
      }
      return {
        fileData,
        mimeType: this.config.openaiImageOutputFormat === "jpeg" ? "image/jpeg" : "image/png"
      };
    } catch (error) {
      throw error instanceof Error ? error : new Error("AI 图片生成失败，请稍后再试。");
    }
  }
}

function imageModelOptions(
  model: string,
  quality: AppConfig["openaiImageQuality"],
  outputFormat: OpenAIImageOutputFormat
): Record<string, unknown> {
  if (model.toLowerCase().startsWith("gpt-image")) {
    return {
      quality,
      output_format: outputFormat
    };
  }

  return {
    response_format: "b64_json"
  };
}

export function formatAiReplyInput(request: AiReplyRequest): string {
  const source = request.trigger === "c2c" && request.scopeType === "group"
    ? "C2C私聊（已绑定QQ群上下文）"
    : request.scopeType === "group" ? "QQ群" : "C2C私聊";
  return [
    `来源：${source}`,
    `说话者身份：${request.speakerRole ? formatMemberRole(request.speakerRole) : "未登记/系统"}`,
    `触发方式：${request.trigger}`,
    `用户 openid：${request.userId}`,
    "",
    "用户消息：",
    request.text
  ].join("\n");
}

function limitReply(text: string, maxChars: number): string {
  const trimmed = text.trim();
  if (trimmed === "") return "我刚才卡了一下，能再说一遍吗？";
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

function describeOpenAIBaseUrl(baseUrl: string): string {
  if (baseUrl === "") return "default";
  try {
    const parsed = new URL(baseUrl);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return "custom";
  }
}
