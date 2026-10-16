import type { BaseClient, Schemas } from "../index.ts";
import { uploadFile, type FileUpload } from "./upload.ts";

/**
 * `reminix.run(slug, inputs)` — the SDK's hero helper (decided
 * 2026-10-11): one call that runs a script and answers with the finished
 * run, as `reminix scripts run` does on the command line. Files in the
 * inputs (a Blob, a File, or `{ name, data }`) are uploaded first and
 * given by id; a long run, or one held for a person's approval, is
 * followed until it ends; a run that fails or is cancelled throws
 * RunError, with the run. The finished run carries its output and the
 * files it wrote, each with a download link.
 *
 * Every request sends an Idempotency-Key and the client retries a failed
 * attempt with it, so one call starts one run. To make a retry of the
 * whole call safe — a job that reruns — pass `idempotencyKey`: the run
 * and each file it uploads send keys made from it, so calling again
 * with the same key and inputs answers with the first run.
 */

export type RunOptions = {
  /** Run this version (a draft, as a test run) instead of the published one. */
  version?: number;
  /** Answer at once instead of following a long or held run to its end. */
  wait?: boolean;
  /** Called once if the run waits for a person, with the link to approve it. */
  onApproval?: (approveUrl: string | null) => void;
  /** How often to check a run that hasn't ended (default 2 s). */
  pollMs?: number;
  /** Stop waiting (the run itself carries on). */
  signal?: AbortSignal;
  /** Your key for this run: the same key again starts no second run. */
  idempotencyKey?: string;
};

export type Run = Schemas["Run"];

/** A run that ended without succeeding: failed, or cancelled (an approval denied or expired). */
export class RunError extends Error {
  readonly run: Run;
  constructor(run: Run) {
    super(
      run.status === "cancelled"
        ? `Run ${run.id} was cancelled: its approval was denied or expired`
        : `Run ${run.id} failed: ${run.error ?? "no error message"}`,
    );
    this.name = "RunError";
    this.run = run;
  }
}

const ENDED = new Set(["succeeded", "failed", "cancelled"]);

const isUpload = (value: unknown): value is FileUpload | Blob =>
  (typeof Blob !== "undefined" && value instanceof Blob) ||
  (typeof value === "object" &&
    value !== null &&
    "name" in value &&
    "data" in value);

/** The inputs with every file uploaded and replaced by its id. */
async function withFileIds(
  client: BaseClient,
  inputs: Record<string, unknown>,
  idempotencyKey?: string,
): Promise<Record<string, unknown>> {
  // The nth file's key, in input order: the same on every call.
  let uploaded = 0;
  const upload = async (value: FileUpload | Blob) =>
    (
      await uploadFile(
        client,
        value instanceof Blob
          ? {
              name: "name" in value ? String(value.name) : "upload",
              type: value.type,
              data: value,
            }
          : value,
        idempotencyKey
          ? { idempotencyKey: `${idempotencyKey}:file-${++uploaded}` }
          : {},
      )
    ).id;
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(inputs)) {
    if (isUpload(value)) out[name] = await upload(value);
    else if (Array.isArray(value) && value.some(isUpload)) {
      // One at a time, so each file's key follows input order.
      const items: unknown[] = [];
      for (const item of value) {
        items.push(isUpload(item) ? await upload(item) : item);
      }
      out[name] = items;
    } else out[name] = value;
  }
  return out;
}

const pause = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });

/** Follows a run until it ends; throws RunError if it didn't succeed. */
export async function waitForRun(
  client: BaseClient,
  run: Run,
  options: Pick<RunOptions, "pollMs" | "signal"> = {},
): Promise<Run> {
  let current = run;
  while (!ENDED.has(current.status)) {
    await pause(options.pollMs ?? 2000, options.signal);
    current = await client.runs.get(current.id);
  }
  if (current.status !== "succeeded") throw new RunError(current);
  return current;
}

/** Runs a script and answers with the finished run (see above). */
export async function run(
  client: BaseClient,
  slug: string,
  inputs: Record<string, unknown> = {},
  options: RunOptions = {},
): Promise<Run> {
  const body = {
    inputs: await withFileIds(client, inputs, options.idempotencyKey),
  };
  const keyed = options.idempotencyKey
    ? { idempotencyKey: options.idempotencyKey }
    : {};
  const started = (
    options.version === undefined
      ? await client.runs.create(slug, body, keyed)
      : await client.scriptVersions.run(slug, options.version, body, keyed)
  ) as Run & { approval?: { approveUrl: string } | null };
  if (started.status === "awaiting_approval") {
    options.onApproval?.(started.approval?.approveUrl ?? null);
  }
  if (options.wait === false) return started;
  return waitForRun(client, started, options);
}
