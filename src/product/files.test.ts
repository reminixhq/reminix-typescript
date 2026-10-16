import { describe, expect, it } from "vitest";

import { ApiError, createClient } from "../index.ts";
import { uploadFile } from "./index.ts";

describe("uploadFile", () => {
  it("sends the bytes as the body, with the name and type", async () => {
    const requests: Request[] = [];
    const api = createClient({
      token: "sk_x",
      api: "https://api.example.test",
      fetch: async (request) => {
        requests.push(request);
        return Response.json(
          { id: "file_1", name: "sept.csv" },
          { status: 201 },
        );
      },
    });
    const file = await uploadFile(api, {
      name: "sept.csv",
      type: "text/csv",
      data: new TextEncoder().encode("a,b\n1,2\n"),
    });
    expect(file).toMatchObject({ id: "file_1" });
    const sent = requests[0];
    expect(sent.method).toBe("POST");
    expect(sent.url).toBe("https://api.example.test/v1/files?name=sept.csv");
    expect(sent.headers.get("content-type")).toBe("text/csv");
    expect(await sent.text()).toBe("a,b\n1,2\n");
  });

  it("throws the API's error", async () => {
    const api = createClient({
      token: "sk_x",
      fetch: async () =>
        Response.json(
          { error: { code: "invalid_request", message: "The file is empty" } },
          { status: 400 },
        ),
    });
    await expect(
      uploadFile(api, { name: "x", data: new Uint8Array() }),
    ).rejects.toBeInstanceOf(ApiError);
  });
});
