import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import { buildNpcReplyPrompt } from "./npcSkill.js";
import {
  exportSillyTavernCharacter,
  type SillyTavernExportVisibility
} from "./rpStudio.js";
import { BotStorage, type MemoryAnchorInput, type PersonaCardInput, type TrainingExampleInput } from "./storage.js";

dotenv.config({ quiet: true });

type LogStream = "system" | "stdout" | "stderr";
type BotExit = { code: number | null; signal: NodeJS.Signals | null; at: string };

interface LogEntry {
  id: number;
  at: string;
  stream: LogStream;
  text: string;
}

export interface AdminConsoleOptions {
  cwd?: string;
  adminPort?: number;
  botPort?: number;
  databasePath?: string;
  logPath?: string;
  botCommand?: string;
  botArgs?: string[];
  tunnelLogPath?: string;
  tunnelCommand?: string;
  tunnelArgs?: string[];
  autoRestart?: boolean;
}

interface ResolvedAdminOptions {
  cwd: string;
  adminPort: number;
  botPort: number;
  databasePath: string;
  logPath: string;
  botCommand: string;
  botArgs: string[];
  tunnelLogPath: string;
  tunnelCommand: string;
  tunnelArgs: string[];
  autoRestart: boolean;
}

interface QueryRowsResult {
  columns: string[];
  rows: Record<string, unknown>[];
  truncated: boolean;
}

const DEFAULT_ADMIN_PORT = 8787;
const DEFAULT_BOT_PORT = 3000;
const DEFAULT_DATABASE_PATH = "./data/bot.sqlite";
const MAX_LOG_ENTRIES = 1200;
const MAX_QUERY_ROWS = 500;

export class BotProcessController {
  private child?: ChildProcess;
  private startedAt?: string;
  private lastExit?: BotExit;
  private restartTimer?: NodeJS.Timeout;
  private intentionalStop = false;
  private nextLogId = 1;
  private readonly logs: LogEntry[] = [];
  private readonly partial: Record<"stdout" | "stderr", string> = { stdout: "", stderr: "" };

  autoRestart: boolean;

  constructor(private readonly options: ResolvedAdminOptions) {
    this.autoRestart = options.autoRestart;
    this.loadLogTail();
  }

  get running(): boolean {
    return this.child != null && this.child.exitCode == null && !this.child.killed;
  }

  get pid(): number | undefined {
    return this.running ? this.child?.pid : undefined;
  }

  getStatus(): Record<string, unknown> {
    return {
      managedRunning: this.running,
      pid: this.pid,
      startedAt: this.startedAt,
      uptimeMs: this.startedAt ? Date.now() - Date.parse(this.startedAt) : 0,
      autoRestart: this.autoRestart,
      lastExit: this.lastExit,
      command: [this.options.botCommand, ...this.options.botArgs].join(" "),
      logPath: this.options.logPath
    };
  }

  getLogs(after = 0): { cursor: number; lines: LogEntry[] } {
    const lines = this.logs.filter((entry) => entry.id > after);
    return {
      cursor: this.logs.at(-1)?.id ?? after,
      lines
    };
  }

  setAutoRestart(enabled: boolean): void {
    this.autoRestart = enabled;
    this.appendLog("system", `autoRestart=${enabled ? "on" : "off"}`);
  }

  async start(): Promise<void> {
    if (this.running) return;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = undefined;
    }

    this.intentionalStop = false;
    fs.mkdirSync(path.dirname(this.options.logPath), { recursive: true });
    this.appendLog("system", `Starting bot with ${this.options.botCommand} ${this.options.botArgs.join(" ")}`);

    const child = spawn(this.options.botCommand, this.options.botArgs, {
      cwd: this.options.cwd,
      env: childProcessEnv(),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    this.child = child;
    this.startedAt = new Date().toISOString();
    this.lastExit = undefined;

    child.stdout?.on("data", (chunk: Buffer) => this.captureChunk("stdout", chunk));
    child.stderr?.on("data", (chunk: Buffer) => this.captureChunk("stderr", chunk));
    child.on("error", (error) => {
      this.appendLog("system", `Bot process error: ${error.message}`);
    });
    child.on("exit", (code, signal) => {
      this.flushPartial("stdout");
      this.flushPartial("stderr");
      this.lastExit = { code, signal, at: new Date().toISOString() };
      this.appendLog("system", `Bot exited with code=${code ?? "null"} signal=${signal ?? "null"}`);
      this.child = undefined;
      this.startedAt = undefined;
      if (this.autoRestart && !this.intentionalStop) {
        this.appendLog("system", "Auto-restart is enabled; restarting in 2s");
        this.restartTimer = setTimeout(() => void this.start(), 2_000);
      }
    });
  }

  async stop(): Promise<void> {
    if (!this.running || !this.child) return;
    this.intentionalStop = true;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = undefined;
    }

    const child = this.child;
    this.appendLog("system", `Stopping bot pid=${child.pid ?? "unknown"}`);
    if (process.platform === "win32") {
      await forceKill(child);
      await waitForExit(child, 2_000);
      return;
    }

    try {
      child.kill("SIGINT");
    } catch (error) {
      this.appendLog("system", `SIGINT failed: ${errorMessage(error)}`);
    }

    const exited = await waitForExit(child, 5_000);
    if (!exited) {
      this.appendLog("system", `Force stopping bot pid=${child.pid ?? "unknown"}`);
      await forceKill(child);
      await waitForExit(child, 2_000);
    }
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  private captureChunk(stream: "stdout" | "stderr", chunk: Buffer): void {
    const text = this.partial[stream] + chunk.toString("utf8");
    const lines = text.split(/\r?\n/);
    this.partial[stream] = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim() !== "") this.appendLog(stream, line);
    }
  }

  private flushPartial(stream: "stdout" | "stderr"): void {
    const text = this.partial[stream].trim();
    if (text !== "") this.appendLog(stream, text);
    this.partial[stream] = "";
  }

  private appendLog(stream: LogStream, text: string): void {
    const entry = {
      id: this.nextLogId++,
      at: new Date().toISOString(),
      stream,
      text
    };
    this.logs.push(entry);
    while (this.logs.length > MAX_LOG_ENTRIES) this.logs.shift();

    const line = `[${entry.at}] [${stream}] ${text}\n`;
    fs.appendFile(this.options.logPath, line, () => undefined);
  }

  private loadLogTail(): void {
    try {
      if (!fs.existsSync(this.options.logPath)) return;
      const content = fs.readFileSync(this.options.logPath, "utf8");
      const lines = content.split(/\r?\n/).filter(Boolean).slice(-200);
      for (const line of lines) {
        this.logs.push({
          id: this.nextLogId++,
          at: new Date().toISOString(),
          stream: "system",
          text: line
        });
      }
    } catch {
      // The console can still run if old log history cannot be read.
    }
  }
}

export class TunnelProcessController {
  private child?: ChildProcess;
  private startedAt?: string;
  private lastExit?: BotExit;
  private publicUrl?: string;
  private nextLogId = 1;
  private readonly logs: LogEntry[] = [];
  private readonly partial: Record<"stdout" | "stderr", string> = { stdout: "", stderr: "" };

  constructor(private readonly options: ResolvedAdminOptions) {
    this.loadLogTail();
  }

  get running(): boolean {
    return this.child != null && this.child.exitCode == null && !this.child.killed;
  }

  get pid(): number | undefined {
    return this.running ? this.child?.pid : undefined;
  }

  getStatus(): Record<string, unknown> {
    return {
      managedRunning: this.running,
      pid: this.pid,
      startedAt: this.startedAt,
      uptimeMs: this.startedAt ? Date.now() - Date.parse(this.startedAt) : 0,
      publicUrl: this.publicUrl,
      webhookUrl: this.webhookUrl,
      localUrl: `http://127.0.0.1:${this.options.botPort}`,
      lastExit: this.lastExit,
      command: [this.options.tunnelCommand, ...this.options.tunnelArgs].join(" "),
      logPath: this.options.tunnelLogPath
    };
  }

  get webhookUrl(): string | undefined {
    return this.publicUrl == null ? undefined : `${this.publicUrl}/qq/webhook`;
  }

  getLogs(after = 0): { cursor: number; lines: LogEntry[] } {
    const lines = this.logs.filter((entry) => entry.id > after);
    return {
      cursor: this.logs.at(-1)?.id ?? after,
      lines
    };
  }

  async start(): Promise<void> {
    if (this.running) return;

    this.publicUrl = undefined;
    fs.mkdirSync(path.dirname(this.options.tunnelLogPath), { recursive: true });
    this.appendLog("system", `Starting temporary tunnel with ${this.options.tunnelCommand} ${this.options.tunnelArgs.join(" ")}`);

    const child = spawn(this.options.tunnelCommand, this.options.tunnelArgs, {
      cwd: this.options.cwd,
      env: childProcessEnv(),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    this.child = child;
    this.startedAt = new Date().toISOString();
    this.lastExit = undefined;

    child.stdout?.on("data", (chunk: Buffer) => this.captureChunk("stdout", chunk));
    child.stderr?.on("data", (chunk: Buffer) => this.captureChunk("stderr", chunk));
    child.on("error", (error) => {
      this.appendLog("system", `Tunnel process error: ${error.message}`);
    });
    child.on("exit", (code, signal) => {
      this.flushPartial("stdout");
      this.flushPartial("stderr");
      this.lastExit = { code, signal, at: new Date().toISOString() };
      this.appendLog("system", `Tunnel exited with code=${code ?? "null"} signal=${signal ?? "null"}`);
      this.child = undefined;
      this.startedAt = undefined;
    });
  }

  async stop(): Promise<void> {
    if (!this.running || !this.child) return;

    const child = this.child;
    this.appendLog("system", `Stopping temporary tunnel pid=${child.pid ?? "unknown"}`);
    if (process.platform === "win32") {
      await forceKill(child);
      await waitForExit(child, 2_000);
      return;
    }

    try {
      child.kill("SIGINT");
    } catch (error) {
      this.appendLog("system", `SIGINT failed: ${errorMessage(error)}`);
    }

    const exited = await waitForExit(child, 5_000);
    if (!exited) {
      this.appendLog("system", `Force stopping temporary tunnel pid=${child.pid ?? "unknown"}`);
      await forceKill(child);
      await waitForExit(child, 2_000);
    }
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  private captureChunk(stream: "stdout" | "stderr", chunk: Buffer): void {
    const text = this.partial[stream] + chunk.toString("utf8");
    const lines = text.split(/\r?\n/);
    this.partial[stream] = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim() !== "") this.appendLog(stream, line);
    }
  }

  private flushPartial(stream: "stdout" | "stderr"): void {
    const text = this.partial[stream].trim();
    if (text !== "") this.appendLog(stream, text);
    this.partial[stream] = "";
  }

  private appendLog(stream: LogStream, text: string): void {
    const url = extractTryCloudflareUrl(text);
    if (url && url !== this.publicUrl) {
      this.publicUrl = url;
      this.appendLog("system", `QQ webhook callback URL: ${this.webhookUrl}`);
    }

    const entry = {
      id: this.nextLogId++,
      at: new Date().toISOString(),
      stream,
      text
    };
    this.logs.push(entry);
    while (this.logs.length > MAX_LOG_ENTRIES) this.logs.shift();

    const line = `[${entry.at}] [${stream}] ${text}\n`;
    fs.appendFile(this.options.tunnelLogPath, line, () => undefined);
  }

  private loadLogTail(): void {
    try {
      if (!fs.existsSync(this.options.tunnelLogPath)) return;
      const content = fs.readFileSync(this.options.tunnelLogPath, "utf8");
      const lines = content.split(/\r?\n/).filter(Boolean).slice(-200);
      for (const line of lines) {
        const url = extractTryCloudflareUrl(line);
        if (url) this.publicUrl = url;
        this.logs.push({
          id: this.nextLogId++,
          at: new Date().toISOString(),
          stream: "system",
          text: line
        });
      }
    } catch {
      // The console can still run if old tunnel log history cannot be read.
    }
  }
}

export function extractTryCloudflareUrl(text: string): string | undefined {
  return text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i)?.[0];
}

export function createAdminConsole(options: AdminConsoleOptions = {}): {
  app: FastifyInstance;
  controller: BotProcessController;
  tunnelController: TunnelProcessController;
  options: ResolvedAdminOptions;
} {
  const resolved = resolveAdminOptions(options);
  const controller = new BotProcessController(resolved);
  const tunnelController = new TunnelProcessController(resolved);
  const app = Fastify({ logger: false });

  app.get("/", async (_request, reply) => {
    return reply.type("text/html; charset=utf-8").send(renderConsoleHtml());
  });

  app.get("/api/status", async () => {
    const health = await checkBotHealth(resolved.botPort);
    return {
      admin: {
        port: resolved.adminPort,
        cwd: resolved.cwd,
        databasePath: resolved.databasePath,
        botHealthUrl: `http://127.0.0.1:${resolved.botPort}/health`
      },
      bot: controller.getStatus(),
      tunnel: tunnelController.getStatus(),
      health
    };
  });

  app.post("/api/bot/start", async () => {
    await controller.start();
    return { ok: true, bot: controller.getStatus() };
  });

  app.post("/api/bot/stop", async () => {
    await controller.stop();
    return { ok: true, bot: controller.getStatus() };
  });

  app.post("/api/bot/restart", async () => {
    await controller.restart();
    return { ok: true, bot: controller.getStatus() };
  });

  app.post("/api/bot/auto-restart", async (request) => {
    const body = request.body as { enabled?: unknown } | undefined;
    controller.setAutoRestart(Boolean(body?.enabled));
    return { ok: true, bot: controller.getStatus() };
  });

  app.post("/api/tunnel/start", async () => {
    await controller.start();
    await tunnelController.start();
    return { ok: true, bot: controller.getStatus(), tunnel: tunnelController.getStatus() };
  });

  app.post("/api/tunnel/stop", async () => {
    await tunnelController.stop();
    return { ok: true, tunnel: tunnelController.getStatus() };
  });

  app.post("/api/tunnel/restart", async () => {
    await controller.start();
    await tunnelController.restart();
    return { ok: true, bot: controller.getStatus(), tunnel: tunnelController.getStatus() };
  });

  app.get("/api/logs", async (request) => {
    const query = request.query as { after?: string };
    return controller.getLogs(readInteger(query.after, 0, 0, Number.MAX_SAFE_INTEGER));
  });

  app.get("/api/tunnel/logs", async (request) => {
    const query = request.query as { after?: string };
    return tunnelController.getLogs(readInteger(query.after, 0, 0, Number.MAX_SAFE_INTEGER));
  });

  app.get("/api/database/summary", async (_request, reply) => withDatabase(reply, resolved.databasePath, (db) => {
    const tables = listTables(db).map((table) => ({
      name: table,
      rowCount: safeTableCount(db, table)
    }));
    return {
      databasePath: resolved.databasePath,
      exists: true,
      tables
    };
  }));

  app.get("/api/database/table/:tableName", async (request, reply) => withDatabase(reply, resolved.databasePath, (db) => {
    const params = request.params as { tableName: string };
    const query = request.query as { limit?: string; offset?: string };
    const tableName = params.tableName;
    assertKnownTable(db, tableName);
    const limit = readInteger(query.limit, 100, 1, MAX_QUERY_ROWS);
    const offset = readInteger(query.offset, 0, 0, Number.MAX_SAFE_INTEGER);
    return {
      tableName,
      ...readTableRows(db, tableName, limit, offset)
    };
  }));

  app.post("/api/database/query", async (request, reply) => withDatabase(reply, resolved.databasePath, (db) => {
    const body = request.body as { sql?: unknown; maxRows?: unknown } | undefined;
    const sql = typeof body?.sql === "string" ? body.sql.trim() : "";
    if (sql === "") throw httpError(400, "SQL is required.");
    if (!isReadOnlySql(sql)) throw httpError(400, "Only SELECT, WITH, and PRAGMA reads are allowed.");
    const maxRows = readInteger(body?.maxRows, 100, 1, MAX_QUERY_ROWS);
    return runReadOnlyQuery(db, sql, maxRows);
  }));

  app.get("/api/chat/messages", async (request, reply) => withDatabase(reply, resolved.databasePath, (db) => {
    const query = request.query as Record<string, string | undefined>;
    if (!tableExists(db, "chat_audit_log")) return { columns: [], rows: [], truncated: false };
    return readFilteredRows(db, "chat_audit_log", {
      limit: readInteger(query.limit, 120, 1, MAX_QUERY_ROWS),
      offset: readInteger(query.offset, 0, 0, Number.MAX_SAFE_INTEGER),
      filters: [
        enumFilter("scope_type", query.scopeType, ["group", "c2c"]),
        enumFilter("direction", query.direction, ["incoming", "outgoing"]),
        exactFilter("scope_id", query.scopeId),
        likeFilter(["content", "scope_id", "user_id", "event_type"], query.q)
      ].filter(Boolean) as SqlFilter[],
      orderBy: "id DESC"
    });
  }));

  app.get("/api/chat/narrative", async (request, reply) => withDatabase(reply, resolved.databasePath, (db) => {
    const query = request.query as Record<string, string | undefined>;
    if (!tableExists(db, "narrative_events")) return { columns: [], rows: [], truncated: false };
    return readFilteredRows(db, "narrative_events", {
      limit: readInteger(query.limit, 120, 1, MAX_QUERY_ROWS),
      offset: readInteger(query.offset, 0, 0, Number.MAX_SAFE_INTEGER),
      filters: [
        enumFilter("scope_type", query.scopeType, ["group", "c2c"]),
        exactFilter("scope_id", query.scopeId),
        exactFilter("kind", query.kind),
        likeFilter(["input_text", "output_text", "actor_name", "user_id", "scope_id"], query.q)
      ].filter(Boolean) as SqlFilter[],
      orderBy: "id DESC"
    });
  }));

  app.get("/api/rp/personas", async (_request, reply) => withStorage(reply, resolved.databasePath, (storage) => ({
    personas: storage.listPersonaCards()
  })));

  app.post("/api/rp/personas", async (request, reply) => withStorage(reply, resolved.databasePath, (storage) => ({
    persona: storage.savePersonaCard(readPersonaCardInput(request.body))
  })));

  app.put("/api/rp/personas/:id", async (request, reply) => withStorage(reply, resolved.databasePath, (storage) => {
    const params = request.params as { id: string };
    return {
      persona: storage.savePersonaCard({
        ...readPersonaCardInput(request.body),
        id: params.id
      })
    };
  }));

  app.get("/api/rp/training-examples", async (request, reply) => withStorage(reply, resolved.databasePath, (storage) => {
    const query = request.query as Record<string, string | undefined>;
    return {
      examples: storage.getTrainingExamples({
        npcName: query.npcName,
        limit: readInteger(query.limit, 80, 1, MAX_QUERY_ROWS)
      })
    };
  }));

  app.post("/api/rp/training-examples", async (request, reply) => withStorage(reply, resolved.databasePath, (storage) => ({
    example: storage.saveTrainingExample(readTrainingExampleInput(request.body))
  })));

  app.get("/api/rp/memory-anchors", async (request, reply) => withStorage(reply, resolved.databasePath, (storage) => {
    const query = request.query as Record<string, string | undefined>;
    return {
      anchors: storage.getMemoryAnchors({
        npcName: query.npcName,
        scopeType: readEnum(query.scopeType, ["campaign", "session", "scene", "npc"]),
        scopeId: query.scopeId,
        visibility: readEnum(query.visibility, ["player", "kp"]),
        status: readEnum(query.status, ["confirmed", "candidate", "rejected"]),
        limit: readInteger(query.limit, 120, 1, MAX_QUERY_ROWS)
      })
    };
  }));

  app.post("/api/rp/memory-anchors", async (request, reply) => withStorage(reply, resolved.databasePath, (storage) => ({
    anchor: storage.saveMemoryAnchor(readMemoryAnchorInput(request.body))
  })));

  app.put("/api/rp/memory-anchors/:id", async (request, reply) => withStorage(reply, resolved.databasePath, (storage) => {
    const params = request.params as { id: string };
    return {
      anchor: storage.saveMemoryAnchor({
        ...readMemoryAnchorInput(request.body),
        id: params.id
      })
    };
  }));

  app.post("/api/rp/inspect", async (request, reply) => withStorage(reply, resolved.databasePath, (storage) => {
    const body = request.body as Record<string, unknown> | undefined;
    const personaId = readBodyString(body, "personaId");
    const npcName = readBodyString(body, "npcName");
    const playerText = readBodyString(body, "playerText") || "玩家问：你现在怎么看我？";
    const persona = personaId ? storage.getPersonaCard(personaId) : npcName ? storage.getPersonaCardByName(npcName) : undefined;
    if (!persona) throw httpError(404, "Persona card not found.");
    const trainingExamples = storage.getTrainingExamples({ npcName: persona.name, limit: 8 });
    const memoryAnchors = storage.getMemoryAnchors({
      npcName: persona.name,
      visibility: "player",
      status: "confirmed",
      limit: 12
    });
    const prompt = buildNpcReplyPrompt(persona.name, playerText, [], {
      persona,
      trainingExamples,
      memoryAnchors
    });
    return {
      persona,
      trainingExamples,
      memoryAnchors,
      prompt
    };
  }));

  app.post("/api/rp/export/sillytavern-character", async (request, reply) => withStorage(reply, resolved.databasePath, (storage) => {
    const body = request.body as Record<string, unknown> | undefined;
    const personaId = readBodyString(body, "personaId");
    const npcName = readBodyString(body, "npcName");
    const visibility = readEnum(readBodyString(body, "visibility"), ["player", "kp"]) ?? "player";
    const persona = personaId ? storage.getPersonaCard(personaId) : npcName ? storage.getPersonaCardByName(npcName) : undefined;
    if (!persona) throw httpError(404, "Persona card not found.");
    const anchors = storage.getMemoryAnchors({
      npcName: persona.name,
      limit: 200
    });
    const examples = storage.getTrainingExamples({
      npcName: persona.name,
      limit: 20
    });
    return exportSillyTavernCharacter({
      persona,
      anchors,
      trainingExamples: examples,
      visibility: visibility as SillyTavernExportVisibility,
      outputRoot: path.join(resolved.cwd, "outputs", "sillytavern"),
      sourceVersion: readPackageVersion(resolved.cwd)
    });
  }));

  app.get("/api/rp/export/sillytavern/:exportId/manifest", async (request, reply) => {
    const params = request.params as { exportId: string };
    const manifestPath = resolveSillyTavernExportManifestPath(resolved.cwd, params.exportId);
    if (!manifestPath) return reply.code(404).send({ error: "manifest not found" });
    try {
      return JSON.parse(fs.readFileSync(manifestPath, "utf8")) as unknown;
    } catch (error) {
      return reply.code(500).send({ error: errorMessage(error) });
    }
  });

  return { app, controller, tunnelController, options: resolved };
}

async function main(): Promise<void> {
  const options = resolveAdminOptions();
  const { app } = createAdminConsole(options);
  await app.listen({ host: "127.0.0.1", port: options.adminPort });
  const url = `http://127.0.0.1:${options.adminPort}`;
  console.log(`Bot desktop console: ${url}`);
  if (!process.argv.includes("--no-open")) {
    openDesktopWindow(url);
  }
}

function resolveAdminOptions(options: AdminConsoleOptions = {}): ResolvedAdminOptions {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const defaultBotCommand = process.platform === "win32" ? "cmd" : "npm";
  const defaultBotArgs = process.platform === "win32" ? ["/c", "npm.cmd", "run", "dev"] : ["run", "dev"];
  const botCommand = options.botCommand ?? defaultBotCommand;
  const botPort = options.botPort ?? readEnvInteger("PORT", DEFAULT_BOT_PORT);
  const tunnelCommand = options.tunnelCommand ?? (process.env.ADMIN_TUNNEL_COMMAND?.trim() || "cloudflared");
  return {
    cwd,
    adminPort: options.adminPort ?? readEnvInteger("ADMIN_PORT", DEFAULT_ADMIN_PORT),
    botPort,
    databasePath: path.resolve(cwd, options.databasePath ?? process.env.DATABASE_PATH ?? DEFAULT_DATABASE_PATH),
    logPath: path.resolve(cwd, options.logPath ?? process.env.ADMIN_BOT_LOG_PATH ?? "./logs/admin-console-bot.log"),
    botCommand,
    botArgs: options.botArgs ?? defaultBotArgs,
    tunnelLogPath: path.resolve(cwd, options.tunnelLogPath ?? process.env.ADMIN_TUNNEL_LOG_PATH ?? "./logs/admin-console-tunnel.log"),
    tunnelCommand,
    tunnelArgs: options.tunnelArgs ?? ["tunnel", "--url", `http://localhost:${botPort}`],
    autoRestart: options.autoRestart ?? readEnvBoolean("ADMIN_AUTO_RESTART", false)
  };
}

function readEnvInteger(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function readEnvBoolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  return ["1", "true", "yes", "on"].includes(raw);
}

function readInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

async function checkBotHealth(botPort: number): Promise<Record<string, unknown>> {
  const url = `http://127.0.0.1:${botPort}/health`;
  const startedAt = Date.now();
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1200) });
    return {
      ok: response.ok,
      statusCode: response.status,
      responseMs: Date.now() - startedAt,
      url
    };
  } catch (error) {
    return {
      ok: false,
      error: errorMessage(error),
      responseMs: Date.now() - startedAt,
      url
    };
  }
}

function withDatabase<T>(reply: FastifyReply, databasePath: string, fn: (db: DatabaseSync) => T): T | FastifyReply {
  if (!fs.existsSync(databasePath)) {
    return reply.code(404).send({ error: "database not found", databasePath });
  }

  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(databasePath, { readOnly: true, timeout: 5000 });
    db.exec("PRAGMA query_only = ON");
    return fn(db);
  } catch (error) {
    const statusCode = isHttpError(error) ? error.statusCode : 500;
    return reply.code(statusCode).send({ error: errorMessage(error), databasePath });
  } finally {
    db?.close();
  }
}

function withStorage<T>(reply: FastifyReply, databasePath: string, fn: (storage: BotStorage) => T): T | FastifyReply {
  let storage: BotStorage | undefined;
  try {
    storage = new BotStorage(databasePath);
    return fn(storage);
  } catch (error) {
    const statusCode = isHttpError(error) ? error.statusCode : 500;
    return reply.code(statusCode).send({ error: errorMessage(error), databasePath });
  } finally {
    storage?.close();
  }
}

function readPersonaCardInput(body: unknown): PersonaCardInput {
  const record = readBodyRecord(body);
  return {
    name: stringField(record, "name", true),
    role: readEnum(stringField(record, "role"), ["bot", "npc", "narrator"]) ?? "npc",
    publicDescription: stringField(record, "publicDescription"),
    privateNotes: stringField(record, "privateNotes"),
    speechStyle: stringField(record, "speechStyle"),
    knowledgeBoundary: stringField(record, "knowledgeBoundary"),
    exampleDialogues: stringListField(record, "exampleDialogues"),
    avoidRules: stringField(record, "avoidRules"),
    patiencePolicy: stringField(record, "patiencePolicy"),
    agencyRules: stringField(record, "agencyRules"),
    abnormalInputPolicy: stringField(record, "abnormalInputPolicy"),
    tableBoundaryPolicy: stringField(record, "tableBoundaryPolicy"),
    anchorStyle: stringField(record, "anchorStyle"),
    continuityRepairPolicy: stringField(record, "continuityRepairPolicy"),
    tags: stringListField(record, "tags")
  };
}

function readTrainingExampleInput(body: unknown): TrainingExampleInput {
  const record = readBodyRecord(body);
  return {
    npcName: stringField(record, "npcName", true),
    issueType: stringField(record, "issueType") || "未分类",
    badReply: stringField(record, "badReply"),
    correction: stringField(record, "correction"),
    goodReply: stringField(record, "goodReply"),
    score: numberField(record, "score"),
    tags: stringListField(record, "tags")
  };
}

function readMemoryAnchorInput(body: unknown): MemoryAnchorInput {
  const record = readBodyRecord(body);
  return {
    scopeType: readEnum(stringField(record, "scopeType"), ["campaign", "session", "scene", "npc"]) ?? "npc",
    scopeId: stringField(record, "scopeId"),
    npcName: stringField(record, "npcName"),
    anchorType: readEnum(stringField(record, "anchorType"), ["time", "location", "object", "person", "event", "contradiction"]) ?? "event",
    label: stringField(record, "label", true),
    content: stringField(record, "content", true),
    sourceMessageId: stringField(record, "sourceMessageId"),
    sourceType: readEnum(stringField(record, "sourceType"), ["worldbook", "chat", "kp-note", "training", "model-draft"]) ?? "kp-note",
    visibility: readEnum(stringField(record, "visibility"), ["player", "kp"]) ?? "player",
    status: readEnum(stringField(record, "status"), ["confirmed", "candidate", "rejected"]) ?? "candidate"
  };
}

function readBodyRecord(body: unknown): Record<string, unknown> {
  if (body == null || typeof body !== "object" || Array.isArray(body)) throw httpError(400, "JSON object body is required.");
  return body as Record<string, unknown>;
}

function readBodyString(body: Record<string, unknown> | undefined, key: string): string {
  if (!body) return "";
  const value = body[key];
  return typeof value === "string" ? value.trim() : "";
}

function stringField(record: Record<string, unknown>, key: string, required = false): string {
  const value = record[key];
  const text = typeof value === "string" ? value.trim() : "";
  if (required && text === "") throw httpError(400, `${key} is required.`);
  return text;
}

function stringListField(record: Record<string, unknown>, key: string): string[] {
  const value = record[key];
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
  if (typeof value === "string") return value.split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean);
  return [];
}

function numberField(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function readEnum<T extends string>(value: unknown, values: readonly T[]): T | undefined {
  return typeof value === "string" && values.includes(value as T) ? value as T : undefined;
}

function readPackageVersion(cwd: string): string {
  try {
    const raw = fs.readFileSync(path.join(cwd, "package.json"), "utf8");
    const parsed = JSON.parse(raw) as { version?: unknown };
    return typeof parsed.version === "string" ? parsed.version : "dev";
  } catch {
    return "dev";
  }
}

function resolveSillyTavernExportManifestPath(cwd: string, exportId: string): string | undefined {
  if (!/^[\w\u4e00-\u9fa5.-]+$/.test(exportId)) return undefined;
  const root = path.resolve(cwd, "outputs", "sillytavern");
  const manifestPath = path.resolve(root, exportId, "manifest.json");
  const relative = path.relative(root, manifestPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return undefined;
  return fs.existsSync(manifestPath) ? manifestPath : undefined;
}

function listTables(db: DatabaseSync): string[] {
  const rows = db.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    ORDER BY lower(name)
  `).all() as unknown as { name: string }[];
  return rows.map((row) => row.name);
}

function tableExists(db: DatabaseSync, tableName: string): boolean {
  return listTables(db).includes(tableName);
}

function assertKnownTable(db: DatabaseSync, tableName: string): void {
  if (!tableExists(db, tableName)) throw httpError(404, `Unknown table: ${tableName}`);
}

function safeTableCount(db: DatabaseSync, tableName: string): number | null {
  try {
    const row = db.prepare(`SELECT count(*) as count FROM ${quoteIdentifier(tableName)}`).get() as { count: number };
    return row.count;
  } catch {
    return null;
  }
}

function readTableRows(db: DatabaseSync, tableName: string, limit: number, offset: number): QueryRowsResult {
  const columns = tableColumns(db, tableName);
  const orderBy = columns.includes("id") ? `ORDER BY ${quoteIdentifier("id")} DESC` : "";
  const statement = db.prepare(`SELECT * FROM ${quoteIdentifier(tableName)} ${orderBy} LIMIT ? OFFSET ?`);
  const rows = collectRows(statement.iterate(limit + 1, offset) as Iterable<Record<string, unknown>>, limit);
  return { columns, ...rows };
}

interface SqlFilter {
  sql: string;
  params: SQLInputValue[];
}

function readFilteredRows(
  db: DatabaseSync,
  tableName: string,
  options: { limit: number; offset: number; filters: SqlFilter[]; orderBy: string }
): QueryRowsResult {
  const columns = tableColumns(db, tableName);
  const where = options.filters.length === 0
    ? ""
    : `WHERE ${options.filters.map((filter) => filter.sql).join(" AND ")}`;
  const params = options.filters.flatMap((filter) => filter.params);
  const statement = db.prepare(`
    SELECT *
    FROM ${quoteIdentifier(tableName)}
    ${where}
    ORDER BY ${options.orderBy}
    LIMIT ? OFFSET ?
  `);
  const rows = collectRows(statement.iterate(...params, options.limit + 1, options.offset) as Iterable<Record<string, unknown>>, options.limit);
  return { columns, ...rows };
}

function runReadOnlyQuery(db: DatabaseSync, sql: string, maxRows: number): QueryRowsResult {
  const statement = db.prepare(sql);
  const columns = uniqueColumns(statement.columns().map((column) => column.name));
  const rows = collectRows(statement.iterate() as Iterable<Record<string, unknown>>, maxRows);
  return {
    columns: columns.length > 0 ? columns : uniqueColumns(rows.rows.flatMap((row) => Object.keys(row))),
    ...rows
  };
}

function tableColumns(db: DatabaseSync, tableName: string): string[] {
  const rows = db.prepare(`PRAGMA table_info(${quoteIdentifier(tableName)})`).all() as unknown as { name: string }[];
  return rows.map((row) => row.name);
}

function collectRows(iterator: Iterable<Record<string, unknown>>, maxRows: number): {
  rows: Record<string, unknown>[];
  truncated: boolean;
} {
  const rows: Record<string, unknown>[] = [];
  let truncated = false;
  for (const row of iterator) {
    if (rows.length >= maxRows) {
      truncated = true;
      break;
    }
    rows.push(normalizeRow(row));
  }
  return { rows, truncated };
}

function normalizeRow(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, normalizeDbValue(value)]));
}

function normalizeDbValue(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Uint8Array) return `base64:${Buffer.from(value).toString("base64")}`;
  return value;
}

function enumFilter(column: string, value: string | undefined, allowed: readonly string[]): SqlFilter | undefined {
  if (!value || value === "all") return undefined;
  if (!allowed.includes(value)) throw httpError(400, `Invalid ${column}: ${value}`);
  return { sql: `${quoteIdentifier(column)} = ?`, params: [value] };
}

function exactFilter(column: string, value: string | undefined): SqlFilter | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  return { sql: `${quoteIdentifier(column)} = ?`, params: [normalized] };
}

function likeFilter(columns: string[], value: string | undefined): SqlFilter | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  return {
    sql: `(${columns.map((column) => `${quoteIdentifier(column)} LIKE ?`).join(" OR ")})`,
    params: columns.map(() => `%${normalized}%`)
  };
}

function uniqueColumns(names: string[]): string[] {
  return Array.from(new Set(names.filter((name) => name !== "")));
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, "\"\"")}"`;
}

function isReadOnlySql(sql: string): boolean {
  const head = stripLeadingSqlComments(sql).toLowerCase();
  return /^(select|with|pragma)\b/.test(head);
}

function stripLeadingSqlComments(sql: string): string {
  let value = sql.trimStart();
  let changed = true;
  while (changed) {
    changed = false;
    if (value.startsWith("--")) {
      const nextLine = value.indexOf("\n");
      value = nextLine === -1 ? "" : value.slice(nextLine + 1).trimStart();
      changed = true;
    } else if (value.startsWith("/*")) {
      const end = value.indexOf("*/");
      value = end === -1 ? "" : value.slice(end + 2).trimStart();
      changed = true;
    }
  }
  return value;
}

function httpError(statusCode: number, message: string): Error & { statusCode: number } {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;
  return error;
}

function isHttpError(error: unknown): error is Error & { statusCode: number } {
  return error instanceof Error && typeof (error as { statusCode?: unknown }).statusCode === "number";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function childProcessEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key === "" || key.startsWith("=") || key.includes("\0") || value == null || value.includes("\0")) continue;
    env[key] = value;
  }
  return env;
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode != null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.off("exit", onExit);
      resolve(false);
    }, timeoutMs);
    const onExit = (): void => {
      clearTimeout(timer);
      resolve(true);
    };
    child.once("exit", onExit);
  });
}

async function forceKill(child: ChildProcess): Promise<void> {
  if (process.platform === "win32" && child.pid != null) {
    await new Promise<void>((resolve) => {
      const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true
      });
      killer.on("exit", () => resolve());
      killer.on("error", () => resolve());
    });
    return;
  }

  try {
    child.kill("SIGKILL");
  } catch {
    // Process may already be gone.
  }
}

function openDesktopWindow(url: string): void {
  const candidates = browserCandidates();
  for (const candidate of candidates) {
    if (!candidate.needsFileCheck || fs.existsSync(candidate.command)) {
      const child = spawn(candidate.command, candidate.args(url), {
        detached: true,
        stdio: "ignore",
        windowsHide: true
      });
      child.unref();
      return;
    }
  }
}

function browserCandidates(): Array<{ command: string; needsFileCheck: boolean; args: (url: string) => string[] }> {
  if (process.platform !== "win32") {
    return [
      { command: "google-chrome", needsFileCheck: false, args: (url) => [`--app=${url}`] },
      { command: "chromium", needsFileCheck: false, args: (url) => [`--app=${url}`] },
      { command: "xdg-open", needsFileCheck: false, args: (url) => [url] }
    ];
  }

  const localAppData = process.env.LOCALAPPDATA ?? "";
  const programFiles = process.env.ProgramFiles ?? "C:\\Program Files";
  const programFilesX86 = process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
  return [
    {
      command: path.join(localAppData, "Microsoft", "Edge", "Application", "msedge.exe"),
      needsFileCheck: true,
      args: (url) => [`--app=${url}`]
    },
    {
      command: path.join(programFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
      needsFileCheck: true,
      args: (url) => [`--app=${url}`]
    },
    {
      command: path.join(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe"),
      needsFileCheck: true,
      args: (url) => [`--app=${url}`]
    },
    {
      command: path.join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
      needsFileCheck: true,
      args: (url) => [`--app=${url}`]
    },
    {
      command: "cmd",
      needsFileCheck: false,
      args: (url) => ["/c", "start", "", url]
    }
  ];
}

function renderConsoleHtml(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>QQ CoC Bot 控制台</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f6f7f9;
      --panel: #ffffff;
      --text: #1f2937;
      --muted: #697386;
      --line: #d7dde8;
      --accent: #0f766e;
      --accent-strong: #0b5f59;
      --danger: #b42318;
      --warn: #b45309;
      --good-bg: #d9f4ee;
      --bad-bg: #fde2df;
      --shadow: 0 14px 30px rgba(31, 41, 55, 0.08);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background: var(--bg);
      color: var(--text);
      font: 14px/1.5 "Segoe UI", "Microsoft YaHei", system-ui, sans-serif;
    }
    button, input, select, textarea {
      font: inherit;
    }
    button {
      border: 1px solid var(--line);
      background: #fff;
      color: var(--text);
      min-height: 34px;
      padding: 0 12px;
      border-radius: 7px;
      cursor: pointer;
    }
    button.primary {
      background: var(--accent);
      border-color: var(--accent);
      color: #fff;
    }
    button.primary:hover { background: var(--accent-strong); }
    button.danger {
      color: var(--danger);
      border-color: #efb7b2;
    }
    button:disabled {
      opacity: 0.5;
      cursor: default;
    }
    input, select, textarea {
      min-height: 34px;
      border: 1px solid var(--line);
      border-radius: 7px;
      background: #fff;
      color: var(--text);
      padding: 6px 9px;
      min-width: 0;
    }
    textarea {
      width: 100%;
      min-height: 120px;
      resize: vertical;
      font-family: Consolas, "SFMono-Regular", monospace;
    }
    .app {
      min-height: 100vh;
      display: grid;
      grid-template-rows: auto auto 1fr;
    }
    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 14px 20px;
      background: #fff;
      border-bottom: 1px solid var(--line);
    }
    .brand {
      display: flex;
      align-items: baseline;
      gap: 10px;
      min-width: 220px;
    }
    .brand h1 {
      margin: 0;
      font-size: 18px;
      font-weight: 700;
      letter-spacing: 0;
    }
    .brand span {
      color: var(--muted);
      font-size: 12px;
    }
    .actions, .filters, .tabs {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .toggle {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      color: var(--muted);
      user-select: none;
      white-space: nowrap;
    }
    .toggle input { min-height: 0; }
    .status-band {
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
      gap: 12px;
      padding: 14px 20px 8px;
    }
    .stat {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      box-shadow: var(--shadow);
      padding: 11px 12px;
      min-height: 76px;
    }
    .stat label {
      display: block;
      color: var(--muted);
      font-size: 12px;
      margin-bottom: 4px;
    }
    .stat strong {
      display: block;
      font-size: 18px;
      line-height: 1.2;
      overflow-wrap: anywhere;
    }
    .pill {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 999px;
      padding: 2px 8px;
      min-height: 24px;
      font-size: 12px;
      font-weight: 700;
      white-space: nowrap;
    }
    .pill.ok { color: #075c51; background: var(--good-bg); }
    .pill.bad { color: var(--danger); background: var(--bad-bg); }
    .pill.warn { color: var(--warn); background: #fff0d5; }
    .tabs {
      padding: 8px 20px 0;
      border-bottom: 1px solid var(--line);
    }
    .tabs button {
      border-bottom-left-radius: 0;
      border-bottom-right-radius: 0;
      border-bottom: 0;
      background: transparent;
    }
    .tabs button.active {
      background: #fff;
      color: var(--accent-strong);
      border-color: var(--line);
      font-weight: 700;
    }
    main {
      padding: 18px 20px 24px;
      min-width: 0;
    }
    .view { display: none; }
    .view.active { display: block; }
    .grid {
      display: grid;
      grid-template-columns: minmax(260px, 360px) minmax(0, 1fr);
      gap: 14px;
      align-items: start;
    }
    .panel {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      box-shadow: var(--shadow);
      padding: 14px;
      min-width: 0;
    }
    .panel + .panel { margin-top: 14px; }
    .panel h2 {
      margin: 0 0 12px;
      font-size: 15px;
      letter-spacing: 0;
    }
    .form-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }
    .form-grid .full { grid-column: 1 / -1; }
    .field label {
      display: block;
      color: var(--muted);
      font-size: 12px;
      margin-bottom: 4px;
    }
    .field input, .field select, .field textarea {
      width: 100%;
    }
    .stack {
      display: grid;
      gap: 8px;
    }
    .table-wrap {
      width: 100%;
      overflow: auto;
      border: 1px solid var(--line);
      border-radius: 8px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    th, td {
      border-bottom: 1px solid var(--line);
      padding: 8px 9px;
      text-align: left;
      vertical-align: top;
    }
    th {
      position: sticky;
      top: 0;
      background: #eef2f7;
      z-index: 1;
      white-space: nowrap;
    }
    td {
      max-width: 520px;
      overflow-wrap: anywhere;
    }
    tr:last-child td { border-bottom: 0; }
    .table-list {
      display: grid;
      gap: 6px;
    }
    .table-list button {
      width: 100%;
      justify-content: space-between;
      display: flex;
      gap: 10px;
      align-items: center;
      text-align: left;
    }
    .row-count {
      color: var(--muted);
      font-size: 12px;
    }
    .path {
      color: var(--muted);
      font-family: Consolas, "SFMono-Regular", monospace;
      font-size: 12px;
      overflow-wrap: anywhere;
    }
    .logbox {
      min-height: 460px;
      max-height: 66vh;
      overflow: auto;
      background: #111827;
      color: #e5e7eb;
      border-radius: 8px;
      padding: 12px;
      font-family: Consolas, "SFMono-Regular", monospace;
      font-size: 12px;
      white-space: pre-wrap;
    }
    .stdout { color: #d1fae5; }
    .stderr { color: #fecaca; }
    .system { color: #fde68a; }
    .empty {
      color: var(--muted);
      padding: 18px;
      text-align: center;
    }
    .error {
      color: var(--danger);
      background: var(--bad-bg);
      border: 1px solid #efb7b2;
      border-radius: 8px;
      padding: 10px 12px;
      margin-bottom: 12px;
    }
    @media (max-width: 900px) {
      .topbar { align-items: flex-start; flex-direction: column; }
      .status-band { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .grid { grid-template-columns: 1fr; }
    }
    @media (max-width: 560px) {
      .status-band { grid-template-columns: 1fr; padding-left: 12px; padding-right: 12px; }
      main, .topbar, .tabs { padding-left: 12px; padding-right: 12px; }
      .actions button, .filters button { flex: 1 1 auto; }
      .filters input, .filters select { flex: 1 1 140px; }
    }
  </style>
</head>
<body>
  <div class="app">
    <header class="topbar">
      <div class="brand">
        <h1>QQ CoC Bot 控制台</h1>
        <span>127.0.0.1</span>
      </div>
      <div class="actions">
        <button class="primary" data-action="startTunnel">Start Callback</button>
        <button data-action="restartTunnel">New Callback</button>
        <button class="danger" data-action="stopTunnel">Stop Callback</button>
        <button id="copyWebhookButton" data-action="copyWebhook">Copy URL</button>
        <button class="primary" data-action="start">启动</button>
        <button data-action="restart">重启</button>
        <button class="danger" data-action="stop">停止</button>
        <label class="toggle"><input id="autoRestart" type="checkbox"> 守护重启</label>
        <button data-action="refresh">刷新</button>
      </div>
    </header>
    <section class="status-band">
      <div class="stat"><label>进程</label><strong id="processState">--</strong></div>
      <div class="stat"><label>健康</label><strong id="healthState">--</strong></div>
      <div class="stat"><label>端口</label><strong id="portState">--</strong></div>
      <div class="stat"><label>数据库</label><strong id="dbState">--</strong></div>
      <div class="stat"><label>Callback</label><strong id="callbackState">--</strong></div>
    </section>
    <nav class="tabs">
      <button class="active" data-tab="overview">概览</button>
      <button data-tab="chat">聊天</button>
      <button data-tab="rp">NPC RP Studio</button>
      <button data-tab="database">数据库</button>
      <button data-tab="logs">日志</button>
    </nav>
    <main>
      <section id="view-overview" class="view active">
        <div class="panel">
          <h2>运行状态</h2>
          <div id="overviewStatus"></div>
        </div>
        <div class="panel">
          <h2>Temporary QQ Callback</h2>
          <div id="callbackPanel"></div>
        </div>
      </section>
      <section id="view-chat" class="view">
        <div class="panel">
          <h2>聊天审计</h2>
          <div class="filters">
            <select id="chatScopeType"><option value="all">全部场景</option><option value="group">群聊</option><option value="c2c">私聊</option></select>
            <select id="chatDirection"><option value="all">全部方向</option><option value="incoming">收到</option><option value="outgoing">发出</option></select>
            <input id="chatScopeId" placeholder="scope id">
            <input id="chatQuery" placeholder="搜索文本">
            <button data-action="loadChat">查询</button>
          </div>
          <div id="chatAuditTable" style="margin-top:12px"></div>
        </div>
        <div class="panel">
          <h2>叙事记录</h2>
          <div class="filters">
            <select id="narrativeScopeType"><option value="all">全部场景</option><option value="group">群聊</option><option value="c2c">私聊</option></select>
            <input id="narrativeKind" placeholder="kind">
            <input id="narrativeQuery" placeholder="搜索文本">
            <button data-action="loadNarrative">查询</button>
          </div>
          <div id="narrativeTable" style="margin-top:12px"></div>
        </div>
      </section>
      <section id="view-database" class="view">
        <div class="grid">
          <div class="panel">
            <h2>表</h2>
            <div class="path" id="databasePath"></div>
            <div id="tableList" class="table-list" style="margin-top:12px"></div>
          </div>
          <div>
            <div class="panel">
              <h2 id="tableTitle">数据</h2>
              <div id="tableRows"></div>
            </div>
            <div class="panel">
              <h2>只读 SQL</h2>
              <textarea id="sqlText">SELECT name, type FROM sqlite_master WHERE type = 'table' ORDER BY name;</textarea>
              <div class="actions" style="margin-top:10px"><button data-action="runSql">执行</button></div>
              <div id="sqlRows" style="margin-top:12px"></div>
            </div>
          </div>
        </div>
      </section>
      <section id="view-rp" class="view">
        <div class="grid">
          <div>
            <div class="panel">
              <h2>NPC</h2>
              <div class="actions" style="margin-bottom:10px">
                <button data-action="newPersona">新建</button>
                <button data-action="loadRp">刷新</button>
              </div>
              <div id="personaList" class="table-list"></div>
            </div>
            <div class="panel">
              <h2>SillyTavern 导出</h2>
              <div class="filters">
                <select id="exportVisibility"><option value="player">玩家版</option><option value="kp">KP-only</option></select>
                <button class="primary" data-action="exportPersona">导出</button>
              </div>
              <div id="exportResult" class="path" style="margin-top:10px"></div>
            </div>
          </div>
          <div>
            <div class="panel">
              <h2>人格卡</h2>
              <div id="personaError"></div>
              <div class="form-grid">
                <div class="field"><label>名称</label><input id="personaName"></div>
                <div class="field"><label>类型</label><select id="personaRole"><option value="npc">NPC</option><option value="bot">Bot</option><option value="narrator">叙述者</option></select></div>
                <div class="field full"><label>公开描述</label><textarea id="personaPublicDescription"></textarea></div>
                <div class="field full"><label>KP-only 备注</label><textarea id="personaPrivateNotes"></textarea></div>
                <div class="field"><label>说话风格</label><textarea id="personaSpeechStyle"></textarea></div>
                <div class="field"><label>知识边界</label><textarea id="personaKnowledgeBoundary"></textarea></div>
                <div class="field"><label>避免规则</label><textarea id="personaAvoidRules"></textarea></div>
                <div class="field"><label>耐心策略</label><textarea id="personaPatiencePolicy"></textarea></div>
                <div class="field"><label>主观行动</label><textarea id="personaAgencyRules"></textarea></div>
                <div class="field"><label>异常输入</label><textarea id="personaAbnormalInputPolicy"></textarea></div>
                <div class="field"><label>桌面边界</label><textarea id="personaTableBoundaryPolicy"></textarea></div>
                <div class="field"><label>锚点风格</label><textarea id="personaAnchorStyle"></textarea></div>
                <div class="field full"><label>连续性修复</label><textarea id="personaContinuityRepairPolicy"></textarea></div>
                <div class="field full"><label>示例对话</label><textarea id="personaExampleDialogues"></textarea></div>
                <div class="field full"><label>标签</label><input id="personaTags"></div>
              </div>
              <div class="actions" style="margin-top:10px"><button class="primary" data-action="savePersona">保存人格卡</button></div>
            </div>
            <div class="panel">
              <h2>试演预览</h2>
              <div class="field"><label>玩家台词</label><textarea id="inspectPlayerText">玩家问：你认识周先生吗？</textarea></div>
              <div class="actions" style="margin-top:10px"><button data-action="inspectPersona">查看 Prompt</button></div>
              <textarea id="inspectPrompt" readonly style="margin-top:10px; min-height:220px"></textarea>
            </div>
            <div class="panel">
              <h2>训练反馈</h2>
              <div class="form-grid">
                <div class="field"><label>问题类型</label><input id="trainingIssueType" value="不像真人"></div>
                <div class="field"><label>评分</label><input id="trainingScore" type="number" min="0" max="10"></div>
                <div class="field"><label>坏回复</label><textarea id="trainingBadReply"></textarea></div>
                <div class="field"><label>修正</label><textarea id="trainingCorrection"></textarea></div>
                <div class="field full"><label>好回复</label><textarea id="trainingGoodReply"></textarea></div>
              </div>
              <div class="actions" style="margin-top:10px"><button data-action="saveTraining">保存训练反馈</button></div>
              <div id="trainingTable" style="margin-top:12px"></div>
            </div>
            <div class="panel">
              <h2>记忆锚点</h2>
              <div class="form-grid">
                <div class="field"><label>类型</label><select id="anchorType"><option value="event">事件</option><option value="time">时间</option><option value="location">地点</option><option value="object">物件</option><option value="person">人物</option><option value="contradiction">矛盾</option></select></div>
                <div class="field"><label>状态</label><select id="anchorStatus"><option value="candidate">候选</option><option value="confirmed">已确认</option><option value="rejected">已拒绝</option></select></div>
                <div class="field"><label>可见性</label><select id="anchorVisibility"><option value="player">玩家可见</option><option value="kp">KP-only</option></select></div>
                <div class="field"><label>标题</label><input id="anchorLabel"></div>
                <div class="field full"><label>内容</label><textarea id="anchorContent"></textarea></div>
              </div>
              <div class="actions" style="margin-top:10px"><button data-action="saveAnchor">保存锚点</button></div>
              <div id="anchorTable" style="margin-top:12px"></div>
            </div>
          </div>
        </div>
      </section>
      <section id="view-logs" class="view">
        <div class="panel">
          <h2>运行日志</h2>
          <div id="logBox" class="logbox"></div>
        </div>
        <div class="panel">
          <h2>Cloudflare Tunnel Logs</h2>
          <div id="tunnelLogBox" class="logbox"></div>
        </div>
      </section>
    </main>
  </div>
  <script>
    const state = { currentTab: "overview", logCursor: 0, tunnelLogCursor: 0, selectedTable: "", selectedPersonaId: "", personas: [], cachedStatus: null };
    const $ = (id) => document.getElementById(id);

    document.querySelectorAll("[data-tab]").forEach((button) => {
      button.addEventListener("click", () => activateTab(button.dataset.tab));
    });
    document.querySelectorAll("[data-action]").forEach((button) => {
      button.addEventListener("click", () => handleAction(button.dataset.action));
    });
    $("autoRestart").addEventListener("change", async (event) => {
      await api("/api/bot/auto-restart", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: event.target.checked })
      });
      await refreshStatus();
    });

    function activateTab(tab) {
      state.currentTab = tab;
      document.querySelectorAll("[data-tab]").forEach((button) => button.classList.toggle("active", button.dataset.tab === tab));
      document.querySelectorAll(".view").forEach((view) => view.classList.remove("active"));
      $("view-" + tab).classList.add("active");
      if (tab === "database") loadDatabase();
      if (tab === "chat") { loadChat(); loadNarrative(); }
      if (tab === "rp") loadRp();
      if (tab === "logs") loadLogs();
    }

    async function handleAction(action) {
      try {
        if (action === "start") await api("/api/bot/start", { method: "POST" });
        if (action === "stop") await api("/api/bot/stop", { method: "POST" });
        if (action === "restart") await api("/api/bot/restart", { method: "POST" });
        if (action === "startTunnel") await api("/api/tunnel/start", { method: "POST" });
        if (action === "stopTunnel") await api("/api/tunnel/stop", { method: "POST" });
        if (action === "restartTunnel") await api("/api/tunnel/restart", { method: "POST" });
        if (action === "copyWebhook") await copyWebhookUrl();
        if (action === "refresh") await refreshAll();
        if (action === "loadChat") await loadChat();
        if (action === "loadNarrative") await loadNarrative();
        if (action === "runSql") await runSql();
        if (action === "loadRp") await loadRp();
        if (action === "newPersona") newPersona();
        if (action === "savePersona") await savePersona();
        if (action === "saveTraining") await saveTraining();
        if (action === "saveAnchor") await saveAnchor();
        if (action === "inspectPersona") await inspectPersona();
        if (action === "exportPersona") await exportPersona();
        await refreshStatus();
      } catch (error) {
        showError(state.currentTab === "rp" ? "personaError" : "overviewStatus", error.message);
      }
    }

    async function api(path, options) {
      const response = await fetch(path, options);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || response.statusText);
      return payload;
    }

    async function refreshAll() {
      await refreshStatus();
      if (state.currentTab === "database") await loadDatabase();
      if (state.currentTab === "chat") { await loadChat(); await loadNarrative(); }
      if (state.currentTab === "rp") await loadRp();
      if (state.currentTab === "logs") await loadLogs();
    }

    async function refreshStatus() {
      const status = await api("/api/status");
      state.cachedStatus = status;
      const running = status.bot.managedRunning;
      const healthOk = status.health.ok;
      const tunnel = status.tunnel || {};
      $("processState").innerHTML = running ? pill("ok", "托管运行") : (healthOk ? pill("warn", "外部可达") : pill("bad", "未运行"));
      $("healthState").innerHTML = healthOk ? pill("ok", status.health.statusCode + " / " + status.health.responseMs + "ms") : pill("bad", "不通");
      $("portState").textContent = "bot " + status.admin.botHealthUrl.replace(/^.*:(\\d+)\\/health$/, "$1") + " / ui " + status.admin.port;
      $("callbackState").innerHTML = tunnel.webhookUrl ? pill("ok", "Ready") : (tunnel.managedRunning ? pill("warn", "Starting") : pill("bad", "Stopped"));
      $("dbState").textContent = tailPath(status.admin.databasePath);
      $("autoRestart").checked = Boolean(status.bot.autoRestart);
      $("copyWebhookButton").disabled = !tunnel.webhookUrl;
      $("overviewStatus").innerHTML = renderKeyValues([
        ["托管进程", running ? "pid " + status.bot.pid : "未启动"],
        ["健康检查", healthOk ? "通过" : (status.health.error || "失败")],
        ["启动时间", status.bot.startedAt || ""],
        ["上次退出", status.bot.lastExit ? JSON.stringify(status.bot.lastExit) : ""],
        ["启动命令", status.bot.command],
        ["数据库", status.admin.databasePath],
        ["日志", status.bot.logPath]
      ]);
      $("callbackPanel").innerHTML = renderKeyValues([
        ["Tunnel", tunnel.managedRunning ? "pid " + tunnel.pid : "not running"],
        ["Public URL", tunnel.publicUrl || ""],
        ["QQ Webhook URL", tunnel.webhookUrl || ""],
        ["Local target", tunnel.localUrl || ""],
        ["Command", tunnel.command || ""],
        ["Log", tunnel.logPath || ""],
        ["Last exit", tunnel.lastExit ? JSON.stringify(tunnel.lastExit) : ""]
      ]);
    }

    async function loadDatabase() {
      try {
        const summary = await api("/api/database/summary");
        $("databasePath").textContent = summary.databasePath;
        $("tableList").innerHTML = summary.tables.map((table) =>
          '<button data-table="' + esc(table.name) + '"><span>' + esc(table.name) + '</span><span class="row-count">' + esc(String(table.rowCount ?? "")) + '</span></button>'
        ).join("");
        document.querySelectorAll("[data-table]").forEach((button) => button.addEventListener("click", () => loadTable(button.dataset.table)));
        if (!state.selectedTable && summary.tables.length > 0) state.selectedTable = summary.tables[0].name;
        if (state.selectedTable) await loadTable(state.selectedTable);
      } catch (error) {
        showError("tableList", error.message);
      }
    }

    async function loadTable(tableName) {
      state.selectedTable = tableName;
      $("tableTitle").textContent = tableName;
      try {
        const result = await api("/api/database/table/" + encodeURIComponent(tableName) + "?limit=100");
        renderRows("tableRows", result.columns, result.rows, result.truncated);
      } catch (error) {
        showError("tableRows", error.message);
      }
    }

    async function runSql() {
      try {
        const result = await api("/api/database/query", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sql: $("sqlText").value, maxRows: 150 })
        });
        renderRows("sqlRows", result.columns, result.rows, result.truncated);
      } catch (error) {
        showError("sqlRows", error.message);
      }
    }

    async function loadChat() {
      try {
        const params = new URLSearchParams({
          scopeType: $("chatScopeType").value,
          direction: $("chatDirection").value,
          scopeId: $("chatScopeId").value,
          q: $("chatQuery").value,
          limit: "160"
        });
        const result = await api("/api/chat/messages?" + params.toString());
        renderRows("chatAuditTable", result.columns, result.rows, result.truncated);
      } catch (error) {
        showError("chatAuditTable", error.message);
      }
    }

    async function loadNarrative() {
      try {
        const params = new URLSearchParams({
          scopeType: $("narrativeScopeType").value,
          kind: $("narrativeKind").value,
          q: $("narrativeQuery").value,
          limit: "160"
        });
        const result = await api("/api/chat/narrative?" + params.toString());
        renderRows("narrativeTable", result.columns, result.rows, result.truncated);
      } catch (error) {
        showError("narrativeTable", error.message);
      }
    }

    async function loadRp() {
      const payload = await api("/api/rp/personas");
      state.personas = payload.personas || [];
      if (!state.selectedPersonaId && state.personas.length > 0) state.selectedPersonaId = state.personas[0].id;
      renderPersonaList();
      const selected = state.personas.find((persona) => persona.id === state.selectedPersonaId);
      if (selected) {
        fillPersonaForm(selected);
        await loadTrainingAndAnchors(selected.name);
      } else {
        newPersona();
      }
    }

    function renderPersonaList() {
      $("personaList").innerHTML = state.personas.length === 0
        ? '<div class="empty">暂无 NPC</div>'
        : state.personas.map((persona) =>
            '<button data-persona="' + esc(persona.id) + '"><span>' + esc(persona.name) + '</span><span class="row-count">' + esc(persona.role) + '</span></button>'
          ).join("");
      document.querySelectorAll("[data-persona]").forEach((button) => {
        button.addEventListener("click", async () => {
          state.selectedPersonaId = button.dataset.persona;
          const selected = state.personas.find((persona) => persona.id === state.selectedPersonaId);
          if (selected) {
            fillPersonaForm(selected);
            await loadTrainingAndAnchors(selected.name);
          }
        });
      });
    }

    function newPersona() {
      state.selectedPersonaId = "";
      fillPersonaForm({
        name: "",
        role: "npc",
        publicDescription: "",
        privateNotes: "",
        speechStyle: "",
        knowledgeBoundary: "",
        exampleDialogues: [],
        avoidRules: "",
        patiencePolicy: "",
        agencyRules: "",
        abnormalInputPolicy: "",
        tableBoundaryPolicy: "",
        anchorStyle: "",
        continuityRepairPolicy: "",
        tags: []
      });
      $("trainingTable").innerHTML = '<div class="empty">保存人格卡后显示</div>';
      $("anchorTable").innerHTML = '<div class="empty">保存人格卡后显示</div>';
      $("inspectPrompt").value = "";
      $("exportResult").textContent = "";
    }

    function fillPersonaForm(persona) {
      $("personaError").innerHTML = "";
      $("personaName").value = persona.name || "";
      $("personaRole").value = persona.role || "npc";
      $("personaPublicDescription").value = persona.publicDescription || "";
      $("personaPrivateNotes").value = persona.privateNotes || "";
      $("personaSpeechStyle").value = persona.speechStyle || "";
      $("personaKnowledgeBoundary").value = persona.knowledgeBoundary || "";
      $("personaAvoidRules").value = persona.avoidRules || "";
      $("personaPatiencePolicy").value = persona.patiencePolicy || "";
      $("personaAgencyRules").value = persona.agencyRules || "";
      $("personaAbnormalInputPolicy").value = persona.abnormalInputPolicy || "";
      $("personaTableBoundaryPolicy").value = persona.tableBoundaryPolicy || "";
      $("personaAnchorStyle").value = persona.anchorStyle || "";
      $("personaContinuityRepairPolicy").value = persona.continuityRepairPolicy || "";
      $("personaExampleDialogues").value = (persona.exampleDialogues || []).join("\\n---\\n");
      $("personaTags").value = (persona.tags || []).join(", ");
    }

    function collectPersonaForm() {
      return {
        name: $("personaName").value,
        role: $("personaRole").value,
        publicDescription: $("personaPublicDescription").value,
        privateNotes: $("personaPrivateNotes").value,
        speechStyle: $("personaSpeechStyle").value,
        knowledgeBoundary: $("personaKnowledgeBoundary").value,
        avoidRules: $("personaAvoidRules").value,
        patiencePolicy: $("personaPatiencePolicy").value,
        agencyRules: $("personaAgencyRules").value,
        abnormalInputPolicy: $("personaAbnormalInputPolicy").value,
        tableBoundaryPolicy: $("personaTableBoundaryPolicy").value,
        anchorStyle: $("personaAnchorStyle").value,
        continuityRepairPolicy: $("personaContinuityRepairPolicy").value,
        exampleDialogues: $("personaExampleDialogues").value.split(/\\n---\\n|\\n\\n+/).map((item) => item.trim()).filter(Boolean),
        tags: $("personaTags").value.split(/[,，\\n]/).map((item) => item.trim()).filter(Boolean)
      };
    }

    async function savePersona() {
      const body = collectPersonaForm();
      const options = {
        method: state.selectedPersonaId ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      };
      const url = state.selectedPersonaId ? "/api/rp/personas/" + encodeURIComponent(state.selectedPersonaId) : "/api/rp/personas";
      const payload = await api(url, options);
      state.selectedPersonaId = payload.persona.id;
      await loadRp();
    }

    async function loadTrainingAndAnchors(npcName) {
      const training = await api("/api/rp/training-examples?npcName=" + encodeURIComponent(npcName));
      renderRows("trainingTable", ["issueType", "score", "badReply", "correction", "goodReply"], training.examples || [], false);
      const anchors = await api("/api/rp/memory-anchors?npcName=" + encodeURIComponent(npcName));
      renderRows("anchorTable", ["anchorType", "status", "visibility", "label", "content"], anchors.anchors || [], false);
    }

    async function saveTraining() {
      const npcName = $("personaName").value.trim();
      if (!npcName) throw new Error("请先填写 NPC 名称。");
      await api("/api/rp/training-examples", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          npcName,
          issueType: $("trainingIssueType").value,
          score: $("trainingScore").value,
          badReply: $("trainingBadReply").value,
          correction: $("trainingCorrection").value,
          goodReply: $("trainingGoodReply").value
        })
      });
      $("trainingBadReply").value = "";
      $("trainingCorrection").value = "";
      $("trainingGoodReply").value = "";
      await loadTrainingAndAnchors(npcName);
    }

    async function saveAnchor() {
      const npcName = $("personaName").value.trim();
      if (!npcName) throw new Error("请先填写 NPC 名称。");
      await api("/api/rp/memory-anchors", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          npcName,
          scopeType: "npc",
          scopeId: npcName,
          anchorType: $("anchorType").value,
          status: $("anchorStatus").value,
          visibility: $("anchorVisibility").value,
          label: $("anchorLabel").value,
          content: $("anchorContent").value
        })
      });
      $("anchorLabel").value = "";
      $("anchorContent").value = "";
      await loadTrainingAndAnchors(npcName);
    }

    async function exportPersona() {
      if (!state.selectedPersonaId) throw new Error("请先选择或保存一个 NPC。");
      const result = await api("/api/rp/export/sillytavern-character", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          personaId: state.selectedPersonaId,
          visibility: $("exportVisibility").value
        })
      });
      $("exportResult").textContent = [
        "exportId: " + result.exportId,
        "character: " + result.characterFile,
        "manifest: " + result.manifestFile,
        "visibility: " + result.manifest.visibility
      ].join("\\n");
    }

    async function inspectPersona() {
      if (!state.selectedPersonaId) throw new Error("请先选择或保存一个 NPC。");
      const result = await api("/api/rp/inspect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          personaId: state.selectedPersonaId,
          playerText: $("inspectPlayerText").value
        })
      });
      $("inspectPrompt").value = [
        "人格卡：" + result.persona.name,
        "训练样本：" + (result.trainingExamples || []).length,
        "玩家可见锚点：" + (result.memoryAnchors || []).length,
        "",
        result.prompt
      ].join("\\n");
    }

    async function loadLogs() {
      const result = await api("/api/logs?after=" + state.logCursor);
      state.logCursor = result.cursor;
      const box = $("logBox");
      for (const line of result.lines) {
        const div = document.createElement("div");
        div.className = line.stream;
        div.textContent = "[" + line.at + "] [" + line.stream + "] " + line.text;
        box.appendChild(div);
      }
      box.scrollTop = box.scrollHeight;

      const tunnelResult = await api("/api/tunnel/logs?after=" + state.tunnelLogCursor);
      state.tunnelLogCursor = tunnelResult.cursor;
      const tunnelBox = $("tunnelLogBox");
      for (const line of tunnelResult.lines) {
        const div = document.createElement("div");
        div.className = line.stream;
        div.textContent = "[" + line.at + "] [" + line.stream + "] " + line.text;
        tunnelBox.appendChild(div);
      }
      tunnelBox.scrollTop = tunnelBox.scrollHeight;
    }

    async function copyWebhookUrl() {
      const url = state.cachedStatus?.tunnel?.webhookUrl;
      if (!url) throw new Error("No temporary callback URL yet.");
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        window.prompt("Copy QQ webhook URL", url);
      }
    }

    function renderRows(targetId, columns, rows, truncated) {
      const target = $(targetId);
      if (!rows || rows.length === 0) {
        target.innerHTML = '<div class="empty">无记录</div>';
        return;
      }
      const cols = columns && columns.length ? columns : Object.keys(rows[0]);
      target.innerHTML =
        '<div class="table-wrap"><table><thead><tr>' +
        cols.map((col) => '<th>' + esc(col) + '</th>').join("") +
        '</tr></thead><tbody>' +
        rows.map((row) => '<tr>' + cols.map((col) => '<td>' + esc(formatCell(row[col])) + '</td>').join("") + '</tr>').join("") +
        '</tbody></table></div>' +
        (truncated ? '<div class="path" style="margin-top:8px">结果已截断</div>' : '');
    }

    function renderKeyValues(rows) {
      return '<div class="table-wrap"><table><tbody>' + rows.map(([key, value]) =>
        '<tr><th>' + esc(key) + '</th><td>' + esc(String(value || "--")) + '</td></tr>'
      ).join("") + '</tbody></table></div>';
    }

    function showError(targetId, message) {
      $(targetId).innerHTML = '<div class="error">' + esc(message) + '</div>';
    }

    function pill(kind, text) {
      return '<span class="pill ' + kind + '">' + esc(text) + '</span>';
    }

    function esc(value) {
      return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
    }

    function formatCell(value) {
      if (value == null) return "";
      if (typeof value === "object") return JSON.stringify(value);
      return String(value);
    }

    function tailPath(value) {
      const parts = String(value || "").split(/[\\\\/]/);
      return parts.slice(-2).join("/");
    }

    refreshAll();
    setInterval(refreshStatus, 2000);
    setInterval(() => { if (state.currentTab === "logs") loadLogs(); }, 1500);
  </script>
</body>
</html>`;
}

const directPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (directPath && fileURLToPath(import.meta.url) === directPath) {
  main().catch((error) => {
    console.error(errorMessage(error));
    process.exitCode = 1;
  });
}
