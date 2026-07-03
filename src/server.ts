import fs from "node:fs";
import path from "node:path";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import type { AppConfig } from "./config.js";
import { createAiImageClient, createAiReplyClient, type AiImageClient, type AiReplyClient, type AiReplyImage } from "./ai/client.js";
import { getContextRole, handleCommand, resolveEffectiveCommandContext, type PrivateMessageSender } from "./commands/handler.js";
import { buildAiContextInstructions, isMemorySkillText, rememberImportantPlayerStatement } from "./narrativeContext.js";
import { ProactiveChatScheduler } from "./proactive.js";
import { SlidingWindowRateLimiter } from "./rateLimit.js";
import type { BotStorage } from "./storage.js";
import { canUseAiCommands, formatMemberRole } from "./roles.js";
import { QQOpenApiClient, type SendMessageOptions } from "./qq/client.js";
import { signValidationResponse, verifyWebhookSignature } from "./qq/signature.js";
import type { MessageTarget, QQMessageAttachment, QQMessageEvent, QQPayload, QQValidationRequest } from "./qq/types.js";

type ServerQQClient = Pick<QQOpenApiClient, "sendTextMessage"> & Partial<Pick<QQOpenApiClient, "sendMarkdownMessage" | "sendImageMessage">>;

export interface ServerDeps {
  config: AppConfig;
  storage: BotStorage;
  qqClient?: ServerQQClient;
  aiClient?: AiReplyClient;
  imageClient?: AiImageClient;
  random?: () => number;
}

export function createApp(deps: ServerDeps): FastifyInstance {
  const app = Fastify({ logger: true, routerOptions: { ignoreTrailingSlash: true } });
  const qqClient = deps.qqClient ?? new QQOpenApiClient(deps.config);
  const aiClient = deps.aiClient ?? createAiReplyClient(deps.config, app.log);
  const imageClient = deps.imageClient ?? createAiImageClient(deps.config);
  const random = deps.random ?? Math.random;
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
    deps.storage.recordChatAudit({
      direction: "outgoing",
      scopeType: "c2c",
      scopeId: message.privateUserId,
      userId: "bot",
      eventType: `private_${message.sourceKind}`,
      content: message.content,
      metadata: { isWakeup: true }
    });
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
    const imageAttachments = getMessageImageAttachments(event.message);
    const isMentionedMessage = isGroupMentionMessage(payload.t, event.target, event.message.content);
    deps.storage.recordChatAudit({
      direction: "incoming",
      scopeType: event.context.scopeType,
      scopeId: event.context.scopeId,
      userId: event.context.userId,
      messageId: event.message.id,
      eventType: payload.t,
      content: incomingText,
      metadata: {
        rawContent: event.message.content === incomingText ? undefined : event.message.content,
        targetType: event.target.type,
        attachmentCount: getMessageAttachmentCount(event.message),
        imageAttachments: imageAttachments.length === 0 ? undefined : imageAttachments.map(formatAuditImageAttachment)
      }
    });
    if (event.target.type === "c2c") {
      deps.storage.recordPrivateActivity(event.target.userOpenid);
    }
    if (event.target.type === "group") {
      proactiveChat.recordGroupActivity(event.target.groupOpenid, incomingText);
    }

    const replyRequest = classifyReplyRequest(
      incomingText,
      payload.t,
      event.target,
      deps.config,
      isMentionedMessage,
      imageAttachments
    );
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
            instructions: buildAutoReplyInstructions(
              buildAiContextInstructions({
                userText: replyRequest.text,
                storage: deps.storage,
                context: effectiveContext,
                speakerRole
              }),
              replyRequest.trigger,
              replyRequest.text
            ),
            images: replyRequest.images
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
      await qqClient.sendTextMessage(event.target, responseText, event.message.id, 1, buildReplySendOptions(event));
      deps.storage.recordChatAudit({
        direction: "outgoing",
        scopeType: event.context.scopeType,
        scopeId: event.context.scopeId,
        userId: "bot",
        messageId: event.message.id,
        eventType: replyRequest.kind === "ai" ? "ai_reply" : "command_reply",
        content: responseText,
        metadata: {
          replyToMessageId: event.message.id,
          mentionUserIds: event.target.type === "group" ? [event.context.userId] : undefined,
          messageReference: { messageId: event.message.id },
          replyKind: replyRequest.kind,
          sourceEventType: payload.t
        }
      });
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
      startAiChatImageReaction({
        config: deps.config,
        target: event.target,
        context: event.context,
        replyRequest,
        responseText,
        sourceMessageId: event.message.id,
        sourceEventType: payload.t,
        qqClient,
        imageClient,
        storage: deps.storage,
        logger: request.log,
        random
      });
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

function buildReplySendOptions(event: {
  message: QQMessageEvent;
  target: MessageTarget;
  context: { userId: string };
}): SendMessageOptions {
  return {
    messageReference: {
      messageId: event.message.id,
      ignoreGetMessageError: true
    },
    mentionUserIds: event.target.type === "group" ? [event.context.userId] : undefined
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

function isGroupMentionMessage(payloadType: string | undefined, target: MessageTarget, rawContent: string): boolean {
  if (target.type !== "group") return false;
  return payloadType === "GROUP_AT_MESSAGE_CREATE" || hasLeadingMention(rawContent);
}

function hasLeadingMention(content: string): boolean {
  return /^\s*<@!?[^>]+>\s*/.test(content);
}

const MAX_AI_REPLY_IMAGE_ATTACHMENTS = 4;

function getMessageAttachmentCount(message: QQMessageEvent): number | undefined {
  const count = normalizeMessageAttachments(message.attachments).length;
  return count === 0 ? undefined : count;
}

function getMessageImageAttachments(message: QQMessageEvent): AiReplyImage[] {
  return normalizeMessageAttachments(message.attachments)
    .map(toAiReplyImage)
    .filter((image): image is AiReplyImage => image != null)
    .slice(0, MAX_AI_REPLY_IMAGE_ATTACHMENTS);
}

function normalizeMessageAttachments(attachments: QQMessageEvent["attachments"]): QQMessageAttachment[] {
  if (!Array.isArray(attachments)) return [];
  return attachments.filter(isAttachmentRecord);
}

function isAttachmentRecord(value: unknown): value is QQMessageAttachment {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function toAiReplyImage(attachment: QQMessageAttachment): AiReplyImage | undefined {
  const imageUrl = attachmentString(attachment, "url", "image_url", "imageUrl", "file_url", "fileUrl");
  if (!imageUrl || !isUsableImageUrl(imageUrl)) return undefined;

  const contentType = attachmentString(attachment, "content_type", "contentType", "mime_type", "mimeType");
  const filename = attachmentString(attachment, "filename", "file_name", "fileName", "name");
  if (!isImageAttachment(contentType, filename, imageUrl)) return undefined;

  return {
    imageUrl,
    detail: "auto",
    filename,
    contentType,
    width: attachmentNumber(attachment, "width"),
    height: attachmentNumber(attachment, "height"),
    size: attachmentNumber(attachment, "size")
  };
}

function attachmentString(attachment: QQMessageAttachment, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = attachment[key];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return undefined;
}

function attachmentNumber(attachment: QQMessageAttachment, key: string): number | undefined {
  const value = attachment[key];
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return undefined;
}

function isUsableImageUrl(url: string): boolean {
  return /^https?:\/\//i.test(url) || /^data:image\/(?:png|jpe?g|gif|webp);base64,/i.test(url);
}

function isImageAttachment(contentType: string | undefined, filename: string | undefined, imageUrl: string): boolean {
  if (contentType?.toLowerCase().startsWith("image/")) return true;
  return /\.(?:png|jpe?g|gif|webp)(?:[?#].*)?$/i.test(filename ?? imageUrl);
}

function formatAuditImageAttachment(image: AiReplyImage): Record<string, unknown> {
  return {
    contentType: image.contentType,
    filename: image.filename,
    width: image.width,
    height: image.height,
    size: image.size,
    imageUrl: limitPromptText(image.imageUrl, MAX_CHAT_IMAGE_AUDIT_CHARS)
  };
}

type ReplyRequest =
  | { kind: "command"; text: string }
  | { kind: "ai"; text: string; trigger: "mention" | "c2c" | "all"; images?: readonly AiReplyImage[] };

interface AiChatImageReactionArgs {
  config: AppConfig;
  target: MessageTarget;
  context: { scopeType: "group" | "c2c"; scopeId: string; userId: string };
  replyRequest: ReplyRequest;
  responseText: string;
  sourceMessageId: string;
  sourceEventType?: string;
  qqClient: ServerQQClient;
  imageClient?: AiImageClient;
  storage: BotStorage;
  logger: Pick<Console, "warn">;
  random: () => number;
}

const MAX_CHAT_IMAGE_CONTEXT_CHARS = 500;
const MAX_CHAT_IMAGE_AUDIT_CHARS = 240;
const AI_CHAT_IMAGE_ATMOSPHERE_THRESHOLD = 3;

interface AiChatImageDecision {
  shouldSend: boolean;
  score: number;
  reasons: string[];
  explicit: boolean;
  captionCandidates: string[];
}

function startAiChatImageReaction(args: AiChatImageReactionArgs): void {
  const decision = shouldSendAiChatImageReaction(args);
  if (!decision.shouldSend) return;
  const groupOpenid = args.target.type === "group" ? args.target.groupOpenid : undefined;
  if (!groupOpenid || !args.imageClient || !args.qqClient.sendImageMessage) return;
  const sendImageMessage = args.qqClient.sendImageMessage.bind(args.qqClient);

  const userText = chatImageUserText(args.replyRequest);
  const prompt = buildAiChatImagePrompt(args.config, userText, args.responseText, decision);
  void (async () => {
    const image = await args.imageClient!.createImage({
      prompt,
      userId: "ai-chat-reaction"
    });
    await sendImageMessage({ type: "group", groupOpenid }, { fileData: image.fileData });
    args.storage.recordChatAudit({
      direction: "outgoing",
      scopeType: args.context.scopeType,
      scopeId: args.context.scopeId,
      userId: "bot",
      messageId: args.sourceMessageId,
      eventType: "ai_image_reaction",
      content: "AI chat image reaction",
      metadata: {
        replyToMessageId: args.sourceMessageId,
        replyKind: args.replyRequest.kind,
        sourceEventType: args.sourceEventType,
        triggerReason: decision.reasons.join("；"),
        atmosphereScore: decision.score,
        explicitRequest: decision.explicit,
        captionCandidates: decision.captionCandidates,
        promptPreview: limitPromptText(prompt, MAX_CHAT_IMAGE_AUDIT_CHARS)
      }
    });
  })().catch((error) => {
    args.logger.warn({ err: error, groupOpenid }, "AI chat image reaction failed");
  });
}

function shouldSendAiChatImageReaction(args: AiChatImageReactionArgs): AiChatImageDecision {
  const blocked = imageDecision(false, 0, [], false, []);
  if (!args.config.aiChatImageEnabled) return blocked;
  if (args.target.type !== "group") return blocked;
  if (!args.imageClient || !args.qqClient.sendImageMessage) return blocked;
  if (!isAiChatReplyRequest(args.replyRequest)) return blocked;

  const userText = chatImageUserText(args.replyRequest);
  const explicit = isExplicitAiChatImageRequest(userText);
  const atmosphere = scoreAiChatImageAtmosphere(userText, args.responseText);
  if (atmosphere.blocked) return imageDecision(false, atmosphere.score, atmosphere.reasons, explicit, atmosphere.captionCandidates);
  if (explicit) {
    return imageDecision(true, Math.max(atmosphere.score, AI_CHAT_IMAGE_ATMOSPHERE_THRESHOLD), [
      "用户明确要图片或表情包",
      ...atmosphere.reasons
    ], true, atmosphere.captionCandidates);
  }
  if (hasRecentAiChatImageReaction(args.storage, args.context, args.config.aiChatImageMinGapMs)) {
    return imageDecision(false, atmosphere.score, ["最近已经发过表情包，跳过冷却期"], false, atmosphere.captionCandidates);
  }
  if (atmosphere.score < AI_CHAT_IMAGE_ATMOSPHERE_THRESHOLD) {
    return imageDecision(false, atmosphere.score, atmosphere.reasons, false, atmosphere.captionCandidates);
  }
  if (args.random() >= args.config.aiChatImageChance) {
    return imageDecision(false, atmosphere.score, ["氛围达标但未命中随机概率", ...atmosphere.reasons], false, atmosphere.captionCandidates);
  }
  return imageDecision(true, atmosphere.score, atmosphere.reasons, false, atmosphere.captionCandidates);
}

function isAiChatReplyRequest(replyRequest: ReplyRequest): boolean {
  return replyRequest.kind === "ai" || /^\.(?:ai|gpt|chat)(?:\s|$)/i.test(replyRequest.text.trim());
}

function chatImageUserText(replyRequest: ReplyRequest): string {
  const text = replyRequest.text.trim();
  if (replyRequest.kind === "ai") return text;
  return text.replace(/^\.(?:ai|gpt|chat)\s*/i, "").trim();
}

function isExplicitAiChatImageRequest(text: string): boolean {
  return /(?:照片|自拍|图|图片|画图|绘图|生图|表情包|头像|证件照|photo|image|pic|picture|draw|sticker|meme)/i.test(text)
    && /(?:发|给|来|搞|整|画|生成|看看|看一下|看一眼|show|send|make|draw|generate)/i.test(text);
}

function buildAiChatImagePrompt(config: AppConfig, userText: string, responseText: string, decision: AiChatImageDecision): string {
  return [
    config.aiChatImagePrompt,
    "",
    "Latest QQ group chat exchange:",
    `User message: ${limitPromptText(userText, MAX_CHAT_IMAGE_CONTEXT_CHARS)}`,
    `Bot reply: ${limitPromptText(responseText, MAX_CHAT_IMAGE_CONTEXT_CHARS)}`,
    "",
    `Atmosphere decision: ${decision.explicit ? "explicit image request" : "automatic atmosphere reaction"}; score ${decision.score}; reasons: ${decision.reasons.join("; ") || "none"}.`,
    `Caption candidates: ${decision.captionCandidates.join(" / ") || "在查了 / 已老实 / 这就返工 / 包能改的"}.`,
    "Make it feel like a small reaction meme or sticker the bot chose for this moment. Keep it expressive, safe for a private tabletop group, compact, and readable at QQ chat size.",
    "If adding text, use one short bold simplified Chinese caption that works as a reusable reaction or meme. Do not use process labels such as 先看样图、正在生成、请你矫正、给你预览.",
    "Avoid UI, chat bubbles, logos, watermarks, tiny text, spoilers, real person likenesses, copied meme templates, and mocking a specific player's real-life mistake."
  ].join("\n");
}

function imageDecision(
  shouldSend: boolean,
  score: number,
  reasons: string[],
  explicit: boolean,
  captionCandidates: string[]
): AiChatImageDecision {
  return { shouldSend, score, reasons, explicit, captionCandidates };
}

function scoreAiChatImageAtmosphere(userText: string, responseText: string): AiChatImageDecision & { blocked: boolean } {
  const combined = `${userText}\n${responseText}`;
  let score = 0;
  const reasons: string[] = [];
  const captionCandidates = new Set<string>();

  if (/(?:死亡|去世|自杀|抑郁|难受|吵架|争执|道歉|请假|现实压力|不舒服|隐私|住址|手机号|真名|收入|公司|学校|医院|生病)/i.test(combined)) {
    return { ...imageDecision(false, -3, ["命中真实情绪、隐私或严肃现实话题"], false, []), blocked: true };
  }
  if (/(?:kp-only|keeper-only|幕后真相|隐藏真相|暗线|秘密结局|怪物数据|私聊内容)/i.test(combined)) {
    return { ...imageDecision(false, -3, ["命中 KP-only 或未公开模组信息风险"], false, []), blocked: true };
  }

  if (/(?:哈哈|笑死|绷不住|蚌埠住|草|乐|233|hhh|破防|救命|名场面|经典语录)/i.test(combined)) {
    score += 2;
    reasons.push("出现群聊笑点或复读语气");
    captionCandidates.add("绷不住了");
  }
  if (/(?:大成功|大失败|骰|d100|侦查|聆听|灵感|san|理智|kp|检定|线索|角色卡|调查员|coc|跑团|模组|\bsc\b|\bra\b)/i.test(combined)) {
    score += 2;
    reasons.push("出现跑团桌边名场面或规则关键词");
    if (/(?:大失败|失败)/i.test(combined)) captionCandidates.add("大失败也是线索");
    if (/(?:san|理智)/i.test(combined)) captionCandidates.add("先别SAN");
    if (/(?:线索|侦查|聆听|灵感|调查)/i.test(combined)) captionCandidates.add("在查了");
  }
  if (/(?:已老实|包的|尊嘟|不妙|在查了|先别急|这很|小本本|稳住|问题不大|今天先活着|这就返工|包能改的)/i.test(combined)) {
    score += 2;
    reasons.push("出现可复用表情包语气");
    if (/(?:已老实)/i.test(combined)) captionCandidates.add("已老实");
    if (/(?:包的|问题不大)/i.test(combined)) captionCandidates.add("包的");
  }
  if (/(?:我(?:已经|先|来|在|马上)?.*(?:查|翻|记下|老实|缩|改|返工)|先别急|小本本|收到)/i.test(responseText)) {
    score += 1;
    reasons.push("bot 回复适合轻微自嘲或补包袱");
    captionCandidates.add("小本本记下");
  }
  if (/[“「][^”」]{2,14}[”」]/.test(userText)) {
    score += 1;
    reasons.push("用户消息里有短语录形态");
  }

  return { ...imageDecision(false, score, reasons, false, [...captionCandidates].slice(0, 4)), blocked: false };
}

function hasRecentAiChatImageReaction(
  storage: BotStorage,
  context: { scopeType: "group" | "c2c"; scopeId: string },
  minGapMs: number
): boolean {
  const latestReaction = storage.getRecentChatAuditEntries({
    scopeType: context.scopeType,
    scopeId: context.scopeId,
    direction: "outgoing",
    limit: 20
  }).find((entry) => entry.eventType === "ai_image_reaction");
  if (!latestReaction) return false;
  const timestamp = Date.parse(`${latestReaction.createdAt.replace(" ", "T")}Z`);
  return Number.isFinite(timestamp) && Date.now() - timestamp < minGapMs;
}

function limitPromptText(text: string, maxChars: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

const SELECTIVE_GROUP_REPLY_INSTRUCTIONS = [
  "全量群聊模式：你正在听完整个群，但不是每句话都要抢答。系统只会把疑问、直接求助、点名搭话或少量适合轻轻接话的氛围消息交给你。",
  "人格优先：先用“小豆包”的人格判断这句话是否适合开口，再回答。核心是像一个靠谱、暖、带一点活人感的群友，主要解决群里人的疑问。",
  "回复要短、自然、有用。普通疑问先给结论和下一步；轻松插话最多一两句，可以偶尔玩笑或自嘲，但不要刷屏、抢戏、复述群聊或破坏跑团氛围。"
].join("\n");

const IMAGE_REQUEST_REPLY_INSTRUCTIONS = [
  "用户这句话是在明确要图片、照片或表情包。系统可能会在你的文字回复后另发一张图片；你不要说自己完全不能发图、不能吐 PNG 或只能给提示词。",
  "如果用户要真人照片或你的真实自拍，简短说明没有真实自拍，但可以发一张虚构吉祥物/表情包风格图片。回复保持一两句。"
].join("\n");

function classifyReplyRequest(
  text: string,
  payloadType: string | undefined,
  target: MessageTarget,
  config: AppConfig,
  isMentionedMessage = false,
  imageAttachments: readonly AiReplyImage[] = []
): ReplyRequest | undefined {
  const hasImageAttachments = imageAttachments.length > 0;
  if (text === "" && !hasImageAttachments) return undefined;
  if (text.startsWith(".")) return { kind: "command", text };
  const shouldAutoReply = shouldAutoAiReply(text, payloadType, target, config, isMentionedMessage, hasImageAttachments);
  if (shouldAutoReply && isMemorySkillText(text)) {
    return { kind: "command", text: `.mem ${text}` };
  }
  if (!shouldAutoReply) return undefined;
  return {
    kind: "ai",
    text: text === "" ? buildImageOnlyAiText(imageAttachments) : text,
    trigger: target.type === "c2c" ? "c2c" : config.aiReplyMode === "all" ? "all" : "mention",
    images: hasImageAttachments ? imageAttachments : undefined
  };
}

function shouldRecordTableMessage(text: string, replyRequest: ReplyRequest | undefined): boolean {
  return text !== "" && !text.startsWith(".") && replyRequest == null;
}

function shouldAutoAiReply(
  text: string,
  payloadType: string | undefined,
  target: MessageTarget,
  config: AppConfig,
  isMentionedMessage = false,
  hasImageAttachments = false
): boolean {
  switch (config.aiReplyMode) {
    case "off":
    case "command":
      return false;
    case "mention":
      return (text !== "" || hasImageAttachments)
        && (target.type === "c2c" || payloadType === "GROUP_AT_MESSAGE_CREATE" || isMentionedMessage);
    case "all":
      if (target.type !== "group") return true;
      if (isMentionedMessage) return true;
      if (text === "" && hasImageAttachments) return false;
      return shouldReplyToAmbientGroupMessage(text);
  }
}

function buildImageOnlyAiText(imageAttachments: readonly AiReplyImage[]): string {
  const count = imageAttachments.length;
  return `User sent ${count} image attachment${count === 1 ? "" : "s"} with no text. Describe the image or answer the implied visual question in Chinese.`;
}

function shouldReplyToAmbientGroupMessage(text: string): boolean {
  const normalized = normalizeGroupText(text);
  if (normalized === "" || isLowSignalGroupMessage(normalized)) return false;
  if (isLikelyQuestionOrRequest(normalized)) return true;
  if (isDirectBotAddress(normalized)) return true;
  if (isPlayfulGroupMoment(normalized)) return deterministicPercent(normalized) < 12;
  return false;
}

function normalizeGroupText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function isLowSignalGroupMessage(text: string): boolean {
  if (text.length <= 1) return true;
  if (/^(?:哈+|哈哈+|草+|笑死|乐|啊+|嗯+|哦+|好+|行+|ok|OK|1|6+|？+|\?+|[.。…!！,，、~～\s]+)$/i.test(text)) return true;
  if (/^\[[^\]]+\]$/.test(text) || /^【[^】]+】$/.test(text)) return true;
  return text.length > 240 && !isLikelyQuestionOrRequest(text);
}

function isLikelyQuestionOrRequest(text: string): boolean {
  return /[?？]|\b(?:why|what|how|which|who|when|where|can|could|should)\b/i.test(text)
    || /(?:吗|嘛|呢|么|怎么|如何|为什么|为啥|啥|什么|哪个|哪边|哪里|谁|何时|怎么办|咋办|能不能|可以不|可不可以|有没有|是不是|要不要|该不该|帮我|帮忙|求助|解释|建议|推荐|该怎么|怎么查|怎么走|怎么判|什么意思)/.test(text);
}

function isDirectBotAddress(text: string): boolean {
  return /(?:小豆包|豆包|机器人|bot|Bot)[，,：:\s]*(?:帮|来|看|说|总结|解释|建议|评价|救|救命|你觉得|怎么办|咋办)/i.test(text);
}

function isPlayfulGroupMoment(text: string): boolean {
  return /(?:救命|离谱|绷不住|笑死|太强|好耶|绝了|牛|有点东西|怎么会这样|这合理吗|哈哈哈)/.test(text);
}

function deterministicPercent(text: string): number {
  let hash = 0x811c9dc5;
  for (const char of text) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % 100;
}

function buildAutoReplyInstructions(baseInstructions: string | undefined, trigger: "mention" | "c2c" | "all", userText = ""): string | undefined {
  const parts = [
    baseInstructions,
    trigger === "all" ? SELECTIVE_GROUP_REPLY_INSTRUCTIONS : undefined,
    isExplicitAiChatImageRequest(userText) ? IMAGE_REQUEST_REPLY_INSTRUCTIONS : undefined
  ].filter((part): part is string => part != null && part.trim() !== "");
  return parts.length === 0 ? undefined : parts.join("\n\n");
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
