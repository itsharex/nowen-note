import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nowen-embedding-user-settings-"));
process.env.DB_PATH = path.join(tmpDir, "test.db");

let closeDb: () => void;
let embedQuery: typeof import("../src/services/embedding-worker").embedQuery;
let setUserAISettings: typeof import("../src/services/user-ai-settings").setUserAISettings;

test.before(async () => {
  const [schema, worker, settings] = await Promise.all([
    import("../src/db/schema"),
    import("../src/services/embedding-worker"),
    import("../src/services/user-ai-settings"),
  ]);
  closeDb = schema.closeDb;
  embedQuery = worker.embedQuery;
  setUserAISettings = settings.setUserAISettings;
  schema.getDb().prepare("INSERT INTO users (id, username, passwordHash) VALUES (?, ?, ?)").run("embed-a", "embed-a", "hash");
  schema.getDb().prepare("INSERT INTO users (id, username, passwordHash) VALUES (?, ?, ?)").run("embed-b", "embed-b", "hash");
});

test.after(async () => {
  closeDb?.();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      return;
    } catch (error: any) {
      if (error?.code !== "EBUSY" || attempt === 4) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
});

test("embedQuery uses the requested user's URL, key, and model", async () => {
  setUserAISettings("embed-a", [
    { key: "ai_provider", value: "openai" },
    { key: "ai_embedding_url", value: "https://embed-a.example/v1" },
    { key: "ai_embedding_key", value: "embed-key-a" },
    { key: "ai_embedding_model", value: "embed-model-a" },
  ]);
  setUserAISettings("embed-b", [
    { key: "ai_provider", value: "openai" },
    { key: "ai_embedding_url", value: "https://embed-b.example/v1" },
    { key: "ai_embedding_key", value: "embed-key-b" },
    { key: "ai_embedding_model", value: "embed-model-b" },
  ]);

  const requests: Array<{ url: string; authorization: string; model: string }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({
      url: String(input),
      authorization: new Headers(init?.headers).get("authorization") || "",
      model: JSON.parse(String(init?.body)).model,
    });
    return new Response(JSON.stringify({ data: [{ index: 0, embedding: [0.1, 0.2] }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  try {
    await embedQuery("embed-a", "alpha question");
    await embedQuery("embed-b", "beta question");
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(requests, [
    { url: "https://embed-a.example/v1/embeddings", authorization: "Bearer embed-key-a", model: "embed-model-a" },
    { url: "https://embed-b.example/v1/embeddings", authorization: "Bearer embed-key-b", model: "embed-model-b" },
  ]);
});
