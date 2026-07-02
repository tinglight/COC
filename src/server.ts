import fs from "node:fs";
import path from "node:path";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import type { AppConfig } from "./config.js";
import { createAiImageClient, createAiReplyClient, type AiImageClient, type AiReplyClient } from "./ai/client.js";
import { getContextRole, handleCommand, resolveEffectiveCommandContext, type PrivateMessageSender } from "./commands/handler.js";
import { buildAiContextInstructions, isMemorySkillText, rememberImportantPlayerStatement } from "./narrativeContext.js";
import { ProactiveChatScheduler } from "./proactive.js";
import { SlidingWindowRateLimiter } from "./rateLimit.js";
import type { BotStorage } from "./storage.js";
import { canUseAiCommands, formatMemberRole } from "./roles.js";
import { QQOpenApiClient } from "./qq/client.js";
import { signValidationResponse, verifyWebhookSignature } from "./qq/signature.js";
import type { MessageTarget, QQMessageEvent, QQPayload, QQValidationRequest } from "./qq/types.js";

export interface ServerDeps {
  config: AppConfig;
  storage: BotStorage;
  qqClient?: Pick<QQOpenApiClient, "sendTextMessage"> & Partial<Pick<QQOpenApiClient, "sendMarkdownMessage" | "sendImageMessage">>;
  aiClient?: AiReplyClient;
  imageClient?: AiImageClient;
}

export function createApp(deps: ServerDeps): FastifyInstance {
  const app = Fastify({ logger: true, routerOptions: { ignoreTrailingSlash: true } });
  const qqClient = deps.qqClient ?? new QQOpenApiClient(deps.config);
  const aiClient = deps.aiClient ?? createAiReplyClient(deps.config, app.log);
  const imageClient = deps.imageClient ?? createAiImageClient(deps.config);
  const privateDeliveryLimiter = new SlidingWindowRateLimiter(4, 60_000);
  const privateMessenger: PrivateMessageSender = async (message) => {
    const limit = privateDeliveryLimiter.check(message.privateUserId);
    if (!limit.allowed) {
      throw new Error(`本机私聊发送过快，请约 ${Math.ceil(limit.retryAfterMs / 1000)} 秒后再试`);
    }
    await qqClient.sendTextMessage(
      { type: "c2c", userOpenid: message.privateUserId },
      message.content,
      undefined,
      1,
      { isWakeup: true }
    );
  };
  const proactiveChat = new ProactiveChatScheduler({
    config: deps.config,
    qqClient,
    aiClient,
    imageClient,
    storage: deps.storage,
    logger: app.log
  });
  const userLimiter = new SlidingWindowRateLimiter(deps.config.userRateLimitMax, deps.config.userRateLimitWindowMs);
  const groupLimiter = new SlidingWindowRateLimiter(deps.config.groupRateLimitMax, deps.config.groupRateLimitWindowMs);

  app.addHook("onReady", async () => {
    proactiveChat.start();
  });

  app.addHook("onClose", async () => {
    proactiveChat.stop();
  });

  app.addContentTypeParser("application/json", { parseAs: "string" }, (request, body, done) => {
    try {
      const rawBody = typeof body === "string" ? body : body.toString("utf8");
      request.rawBody = rawBody;
      done(null, JSON.parse(rawBody));
    } catch (error) {
      done(error as Error);
    }
  });

  app.addHook("preHandler", async (request) => {
    request.rawBody = request.rawBody ?? (request.body == null ? "" : JSON.stringify(request.body));
  });

  app.get("/health", async () => ({ ok: true }));

  app.get<{ Params: { "*": string } }>("/assets/*", async (request, reply) => {
    const filePath = resolveAssetPath(deps.config.assetDir, request.params["*"]);
    if (!filePath) return reply.code(404).send({ error: "not found" });

    try {
      const stat = await fs.promises.stat(filePath);
      if (!stat.isFile()) return reply.code(404).send({ error: "not found" });
      return reply
        .type(contentTypeForPath(filePath))
        .header("content-length", stat.size)
        .header("cache-control", "public, max-age=300")
        .send(fs.createReadStream(filePath));
    } catch {
      return reply.code(404).send({ error: "not found" });
    }
  });

  app.post("/qq/webhook", async (request, reply) => {
    const payload = request.body as QQPayload;
    const rawBody = request.rawBody;

    if (payload.op === 13) {
      const validationResponse = handleValidation(payload, deps.config, request, rawBody);
      return reply
        .code(200)
        .header("content-type", "application/json")
        .send(JSON.stringify(validationResponse));
    }

    if (!isValidCallbackRequest(request, rawBody, deps.config)) {
      request.log.warn({ headers: request.headers }, "Rejected QQ webhook with invalid signature");
      return reply.code(401).send({ error: "invalid signature" });
    }

    if (payload.op !== 0) return ack();

    const settingEvent = normalizePrivateMessageSettingEvent(payload);
    if (settingEvent) {
      deps.storage.setPrivateActiveMessagesAllowed(settingEvent.userOpenid, settingEvent.allowed);
      request.log.info(settingEvent, "QQ private message setting event");
      return ack();
    }

    const event = normalizeMessageEvent(payload);
    if (!event) return ack();
    if (event.message.author?.bot) return ack();
    if (!isAllowedGroup(event.target, deps.config)) {
      request.log.info({ target: event.target }, "Ignored message from non-allowed group");
      return ack();
    }
    request.log.info({ type: payload.t, target: event.target, context: event.context }, "QQ message event");
    const processedKey = `${payload.t ?? "UNKNOWN"}:${event.message.id}`;
    if (!deps.storage.markMessageProcessed(processedKey)) {
      request.log.info({ processedKey }, "Ignored duplicate QQ message event");
      return ack();
    }

    const incomingText = cleanIncomingContent(event.message.content);
    if (event.target.type === "c2c") {
      deps.storage.recordPrivateActivity(event.target.userOpenid);
    }
    if (event.target.type === "group") {
      proactiveChat.recordGroupActivity(event.target.groupOpenid, incomingText);
    }

    const replyRequest = classifyReplyRequest(incomingText, payload.t, event.target, deps.config);
    if (event.target.type === "group" && shouldRecordTableMessage(incomingText, replyRequest)) {
      deps.storage.addTableMessage(event.target.groupOpenid, event.context.userId, incomingText);
      rememberImportantPlayerStatement(deps.storage, event.context, incomingText, "table_message");
    }
    if (!replyRequest) {
      return ack();
    }
    if (replyRequest.kind === "ai" && !aiClient) {
      return ack();
    }

    const userKey = `${event.context.scopeType}:${event.context.scopeId}:${event.context.userId}`;
    const userLimit = userLimiter.check(userKey);
    let responseText: string | null;
    if (!userLimit.allowed) {
      responseText = `指令太快了，请 ${Math.ceil(userLimit.retryAfterMs / 1000)} 秒后再试。`;
    } else if (replyRequest.kind === "ai") {
      const effectiveContext = resolveEffectiveCommandContext(event.context, deps.storage);
      const speakerRole = getContextRole(effectiveContext, deps.storage);
      if (!canUseAiCommands(speakerRole)) {
        responseText = `当前身份是 ${formatMemberRole(speakerRole)}，不能调用 AI 指令。请联系 KP 调整身份。`;
      } else {
        try {
          responseText = await aiClient!.createReply({
            text: replyRequest.text,
            scopeType: effectiveContext.scopeType,
            scopeId: effectiveContext.scopeId,
            userId: effectiveContext.userId,
            speakerRole,
            trigger: replyRequest.trigger,
            instructions: buildAiContextInstructions({
              userText: replyRequest.text,
              storage: deps.storage,
              context: effectiveContext,
              speakerRole
            })
          });
        } catch (error) {
          request.log.error({ err: error }, "AI reply failed");
          responseText = "AI 回复失败，请稍后再试。";
        }
      }
    } else {
      responseText = await handleCommand(replyRequest.text, event.context, {
        storage: deps.storage,
        aiClient,
        privateMessenger
      });
    }

    if (!responseText) {
      return ack();
    }
    if (event.target.type === "group") {
      const groupLimit = groupLimiter.check(event.target.groupOpenid);
      if (!groupLimit.allowed) {
        request.log.warn({ retryAfterMs: groupLimit.retryAfterMs }, "Skipped reply due to group rate limit");
        return ack();
      }
    }

    try {
      await qqClient.sendTextMessage(event.target, responseText, event.message.id, 1);
      if (replyRequest.kind === "ai") {
        const effectiveContext = resolveEffectiveCommandContext(event.context, deps.storage);
        const speakerRole = getContextRole(effectiveContext, deps.storage);
        deps.storage.addNarrativeEvent({
          kind: "ai_reply",
          scopeType: effectiveContext.scopeType,
          scopeId: effectiveContext.scopeId,
          userId: effectiveContext.userId,
          inputText: replyRequest.text,
          outputText: responseText,
          metadata: {
            trigger: replyRequest.trigger,
            speakerRole,
            sourceScopeType: event.context.scopeType,
            boundFromC2c: effectiveContext.boundFromC2c || undefined
          }
        });
        rememberImportantPlayerStatement(deps.storage, effectiveContext, replyRequest.text, `ai_${replyRequest.trigger}`);
      }
    } catch (error) {
      request.log.error({ err: error, target: event.target, processedKey }, "Failed to send QQ reply");
      throw error;
    }
    return ack();
  });

  return app;
}

declare module "fastify" {
  interface FastifyRequest {
    rawBody: string;
  }
}

function handleValidation(payload: QQPayload, config: AppConfig, request: FastifyRequest, rawBody: string): { plain_token: string; signature: string } {
  const validation = payload.d as QQValidationRequest;
  const headerAppId = headerValue(request, "x-bot-appid");
  const requestSignature = headerValue(request, "x-signature-ed25519");
  const requestTimestamp = headerValue(request, "x-signature-timestamp");
  const appSecretVerifiesRequest = verifiesSafely(config.appSecret, requestTimestamp, rawBody, requestSignature);
  const botSecretVerifiesRequest = verifiesSafely(config.botSecret, requestTimestamp, rawBody, requestSignature);
  const validationSecretSource = selectValidationSecretSource(config, appSecretVerifiesRequest);
  const validationSecret = validationSecretSource === "botSecret" ? config.botSecret : config.appSecret;
  request.log.info({
    headerAppIdMatchesConfig: headerAppId == null || config.appId === "" || headerAppId === config.appId,
    headerAppIdSuffix: suffix(headerAppId),
    configuredAppIdSuffix: suffix(config.appId),
    eventTs: validation.event_ts,
    plainTokenLength: validation.plain_token?.length,
    appSecretVerifiesRequest,
    botSecretVerifiesRequest,
    configuredValidationSecretSource: config.validationSecretSource,
    validationSecretSource
  }, "QQ webhook validation request");
  const signature = signValidationResponse(validationSecret, validation.event_ts, validation.plain_token);
  request.log.info({
    signatureLength: signature.length,
    signaturePrefix: signature.slice(0, 8),
    signatureSuffix: signature.slice(-8)
  }, "QQ webhook validation response");
  return {
    plain_token: validation.plain_token,
    signature
  };
}

function selectValidationSecretSource(config: AppConfig, appSecretVerifiesRequest: boolean): "appSecret" | "botSecret" {
  if (config.validationSecretSource === "appSecret") return "appSecret";
  if (config.validationSecretSource === "botSecret") return "botSecret";
  return appSecretVerifiesRequest ? "appSecret" : "botSecret";
}

function suffix(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value.slice(-4);
}

function verifiesSafely(secret: string, timestamp: string | undefined, rawBody: string, signature: string | undefined): boolean {
  if (!secret || !timestamp || !signature) return false;
  try {
    return verifyWebhookSignature(secret, timestamp, rawBody, signature);
  } catch {
    return false;
  }
}

function isValidCallbackRequest(request: FastifyRequest, rawBody: string, config: AppConfig): boolean {
  const appidHeader = headerValue(request, "x-bot-appid");
  if (appidHeader && config.appId && appidHeader !== config.appId) return false;
  if (!config.verifySignatures) return true;
  const signature = headerValue(request, "x-signature-ed25519");
  const timestamp = headerValue(request, "x-signature-timestamp");
  if (!signature || !timestamp) return false;
  return verifiesSafely(config.appSecret, timestamp, rawBody, signature)
    || verifiesSafely(config.botSecret, timestamp, rawBody, signature);
}

function headerValue(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function normalizeMessageEvent(payload: QQPayload): {
  message: QQMessageEvent;
  target: MessageTarget;
  context: { scopeType: "group" | "c2c"; scopeId: string; userId: string };
} | undefined {
  const message = payload.d as QQMessageEvent | undefined;
  if (!message?.id || message.content == null) return undefined;

  if ((payload.t === "GROUP_AT_MESSAGE_CREATE" || payload.t === "GROUP_MESSAGE_CREATE") && message.group_openid) {
    const userId = message.author?.member_openid;
    if (!userId) return undefined;
    return {
      message,
      target: { type: "group", groupOpenid: message.group_openid },
      context: { scopeType: "group", scopeId: message.group_openid, userId }
    };
  }

  if (payload.t === "C2C_MESSAGE_CREATE" && message.author?.user_openid) {
    return {
      message,
      target: { type: "c2c", userOpenid: message.author.user_openid },
      context: { scopeType: "c2c", scopeId: message.author.user_openid, userId: message.author.user_openid }
    };
  }

  return undefined;
}

function normalizePrivateMessageSettingEvent(payload: QQPayload): { userOpenid: string; allowed: boolean } | undefined {
  if (payload.t !== "C2C_MSG_REJECT" && payload.t !== "C2C_MSG_RECEIVE" && payload.t !== "FRIEND_DEL") {
    return undefined;
  }
  const userOpenid = extractUserOpenid(payload.d);
  if (!userOpenid) return undefined;
  return {
    userOpenid,
    allowed: payload.t === "C2C_MSG_RECEIVE"
  };
}

function extractUserOpenid(value: unknown): string | undefined {
  if (value == null || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const direct = record.user_openid ?? record.openid ?? record.open_id;
  if (typeof direct === "string" && direct.trim() !== "") return direct.trim();
  const author = record.author;
  if (author != null && typeof author === "object") {
    const authorOpenid = (author as Record<string, unknown>).user_openid;
    if (typeof authorOpenid === "string" && authorOpenid.trim() !== "") return authorOpenid.trim();
  }
  return undefined;
}

function cleanIncomingContent(content: string): string {
  return content.replace(/^\s*<@![^>]+>\s*/, "").replace(/^\s*<@[^>]+>\s*/, "").trim();
}

type ReplyRequest =
  | { kind: "command"; text: string }
  | { kind: "ai"; text: string; trigger: "mention" | "c2c" | "all" };

function classifyReplyRequest(
  text: string,
  payloadType: string | undefined,
  target: MessageTarget,
  config: AppConfig
): ReplyRequest | undefined {
  if (text === "") return undefined;
  if (text.startsWith(".")) return { kind: "command", text };
  if (shouldAutoAiReply(payloadType, target, config) && isMemorySkillText(text)) {
    return { kind: "command", text: `.mem ${text}` };
  }
  if (!shouldAutoAiReply(payloadType, target, config)) return undefined;
  return {
    kind: "ai",
    text,
    trigger: target.type === "c2c" ? "c2c" : config.aiReplyMode === "all" ? "all" : "mention"
  };
}

function shouldRecordTableMessage(text: string, replyRequest: ReplyRequest | undefined): boolean {
  return text !== "" && !text.startsWith(".") && replyRequest == null;
}

function shouldAutoAiReply(payloadType: string | undefined, target: MessageTarget, config: AppConfig): boolean {
  switch (config.aiReplyMode) {
    case "off":
    case "command":
      return false;
    case "mention":
      return target.type === "c2c" || payloadType === "GROUP_AT_MESSAGE_CREATE";
    case "all":
      return true;
  }
}

function isAllowedGroup(target: MessageTarget, config: AppConfig): boolean {
  if (target.type !== "group") return true;
  if (config.allowedGroupOpenids.size === 0) return true;
  return config.allowedGroupOpenids.has(target.groupOpenid);
}

function ack(): { op: 12 } {
  return { op: 12 };
}

function resolveAssetPath(assetDir: string, requestedPath: string): string | undefined {
  const relativePath = requestedPath.replace(/\\/g, "/");
  if (relativePath.includes("\0")) return undefined;
  const filePath = path.resolve(assetDir, relativePath);
  const relativeToAssetDir = path.relative(assetDir, filePath);
  if (relativeToAssetDir.startsWith("..") || path.isAbsolute(relativeToAssetDir)) return undefined;
  return filePath;
}

function contentTypeForPath(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".png":
    default:
      return "image/png";
  }
}
