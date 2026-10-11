import test from "node:test";
import assert from "node:assert/strict";
import { proposeAction, ACTION_SCHEMA, localProposal } from "../js/llm.js";
import { Game } from "../js/game.js";
const raw = {
  title: "護り",
  reasoning: "考える",
  skill: "spirit",
  difficulty: 2,
  effort: 2,
  success: "護りが生まれた",
  failure: "届かない",
  consumes: [],
  effects: [
    {
      kind: "ward",
      target: "self",
      x: 1,
      y: 1,
      name: "",
      detail: "",
      symbol: "",
    },
  ],
};
const ctx = new Game({ seed: 42 }).context();
const response = (data) => new Response(JSON.stringify(data), { status: 200 });

test("OpenAI uses Responses, bearer auth, strict structured output and disabled storage", async () => {
  let request;
  const result = await proposeAction(
    { provider: "openai", key: "test-openai", model: "gpt-4.1-mini" },
    ctx,
    "影を護りに",
    {
      fetchImpl: async (url, options) => {
        request = { url, ...options, body: JSON.parse(options.body) };
        return response({
          status: "completed",
          output: [
            { type: "reasoning", content: [] },
            {
              type: "message",
              content: [{ type: "output_text", text: JSON.stringify(raw) }],
            },
          ],
        });
      },
    },
  );
  assert.deepEqual(result, raw);
  assert.equal(request.url, "https://api.openai.com/v1/responses");
  assert.equal(request.headers.Authorization, "Bearer test-openai");
  assert.equal(request.body.store, false);
  assert.equal(request.body.text.format.strict, true);
  assert.deepEqual(request.body.text.format.schema, ACTION_SCHEMA);
  assert.equal(JSON.parse(request.body.input[0].content).action, "影を護りに");
  assert.ok(!request.body.input[0].content.includes("test-openai"));
});
test("Anthropic has a separate endpoint, header and Messages schema", async () => {
  let request;
  const result = await proposeAction(
    { provider: "anthropic", key: "test-anthropic" },
    ctx,
    "影を護りに",
    {
      fetchImpl: async (url, options) => {
        request = { url, ...options, body: JSON.parse(options.body) };
        return response({
          stop_reason: "end_turn",
          content: [{ type: "text", text: JSON.stringify(raw) }],
        });
      },
    },
  );
  assert.deepEqual(result, raw);
  assert.equal(request.url, "https://api.anthropic.com/v1/messages");
  assert.equal(request.headers["x-api-key"], "test-anthropic");
  assert.equal(request.headers.Authorization, undefined);
  assert.equal(request.body.model, "claude-haiku-5-5");
  assert.deepEqual(request.body.output_config.format.schema, ACTION_SCHEMA);
});
test("API errors, incomplete results, refusals and invalid JSON leave gameplay unchanged", async () => {
  const g = new Game({ seed: 42 }),
    before = g.serialize();
  for (const status of [401, 403, 429, 500])
    await assert.rejects(
      proposeAction({ provider: "openai", key: "test" }, ctx, "護り", {
        fetchImpl: async () => new Response("{}", { status }),
      }),
    );
  for (const data of [
    { status: "incomplete" },
    { status: "completed", output: [{ content: [{ type: "refusal" }] }] },
    { output: [{ content: [{ type: "output_text", text: "invalid" }] }] },
    { output: [] },
  ])
    await assert.rejects(
      proposeAction({ provider: "openai", key: "test" }, ctx, "護り", {
        fetchImpl: async () => response(data),
      }),
    );
  assert.equal(g.serialize(), before);
});
test("request cancellation and timeout abort fetch; no retries or resource changes", async () => {
  const controller = new AbortController();
  let calls = 0;
  const fetchImpl = async (url, options) =>
    new Promise((resolve, reject) => {
      calls++;
      options.signal.addEventListener("abort", () =>
        reject(new DOMException("Aborted", "AbortError")),
      );
    });
  const promise = proposeAction(
    { provider: "openai", key: "test" },
    ctx,
    "護り",
    { signal: controller.signal, fetchImpl },
  );
  controller.abort();
  await assert.rejects(promise, /取り消し/);
  await assert.rejects(
    proposeAction({ provider: "openai", key: "test" }, ctx, "護り", {
      timeout: 5,
      fetchImpl,
    }),
    /応答/,
  );
  assert.equal(calls, 2);
});
test("missing credentials or invalid model cause no request", async () => {
  const fetchImpl = async () => {
    throw new Error("must not fetch");
  };
  await assert.rejects(
    proposeAction({ provider: "openai", key: "" }, ctx, "護り", { fetchImpl }),
    /設定/,
  );
  await assert.rejects(
    proposeAction(
      { provider: "openai", key: "test", model: "bad model" },
      ctx,
      "護り",
      { fetchImpl },
    ),
    /モデルID/,
  );
});
test("offline mode never misrepresents unsupported free text as AI interpretation", () => {
  const g = new Game({ seed: 42 });
  assert.equal(localProposal(g, "身を守る").effects[0].kind, "ward");
  assert.throws(
    () => localProposal(g, "太陽を宝石にして空を降らせる"),
    /API接続/,
  );
});
