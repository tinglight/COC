import { afterEach, describe, expect, it, vi } from "vitest";
import { QQOpenApiClient } from "../src/qq/client.js";

describe("QQOpenApiClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uploads and sends a group image message", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === "https://token.example/token") {
        return jsonResponse({ access_token: "token", expires_in: 7200 });
      }
      if (url === "https://api.example/v2/groups/group%201/files") {
        expect(JSON.parse(String(init?.body))).toEqual({
          file_type: 1,
          srv_send_msg: false,
          url: "https://example.com/cat.png"
        });
        return jsonResponse({ file_info: "uploaded-file-info" });
      }
      if (url === "https://api.example/v2/groups/group%201/messages") {
        expect(JSON.parse(String(init?.body))).toEqual({
          msg_type: 7,
          media: { file_info: "uploaded-file-info" },
          msg_id: "msg1",
          msg_seq: 2
        });
        return jsonResponse({});
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new QQOpenApiClient({
      appId: "app",
      appSecret: "secret",
      apiBaseUrl: "https://api.example",
      tokenUrl: "https://token.example/token"
    });

    await client.sendImageMessage({ type: "group", groupOpenid: "group 1" }, "https://example.com/cat.png", "msg1", 2);

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("sends c2c wakeup text messages with the is_wakeup flag", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === "https://token.example/token") {
        return jsonResponse({ access_token: "token", expires_in: 7200 });
      }
      if (url === "https://api.example/v2/users/private%201/messages") {
        expect(JSON.parse(String(init?.body))).toEqual({
          content: "secret",
          msg_type: 0,
          is_wakeup: true
        });
        return jsonResponse({});
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new QQOpenApiClient({
      appId: "app",
      appSecret: "secret",
      apiBaseUrl: "https://api.example",
      tokenUrl: "https://token.example/token"
    });

    await client.sendTextMessage({ type: "c2c", userOpenid: "private 1" }, "secret", undefined, 1, { isWakeup: true });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}
