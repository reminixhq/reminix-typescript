# @reminix/sdk

The Reminix TypeScript SDK runs your team's published scripts from your code: one call starts a run, waits for it however long it takes, handles approvals and files, and gives you the result. Every API operation is a typed method too.

Reminix lets your whole team, your software and your agents run your team's scripts, and the ones AI writes: one publish gives a form, an API and an agent tool, with keys kept out of the code and every run on record.

## Install

```bash
npm install @reminix/sdk
```

Set `REMINIX_API_KEY` to a key from **API keys** in the app.

## Publish a script

Scripts are published with the Reminix CLI. In the script's folder:

```bash
npm install -g @reminix/cli
reminix login
reminix publish
```

Reminix works out how the script runs from the folder. Inputs, drafts
and publishing several scripts at once are in the
[CLI guide](https://reminix.com/docs/cli/).

## Run a script

`run` runs a published script and gives you its result in one call,
however long it takes:

```ts
import { createClient } from "@reminix/sdk";

const reminix = createClient(); // reads REMINIX_API_KEY

const run = await reminix.run("monthly-report", { month: "2026-09" });
console.log(run.output);
```

- A run that needs a person's approval waits for them. Pass
  `onApproval` to show them where to approve it.
- A run that fails, or whose approval is turned down, throws a
  `RunError` with the run's status and error.
- To make calling again safe, such as from a job that reruns, pass
  `{ idempotencyKey }`: the same key and inputs answer with the first
  run instead of starting another.

## Files in and out

Give a file input as a `Blob`, a `File`, or `{ name, type, data }`; the
SDK uploads it first. The files a run writes come back with a download
link:

```ts
import { readFile } from "node:fs/promises";
import { createClient } from "@reminix/sdk";

const reminix = createClient();

const run = await reminix.run("monthly-report", {
  month: "2026-09",
  adjustments: {
    name: "adjustments.csv",
    type: "text/csv",
    data: await readFile("adjustments.csv"),
  },
});
for (const file of run.files ?? []) {
  if (file.direction === "out") console.log(file.name, file.downloadUrl);
}
```

## Everything else

Every API operation is a typed method, named like its CLI command:
`reminix runs list` is `reminix.runs.list()`. A failure throws an
`ApiError` with the error's `code`, `message`, `status` and
`requestId`.

## Links

- [Website](https://reminix.com)
- [TypeScript SDK guide](https://reminix.com/docs/typescript/)
- [API reference](https://reminix.com/docs/reference/)
- [Changelog](https://github.com/reminixhq/reminix-typescript/blob/main/CHANGELOG.md)
- [Discord](https://reminix.com/discord)
- [Report a security issue](https://reminix.com/security/)

## About this package

This repository is generated from Reminix's source on each
release, so pull requests are ported there and credited (see
[CONTRIBUTING.md](https://github.com/reminixhq/reminix-typescript/blob/main/CONTRIBUTING.md)).
Licensed under the Apache License 2.0.
