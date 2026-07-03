import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createAdminConsole,
  extractTryCloudflareUrl,
  type BotProcessController,
  type TunnelProcessController
} from "../src/adminConsole.js";
import { BotStorage } from "../src/storage.js";

const controllers: BotProcessController[] = [];
const tunnelControllers: TunnelProcessController[] = [];

afterEach(async () => {
  for (const controller of tunnelControllers.splice(0)) {
    await controller.stop();
  }
  for (const controller of controllers.splice(0)) {
    await controller.stop();
  }
});

describe("admin console", () => {
  it("serves database summary, chat audit rows, and read-only SQL", async () => {
    const databasePath = path.join(os.tmpdir(), `qq-coc-admin-console-${Date.now()}.sqlite`);
    const storage = new BotStorage(databasePath);
    storage.recordChatAudit({
      direction: "incoming",
      scopeType: "group",
      scopeId: "group1",
      userId: "member1",
      eventType: "GROUP_MESSAGE_CREATE",
      content: "the archive door opened"
    });
    storage.addNarrativeEvent({
      kind: "ai_reply",
      scopeType: "group",
      scopeId: "group1",
      userId: "member1",
      inputText: "what changed?",
      outputText: "the archive door opened",
      metadata: { trigger: "test" }
    });
    storage.close();

    const { app, controller } = createAdminConsole({
      cwd: process.cwd(),
      databasePath,
      botCommand: process.execPath,
      botArgs: ["-e", "setInterval(() => {}, 1000)"]
    });
    controllers.push(controller);

    const summary = await app.inject({ method: "GET", url: "/api/database/summary" });
    expect(summary.statusCode).toBe(200);
    expect(summary.json().tables).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "chat_audit_log", rowCount: 1 })
    ]));

    const chat = await app.inject({ method: "GET", url: "/api/chat/messages?scopeType=group&q=archive" });
    expect(chat.statusCode).toBe(200);
    expect(chat.json().rows).toEqual([
      expect.objectContaining({
        direction: "incoming",
        scope_id: "group1",
        content: "the archive door opened"
      })
    ]);

    const narrative = await app.inject({ method: "GET", url: "/api/chat/narrative?q=archive" });
    expect(narrative.statusCode).toBe(200);
    expect(narrative.json().rows).toEqual([
      expect.objectContaining({ kind: "ai_reply", output_text: "the archive door opened" })
    ]);

    const query = await app.inject({
      method: "POST",
      url: "/api/database/query",
      headers: { "content-type": "application/json" },
      payload: { sql: "SELECT count(*) AS count FROM chat_audit_log", maxRows: 5 }
    });
    expect(query.statusCode).toBe(200);
    expect(query.json().rows).toEqual([{ count: 1 }]);

    const rejected = await app.inject({
      method: "POST",
      url: "/api/database/query",
      headers: { "content-type": "application/json" },
      payload: { sql: "DELETE FROM chat_audit_log" }
    });
    expect(rejected.statusCode).toBe(400);

    await app.close();
  });

  it("extracts and exposes a temporary Cloudflare callback URL", async () => {
    expect(extractTryCloudflareUrl("Visit it at https://example-bot.trycloudflare.com")).toBe("https://example-bot.trycloudflare.com");

    const tunnelScript = [
      "console.error('Your quick Tunnel has been created!');",
      "console.error('https://example-bot.trycloudflare.com');",
      "setInterval(() => {}, 1000);"
    ].join("");
    const { app, controller, tunnelController } = createAdminConsole({
      cwd: process.cwd(),
      botCommand: process.execPath,
      botArgs: ["-e", "setInterval(() => {}, 1000)"],
      tunnelCommand: process.execPath,
      tunnelArgs: ["-e", tunnelScript],
      tunnelLogPath: path.join(os.tmpdir(), `qq-coc-admin-tunnel-${Date.now()}.log`)
    });
    controllers.push(controller);
    tunnelControllers.push(tunnelController);

    const start = await app.inject({ method: "POST", url: "/api/tunnel/start" });
    expect(start.statusCode).toBe(200);

    const status = await waitFor(async () => {
      const response = await app.inject({ method: "GET", url: "/api/status" });
      expect(response.statusCode).toBe(200);
      const payload = response.json();
      return payload.tunnel.webhookUrl ? payload : undefined;
    });
    expect(status.bot.managedRunning).toBe(true);
    expect(status.tunnel.managedRunning).toBe(true);
    expect(status.tunnel.publicUrl).toBe("https://example-bot.trycloudflare.com");
    expect(status.tunnel.webhookUrl).toBe("https://example-bot.trycloudflare.com/qq/webhook");

    const logs = await app.inject({ method: "GET", url: "/api/tunnel/logs" });
    expect(logs.statusCode).toBe(200);
    expect(logs.json().lines).toEqual(expect.arrayContaining([
      expect.objectContaining({ text: expect.stringContaining("example-bot.trycloudflare.com") })
    ]));

    await app.close();
  });

  it("serves NPC RP Studio APIs and exports a player-safe SillyTavern card", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "qq-coc-admin-rp-"));
    const databasePath = path.join(cwd, "data", "bot.sqlite");
    const { app, controller } = createAdminConsole({
      cwd,
      databasePath,
      botCommand: process.execPath,
      botArgs: ["-e", "setInterval(() => {}, 1000)"]
    });
    controllers.push(controller);

    const html = await app.inject({ method: "GET", url: "/" });
    expect(html.statusCode).toBe(200);
    expect(html.body).toContain("NPC RP Studio");

    const personaResponse = await app.inject({
      method: "POST",
      url: "/api/rp/personas",
      headers: { "content-type": "application/json" },
      payload: {
        name: "林医生",
        publicDescription: "教会临时诊所的医生。",
        privateNotes: "KP-only：他知道旧码头真相。",
        speechStyle: "克制、少说。",
        exampleDialogues: ["林医生：先坐下。"]
      }
    });
    expect(personaResponse.statusCode).toBe(200);
    const persona = personaResponse.json().persona;

    await app.inject({
      method: "POST",
      url: "/api/rp/memory-anchors",
      headers: { "content-type": "application/json" },
      payload: {
        npcName: "林医生",
        anchorType: "object",
        label: "病历本",
        content: "玩家已公开见过病历本。",
        visibility: "player",
        status: "confirmed"
      }
    });
    await app.inject({
      method: "POST",
      url: "/api/rp/memory-anchors",
      headers: { "content-type": "application/json" },
      payload: {
        npcName: "林医生",
        anchorType: "event",
        label: "旧码头真相",
        content: "凶手去了旧码头。",
        visibility: "kp",
        status: "confirmed"
      }
    });

    const inspectResponse = await app.inject({
      method: "POST",
      url: "/api/rp/inspect",
      headers: { "content-type": "application/json" },
      payload: {
        personaId: persona.id,
        playerText: "玩家问：你认识周先生吗？"
      }
    });
    expect(inspectResponse.statusCode).toBe(200);
    expect(inspectResponse.json().prompt).toContain("病历本");
    expect(inspectResponse.json().prompt).not.toContain("旧码头真相");

    const exportResponse = await app.inject({
      method: "POST",
      url: "/api/rp/export/sillytavern-character",
      headers: { "content-type": "application/json" },
      payload: {
        personaId: persona.id,
        visibility: "player"
      }
    });
    expect(exportResponse.statusCode).toBe(200);
    const exported = exportResponse.json();
    const exportedText = JSON.stringify(exported.card);
    expect(exported.manifest.visibility).toBe("player");
    expect(exportedText).toContain("病历本");
    expect(exportedText).not.toContain("旧码头真相");
    expect(exportedText).not.toContain("凶手去了旧码头");

    const manifestResponse = await app.inject({
      method: "GET",
      url: `/api/rp/export/sillytavern/${encodeURIComponent(exported.exportId)}/manifest`
    });
    expect(manifestResponse.statusCode).toBe(200);
    expect(manifestResponse.json()).toMatchObject({
      exportId: exported.exportId,
      personaId: persona.id,
      visibility: "player"
    });

    await app.close();
  });

  it("stops a Windows command wrapper process tree", async () => {
    if (process.platform !== "win32") return;

    const port = 39_000 + Math.floor(Math.random() * 1000);
    const script = [
      "const http=require('node:http');",
      "const server=http.createServer((_,res)=>res.end('ok'));",
      `server.listen(${port},'127.0.0.1');`,
      "setInterval(() => {}, 1000);"
    ].join("");
    const { app, controller } = createAdminConsole({
      cwd: process.cwd(),
      botCommand: "cmd",
      botArgs: ["/c", "node", "-e", script],
      botPort: port
    });
    controllers.push(controller);

    await controller.start();
    await waitFor(async () => {
      try {
        const response = await fetch(`http://127.0.0.1:${port}`);
        return response.ok ? true : undefined;
      } catch {
        return undefined;
      }
    });

    await controller.stop();
    await waitFor(async () => {
      try {
        await fetch(`http://127.0.0.1:${port}`);
        return undefined;
      } catch {
        return true;
      }
    }, 3000);

    await app.close();
  });
});

async function waitFor<T>(fn: () => Promise<T | undefined>, timeoutMs = 2000): Promise<T> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const value = await fn();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for condition");
}
