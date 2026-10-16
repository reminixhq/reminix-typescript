import { describe, expect, expectTypeOf, it } from "vitest";

import { createClient } from "../index.ts";
import { RunError, type Run } from "./index.ts";

/** A fake Reminix answering each request in turn, recording what it got. */
function fake(...answers: Response[]) {
  const requests: {
    method: string;
    path: string;
    body: string;
    key: string | null;
  }[] = [];
  const reminix = createClient({
    token: "sk_x",
    api: "https://api.example.test",
    fetch: async (request) => {
      const url = new URL(request.url);
      requests.push({
        method: request.method,
        path: url.pathname + url.search,
        body: await request.text(),
        key: request.headers.get("idempotency-key"),
      });
      const answer = answers.shift();
      if (!answer) throw new Error("no answer queued");
      return answer;
    },
  });
  return { reminix, requests };
}

const run = (over: Partial<Run>): Run =>
  ({
    id: "run_1",
    status: "succeeded",
    output: null,
    error: null,
    files: [],
    ...over,
  }) as Run;

describe("reminix.run", () => {
  it("keys the run and each upload from idempotencyKey, the same every call", async () => {
    const keysOf = async () => {
      const { reminix, requests } = fake(
        Response.json({ id: "file_1" }, { status: 201 }),
        Response.json(run({}), { status: 201 }),
      );
      await reminix.run(
        "refund-customer",
        { statement: { name: "sept.csv", data: new Uint8Array([1]) } },
        { idempotencyKey: "nightly-42" },
      );
      return requests.map((r) => r.key);
    };
    const first = await keysOf();
    expect(first).toEqual(["nightly-42:file-1", "nightly-42"]);
    expect(await keysOf()).toEqual(first);
  });

  it("runs a script and answers with the finished run", async () => {
    const { reminix, requests } = fake(
      Response.json(run({ output: { refunded: true } })),
    );
    const done = await reminix.run("refund-customer", { orderId: "o_123" });
    expect(done.output).toEqual({ refunded: true });
    expect(requests).toMatchObject([
      {
        method: "POST",
        path: "/v1/scripts/refund-customer/runs",
        body: JSON.stringify({ inputs: { orderId: "o_123" } }),
      },
    ]);
  });

  it("follows a long run until it ends", async () => {
    const { reminix, requests } = fake(
      Response.json(run({ status: "running" }), { status: 202 }),
      Response.json(run({ status: "running" })),
      Response.json(run({ output: 42 })),
    );
    const done = await reminix.run("nightly-report", {}, { pollMs: 1 });
    expect(done.output).toBe(42);
    expect(requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      "POST /v1/scripts/nightly-report/runs",
      "GET /v1/runs/run_1",
      "GET /v1/runs/run_1",
    ]);
  });

  it("throws RunError, with the run, when it fails", async () => {
    const { reminix } = fake(
      Response.json(run({ status: "failed", error: "KeyError: 'orderId'" })),
    );
    const failure = await reminix
      .run("refund-customer")
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(RunError);
    expect((failure as RunError).message).toContain("KeyError: 'orderId'");
    expect((failure as RunError).run.status).toBe("failed");
  });

  it("tells you where to approve a held run, and throws if it is turned down", async () => {
    const { reminix } = fake(
      Response.json(
        {
          ...run({ status: "awaiting_approval" }),
          approval: { id: "apr_1", approveUrl: "https://app.example/a/1" },
        },
        { status: 202 },
      ),
      Response.json(run({ status: "cancelled" })),
    );
    const links: (string | null)[] = [];
    const failure = await reminix
      .run(
        "refund-customer",
        {},
        {
          pollMs: 1,
          onApproval: (url) => links.push(url),
        },
      )
      .catch((error: unknown) => error);
    expect(links).toEqual(["https://app.example/a/1"]);
    expect((failure as RunError).message).toContain("cancelled");
  });

  it("answers at once with wait: false", async () => {
    const { reminix, requests } = fake(
      Response.json(run({ status: "running" }), { status: 202 }),
    );
    const started = await reminix.run("nightly-report", {}, { wait: false });
    expect(started.status).toBe("running");
    expect(requests).toHaveLength(1);
  });

  it("uploads files given as inputs and passes their ids", async () => {
    const { reminix, requests } = fake(
      Response.json({ id: "file_1", name: "sept.csv" }, { status: 201 }),
      Response.json(run({})),
    );
    await reminix.run("summarise", {
      statement: {
        name: "sept.csv",
        type: "text/csv",
        data: new Uint8Array([97]),
      },
      month: "2026-09",
    });
    expect(requests[0].path).toBe("/v1/files?name=sept.csv");
    expect(JSON.parse(requests[1].body)).toEqual({
      inputs: { statement: "file_1", month: "2026-09" },
    });
  });

  it("is typed on the client", () => {
    const { reminix } = fake();
    expectTypeOf(reminix.run).returns.resolves.toEqualTypeOf<Run>();
    expectTypeOf(reminix.runs.list).toBeFunction();
  });
});
