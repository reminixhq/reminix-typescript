import { describe, expect, expectTypeOf, it } from "vitest";

import { createClient, ReminixError } from "../index.ts";
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
    baseURL: "https://api.example.test",
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
    const done = await reminix.run("nightly-report", {}, { pollInterval: 1 });
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
    // Under the SDK's own base, like every error it throws.
    expect(failure).toBeInstanceOf(ReminixError);
    expect((failure as RunError).name).toBe("RunError");
    expect((failure as RunError).message).toContain("KeyError: 'orderId'");
    expect((failure as RunError).run.status).toBe("failed");
  });

  it("tells you where to approve a run awaiting approval, and throws if it is turned down", async () => {
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
          pollInterval: 1,
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
        mediaType: "text/csv",
        data: new Uint8Array([97]),
      },
      month: "2026-09",
    });
    expect(requests[0].path).toBe("/v1/files?name=sept.csv");
    expect(JSON.parse(requests[1].body)).toEqual({
      inputs: { statement: "file_1", month: "2026-09" },
    });
  });

  it("follows a run by its id alone", async () => {
    const { reminix, requests } = fake(
      Response.json(run({ status: "running" })),
      Response.json(run({ output: 9 })),
    );
    const done = await reminix.waitForRun("run_1", { pollInterval: 1 });
    expect(done.output).toBe(9);
    expect(requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      "GET /v1/runs/run_1",
      "GET /v1/runs/run_1",
    ]);
  });

  it("follows a run it was handed, on the client too", async () => {
    const { reminix, requests } = fake(Response.json(run({ output: 7 })));
    const done = await reminix.waitForRun(run({ status: "running" }), {
      pollInterval: 1,
    });
    expect(done.output).toBe(7);
    expect(requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      "GET /v1/runs/run_1",
    ]);
  });

  it("sends the key given to uploadFile on the client", async () => {
    const { reminix, requests } = fake(
      Response.json({ id: "file_1" }, { status: 201 }),
    );
    await reminix.uploadFile(
      { name: "sept.csv", data: new Uint8Array([1]) },
      { idempotencyKey: "upload-42" },
    );
    expect(requests[0].key).toBe("upload-42");
  });

  it("stops at AbortSignal.timeout, a slow call included, and the run carries on", async () => {
    // The start answers; the poll never does, until its signal aborts.
    let polled: AbortSignal | undefined;
    const reminix = createClient({
      token: "sk_x",
      baseURL: "https://api.example.test",
      maxRetries: 0,
      fetch: (request) => {
        if (request.method === "POST") {
          return Promise.resolve(
            Response.json(run({ status: "running" }), { status: 202 }),
          );
        }
        polled = request.signal;
        return new Promise((_, fail) =>
          request.signal.addEventListener("abort", () =>
            fail(request.signal.reason),
          ),
        );
      },
    });
    const failure = await reminix
      .run(
        "nightly-report",
        {},
        { pollInterval: 1, signal: AbortSignal.timeout(50) },
      )
      .catch((error: unknown) => error);
    expect((failure as Error).name).toBe("TimeoutError");
    expect(polled?.aborted).toBe(true);
  });

  it("passes its signal to every call", async () => {
    const signals: (AbortSignal | null)[] = [];
    const controller = new AbortController();
    const reminix = createClient({
      token: "sk_x",
      baseURL: "https://api.example.test",
      fetch: (request) => {
        signals.push(request.signal);
        controller.abort();
        return Promise.resolve(
          request.url.includes("/files")
            ? Response.json({ id: "file_1" }, { status: 201 })
            : Response.json(run({ status: "running" }), { status: 202 }),
        );
      },
    });
    const failure = await reminix
      .run(
        "summarise",
        { statement: { name: "a.csv", data: new Uint8Array([1]) } },
        { pollInterval: 1, signal: controller.signal },
      )
      .catch((error: unknown) => error);
    // The upload saw the signal; the abort it set off stopped the call.
    expect(signals[0]?.aborted).toBe(true);
    expect((failure as Error).name).toBe("AbortError");
  });

  it("sends its headers on every request it makes", async () => {
    const traces: (string | null)[] = [];
    const answers = [
      Response.json({ id: "file_1" }, { status: 201 }),
      Response.json(run({ status: "running" }), { status: 202 }),
      Response.json(run({}), { status: 200 }),
    ];
    const reminix = createClient({
      token: "sk_x",
      baseURL: "https://api.example.test",
      fetch: async (request) => {
        traces.push(request.headers.get("x-trace"));
        return answers.shift()!;
      },
    });
    await reminix.run(
      "summarise",
      { statement: { name: "a.csv", data: new Uint8Array([1]) } },
      { pollInterval: 1, headers: { "x-trace": "t-1" } },
    );
    // The upload, the start and the poll.
    expect(traces).toEqual(["t-1", "t-1", "t-1"]);
  });

  it("limits each request with timeout, and retries one that timed out", async () => {
    // waitForRun's first poll never answers; its retry does.
    let attempts = 0;
    const reminix = createClient({
      token: "sk_x",
      baseURL: "https://api.example.test",
      timeout: 60_000,
      fetch: (request) => {
        attempts += 1;
        expect(request.headers.has("x-sdk-timeout")).toBe(false);
        if (attempts > 1) return Promise.resolve(Response.json(run({})));
        return new Promise<Response>((_, fail) => {
          if (request.signal.aborted) return fail(request.signal.reason);
          request.signal.addEventListener("abort", () =>
            fail(request.signal.reason),
          );
        });
      },
    });
    const started = Date.now();
    const done = await reminix.waitForRun("run_1", { timeout: 50 });
    expect(done.status).toBe("succeeded");
    expect(attempts).toBe(2);
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("takes every method's options on uploadFile: headers, timeout and signal", async () => {
    const seen: (string | null)[] = [];
    const reminix = createClient({
      token: "sk_x",
      baseURL: "https://api.example.test",
      maxRetries: 0,
      // As fetch does: an aborted request fails at once.
      fetch: async (request) => {
        if (request.signal.aborted) throw request.signal.reason;
        seen.push(request.headers.get("x-trace"));
        return Response.json({ id: "file_2" }, { status: 201 });
      },
    });
    await reminix.uploadFile(
      { name: "a.csv", data: new Uint8Array([1]) },
      { headers: { "x-trace": "t-2" }, timeout: 5_000 },
    );
    expect(seen).toEqual(["t-2"]);
    const controller = new AbortController();
    controller.abort();
    await expect(
      reminix.uploadFile(
        { name: "a.csv", data: new Uint8Array([1]) },
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(seen).toEqual(["t-2"]);
  });

  it("is typed on the client", () => {
    const { reminix } = fake();
    expectTypeOf(reminix.run).returns.resolves.toEqualTypeOf<Run>();
    expectTypeOf(reminix.runs.list).toBeFunction();
  });
});
