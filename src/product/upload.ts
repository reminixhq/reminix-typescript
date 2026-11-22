import type { BaseClient, RequestOptions, Schemas } from "../index.ts";

/** A file to give a run: its name, its media type and its bytes. */
export type FileUpload = {
  name: string;
  /** Its media type (default: the API takes it from the name). */
  mediaType?: string;
  data: Blob | ArrayBuffer | Uint8Array;
};

/**
 * Uploads a file to give a run (docs: Files): its bytes as the body,
 * through the client's `files.upload`, so it takes every method's options
 * (`idempotencyKey`, `headers`, `timeout`, `signal`) and retries like any
 * write. Pass the returned `id` as a file input.
 *
 *   const file = await uploadFile(api, { name: "adjustments.csv", mediaType: "text/csv", data });
 *   await api.runs.create(slug, { inputs: { statement: file.id } });
 */
export async function uploadFile(
  client: BaseClient,
  file: FileUpload,
  options: RequestOptions = {},
): Promise<Schemas["File"]> {
  const body =
    file.data instanceof Blob
      ? file.data
      : new Blob([file.data as Uint8Array<ArrayBuffer>], {
          type: file.mediaType ?? "application/octet-stream",
        });
  return (await client.files.upload(
    body,
    { name: file.name },
    {
      ...options,
      headers: {
        ...(file.mediaType ? { "content-type": file.mediaType } : {}),
        ...options.headers,
      },
    },
  )) as Schemas["File"];
}
