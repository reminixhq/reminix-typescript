import { unwrap, type BaseClient, type Schemas } from "../index.ts";

/** A file to give a run: its name, its type and its bytes. */
export type FileUpload = {
  name: string;
  /** Its media type (default application/octet-stream). */
  type?: string;
  data: Blob | ArrayBuffer | Uint8Array;
};

/**
 * Uploads a file to give a run (docs: Files): its bytes as the body, not
 * JSON, which the generated client doesn't send on its own. Pass the
 * returned `id` as a file input.
 *
 *   const file = await uploadFile(api, { name: "adjustments.csv", type: "text/csv", data });
 *   await api.runs.create(slug, { inputs: { statement: file.id } });
 */
export async function uploadFile(
  client: BaseClient,
  file: FileUpload,
  options: { idempotencyKey?: string } = {},
): Promise<Schemas["File"]> {
  const body =
    file.data instanceof Blob
      ? file.data
      : new Blob([file.data as Uint8Array<ArrayBuffer>], {
          type: file.type ?? "application/octet-stream",
        });
  return unwrap(
    await client.POST("/files", {
      params: { query: { name: file.name } },
      body: body as unknown as string,
      bodySerializer: (value: unknown) => value as string,
      headers: {
        "content-type": file.type ?? (body.type || "application/octet-stream"),
        ...(options.idempotencyKey
          ? { "idempotency-key": options.idempotencyKey }
          : {}),
      },
    }),
  );
}
