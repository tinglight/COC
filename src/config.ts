import path from "node:path";
import dotenv from "dotenv";

dotenv.config();

export interface ProactiveNarrator {
  name: string;
  avatarUrl: string;
  subtitle: string;
}

export type OpenAIImageQuality = "low" | "medium" | "high" | "auto";
export type OpenAIImageOutputFormat = "png" | "jpeg";
export type OpenAIReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh";

export interface AppConfig {
  appId: string;
  appSecret: string;
  botSecret: string;
  validationSecretSource: "auto" | "appSecret" | "botSecret";
  allowedGroupOpenids: Set<string>;
  databasePath: string;
  assetDir: string;
  port: number;
  verifySignatures: boolean;
  apiBaseUrl: string;
  tokenUrl: string;
  userRateLimitMax: number;
  userRateLimitWindowMs: number;
  groupRateLimitMax: number;
  groupRateLimitWindowMs: number;
  openaiApiKey: string;
  openaiModel: string;
  openaiReasoningEffort: OpenAIReasoningEffort;
  openaiBaseUrl: string;
  openaiRequestTimeoutMs: number;
  openaiImageModel: string;
  openaiImageSize: string;
  openaiImageQuality: OpenAIImageQuality;
  openaiImageOutputFormat: OpenAIImageOutputFormat;
  openaiImageRequestTimeoutMs: number;
  aiReplyMode: "off" | "command" | "mention" | "all";
  aiMaxReplyChars: number;
  proactiveChatEnabled: boolean;
  proactiveGroupOpenids: Set<string>;
  proactiveIdleWindowMs: number;
  proactiveCheckIntervalMs: number;
  proactiveMinGapMs: number;
  proactiveChance: number;
  proactivePrompt: string;
  proactiveMarkdownEnabled: boolean;
  proactiveMarkdownNarrators: ProactiveNarrator[];
  proactiveImageEnabled: boolean;
  proactiveImagePrompt: string;
}

function readString(name: string, fallback = ""): string {
  const value = process.env[name];
  return value == null || value.trim() === "" ? fallback : value.trim();
}

function readNumber(name: string, fallback: number): number {
  const raw = readString(name);
  if (raw === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive number`);
  }
  return parsed;
}

function readRatio(name: string, fallback: number): number {
  const raw = readString(name);
  if (raw === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error(`${name} must be a number between 0 and 1`);
  }
  return parsed;
}

function readBoolean(name: string, fallback: boolean): boolean {
  const raw = readString(name);
  if (raw === "") return fallback;
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

function minutesToMs(name: string, fallbackMinutes: number): number {
  return readNumber(name, fallbackMinutes) * 60_000;
}

function readSet(name: string): Set<string> {
  const raw = readString(name);
  if (raw === "") return new Set();
  return new Set(raw.split(/[,\s;]+/).map((item) => item.trim()).filter(Boolean));
}

function readAiReplyMode(): AppConfig["aiReplyMode"] {
  const raw = readString("AI_REPLY_MODE", "mention").toLowerCase();
  if (raw === "off" || raw === "command" || raw === "mention" || raw === "all") {
    return raw;
  }
  throw new Error("AI_REPLY_MODE must be one of: off, command, mention, all");
}

function readImageQuality(): OpenAIImageQuality {
  const raw = readString("OPENAI_IMAGE_QUALITY", "low").toLowerCase();
  if (raw === "low" || raw === "medium" || raw === "high" || raw === "auto") return raw;
  throw new Error("OPENAI_IMAGE_QUALITY must be one of: low, medium, high, auto");
}

function readImageOutputFormat(): OpenAIImageOutputFormat {
  const raw = readString("OPENAI_IMAGE_OUTPUT_FORMAT", "png").toLowerCase();
  if (raw === "png" || raw === "jpeg" || raw === "jpg") return raw === "jpg" ? "jpeg" : raw;
  throw new Error("OPENAI_IMAGE_OUTPUT_FORMAT must be png or jpeg");
}

function readOpenAIReasoningEffort(): OpenAIReasoningEffort {
  const raw = readString("OPENAI_REASONING_EFFORT", "medium").toLowerCase();
  if (raw === "none" || raw === "minimal" || raw === "low" || raw === "medium" || raw === "high" || raw === "xhigh") {
    return raw;
  }
  throw new Error("OPENAI_REASONING_EFFORT must be one of: none, minimal, low, medium, high, xhigh");
}

function readValidationSecretSource(): AppConfig["validationSecretSource"] {
  const raw = readString("QQ_VALIDATION_SECRET_SOURCE", "auto").toLowerCase();
  if (raw === "auto" || raw === "appsecret" || raw === "app_secret") return raw === "auto" ? "auto" : "appSecret";
  if (raw === "botsecret" || raw === "bot_secret") return "botSecret";
  throw new Error("QQ_VALIDATION_SECRET_SOURCE must be one of: auto, appSecret, botSecret");
}

function readProactiveMarkdownNarrators(): ProactiveNarrator[] {
  const raw = readString("PROACTIVE_MARKDOWN_NARRATORS");
  if (raw === "") return [];

  return raw
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [rawName = "", rawAvatarUrl = "", rawSubtitle = ""] = entry.split("|").map((part) => part.trim());
      const avatarUrl = rawAvatarUrl;
      if (avatarUrl !== "" && !/^https?:\/\//i.test(avatarUrl)) {
        throw new Error("PROACTIVE_MARKDOWN_NARRATORS avatar URL must start with http:// or https://");
      }
      return {
        name: rawName === "" ? "叙述者" : rawName,
        avatarUrl,
        subtitle: rawSubtitle
      };
    });
}

export function loadConfig(): AppConfig {
  const assetDir = path.resolve(readString("ASSET_DIR", "./data/assets"));

  return {
    appId: readString("QQ_APP_ID"),
    appSecret: readString("QQ_APP_SECRET"),
    botSecret: readString("QQ_BOT_SECRET", readString("QQ_APP_SECRET")),
    validationSecretSource: readValidationSecretSource(),
    allowedGroupOpenids: readSet("QQ_ALLOWED_GROUP_OPENIDS"),
    databasePath: path.resolve(readString("DATABASE_PATH", "./data/bot.sqlite")),
    assetDir,
    port: readNumber("PORT", 3000),
    verifySignatures: readBoolean("QQ_VERIFY_SIGNATURES", true),
    apiBaseUrl: readString("QQ_API_BASE_URL", "https://api.sgroup.qq.com").replace(/\/+$/, ""),
    tokenUrl: readString("QQ_TOKEN_URL", "https://bots.qq.com/app/getAppAccessToken"),
    userRateLimitMax: readNumber("USER_RATE_LIMIT_MAX", 8),
    userRateLimitWindowMs: readNumber("USER_RATE_LIMIT_WINDOW_MS", 30_000),
    groupRateLimitMax: readNumber("GROUP_RATE_LIMIT_MAX", 18),
    groupRateLimitWindowMs: readNumber("GROUP_RATE_LIMIT_WINDOW_MS", 60_000),
    openaiApiKey: readString("OPENAI_API_KEY"),
    openaiModel: readString("OPENAI_MODEL", "gpt-5.5"),
    openaiReasoningEffort: readOpenAIReasoningEffort(),
    openaiBaseUrl: readString("OPENAI_BASE_URL").replace(/\/+$/, ""),
    openaiRequestTimeoutMs: readNumber("OPENAI_REQUEST_TIMEOUT_MS", 20_000),
    openaiImageModel: readString("OPENAI_IMAGE_MODEL", "gpt-image-2"),
    openaiImageSize: readString("OPENAI_IMAGE_SIZE", "1024x1024"),
    openaiImageQuality: readImageQuality(),
    openaiImageOutputFormat: readImageOutputFormat(),
    openaiImageRequestTimeoutMs: readNumber("OPENAI_IMAGE_REQUEST_TIMEOUT_MS", 120_000),
    aiReplyMode: readAiReplyMode(),
    aiMaxReplyChars: readNumber("AI_MAX_REPLY_CHARS", 900),
    proactiveChatEnabled: readBoolean("PROACTIVE_CHAT_ENABLED", false),
    proactiveGroupOpenids: readSet("PROACTIVE_GROUP_OPENIDS"),
    proactiveIdleWindowMs: minutesToMs("PROACTIVE_IDLE_MINUTES", 45),
    proactiveCheckIntervalMs: minutesToMs("PROACTIVE_CHECK_MINUTES", 5),
    proactiveMinGapMs: minutesToMs("PROACTIVE_MIN_GAP_MINUTES", 120),
    proactiveChance: readRatio("PROACTIVE_CHANCE", 0.35),
    proactivePrompt: readString(
      "PROACTIVE_PROMPT",
      "The QQ group has been quiet for a while. Continue one coherent Chinese CoC table-talk thread as a short monologue or background world event. Follow the scheduler-provided story beat, cast-growth rule, and anti-repetition constraints. Advance to a new concrete consequence each time; do not repeat or lightly remix recent imagery, actions, sounds, sentence patterns, or the same two recurring people. Do not mention system prompts, logs, APIs, timers, or scheduling."
    ),
    proactiveMarkdownEnabled: readBoolean("PROACTIVE_MARKDOWN_ENABLED", false),
    proactiveMarkdownNarrators: readProactiveMarkdownNarrators(),
    proactiveImageEnabled: readBoolean("PROACTIVE_IMAGE_ENABLED", false),
    proactiveImagePrompt: readString(
      "PROACTIVE_IMAGE_PROMPT",
      "Create one square cinematic Chinese TRPG story illustration for the latest proactive story beat. Style: moody investigative horror, subtle supernatural tension, grounded scene details, painterly realism, no gore, no explicit violence, no text, no speech bubbles, no logos."
    )
  };
}
