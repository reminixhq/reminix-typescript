/**
 * PRODUCT-OWNED SDK helpers. The platform NEVER edits this directory —
 * it exists so a fork's hand-written helpers live beside the generated
 * client without editing ../index.ts, and `pnpm platform:apply`
 * cherry-picks never conflict with them (docs/conventions.md, "Fork-owned
 * seams"). Everything exported here is re-exported by the SDK's entry and
 * published with it.
 *
 * Keep helpers thin: the generated client is the contract; a helper wraps
 * a common sequence of calls (check → work → settle), not new behaviour.
 *
 * To put the product's hero helpers ON the client (`limitry.guard(…)`),
 * export `productMethods(client: BaseClient)` returning them: createClient
 * adds them beside the generated methods (a name the client already has
 * throws). Take `BaseClient`, not `Client`, so the types don't loop.
 */
import type { BaseClient, RequestOptions } from "../index.ts";
import {
  run,
  waitForRun,
  type Run,
  type RunOptions,
  type WaitOptions,
} from "./run.ts";
import { uploadFile, type FileUpload } from "./upload.ts";

export { RunError, run, waitForRun } from "./run.ts";
export type { Run, RunOptions, WaitOptions } from "./run.ts";
export { uploadFile } from "./upload.ts";
export type { FileUpload } from "./upload.ts";

/**
 * Reminix's methods on the client (the SDK's `productMethods` seam):
 *
 *   const reminix = createClient();
 *   const { output, files } = await reminix.run("unlock-account", { email: "jane@example.com" });
 */
export const productMethods = (client: BaseClient) => ({
  /** Runs a script and answers with the finished run (./run.ts). */
  run: (slug: string, inputs?: Record<string, unknown>, options?: RunOptions) =>
    run(client, slug, inputs, options),
  /** Follows a run until it ends; throws RunError if it didn't succeed. */
  waitForRun: (started: Run | string, options?: WaitOptions) =>
    waitForRun(client, started, options),
  /** Uploads a file to give a run as an input; returns it, with its id. */
  uploadFile: (file: FileUpload, options?: RequestOptions) =>
    uploadFile(client, file, options),
});
