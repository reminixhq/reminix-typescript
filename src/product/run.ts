import { SdkError } from "../errors.ts";
import type { BaseClient, Schemas } from "../index.ts";
import { uploadFile, type FileUpload } from "./upload.ts";

/**
 * `reminix.run(slug, inputs)` — the SDK's hero helper (decided
 * 2026-10-11): one call that runs a script and answers with the finished
 * run, as `reminix scripts run` does on the command line. Files in the
 * inputs (a Blob, a File, or `{ name, data }`) are uploaded first and
 * given by id; a long run, or one awaiting a person's approval, is
 * followed until it ends; a run that fails or is cancelled throws
 * RunError, with the run. The finished run carries its output and the
 * files it saved, each with a download link.
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
  /** Answer at once instead of following a long run, or one awaiting approval, to its end. */
  wait?: boolean;
  /** Called once if the run waits for a person, with the link to approve it. */
  onApproval?: (approveUrl: string | null) => void;
  /** How often to check a run that hasn't ended, in milliseconds (default 2000). */
  pollInterval?: number;
  /**
   * Stop waiting (the run itself carries on): every call it makes stops
   * too. `AbortSignal.timeout(ms)` limits the whole wait.
   */
  signal?: AbortSignal;
  /** Your key for this run: the same key again starts no second run. */
  idempotencyKey?: string;
};

export type Run = Schemas["Run"];

/**
 * A run that ended without succeeding: failed, or cancelled. The API's
 * `error` says why (an approval denied or expired, cancelled by a person,
 * its environment deleted).
 */
export class RunError extends SdkError {
  readonly run: Run;
  constructor(run: Run) {
    super(
      run.status === "cancelled"
        ? `Run ${run.id} was cancelled: ${run.error ?? "no reason given"}`
        : `Run ${run.id} failed: ${run.error ?? "no error message"}`,
    );
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
  signal?: AbortSignal,
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
              mediaType: value.type,
              data: value,
            }
          : value,
        {
          ...(idempotencyKey
            ? { idempotencyKey: `${idempotencyKey}:file-${++uploaded}` }
            : {}),
          signal,
        },
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

/**
 * Follows a run until it ends, given the run or its id; throws RunError
 * if it didn't succeed.
 */
export async function waitForRun(
  client: BaseClient,
  run: Run | string,
  options: Pick<RunOptions, "pollInterval" | "signal"> = {},
): Promise<Run> {
  const { signal } = options;
  let current =
    typeof run === "string" ? await client.runs.get(run, { signal }) : run;
  while (!ENDED.has(current.status)) {
    await pause(options.pollInterval ?? 2000, signal);
    current = await client.runs.get(current.id, { signal });
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
  // The caller's signal reaches every call: the uploads, the start, each poll.
  const { signal } = options;
  const body = {
    inputs: await withFileIds(client, inputs, options.idempotencyKey, signal),
  };
  const keyed = {
    ...(options.idempotencyKey
      ? { idempotencyKey: options.idempotencyKey }
      : {}),
    signal,
  };
  const started = (
    options.version === undefined
      ? await client.runs.create(slug, body, keyed)
      : await client.scriptVersions.testRun(slug, options.version, body, keyed)
  ) as Run & { approval?: { approveUrl: string } | null };
  if (started.status === "awaiting_approval") {
    options.onApproval?.(started.approval?.approveUrl ?? null);
  }
  if (options.wait === false) return started;
  return waitForRun(client, started, options);
}
