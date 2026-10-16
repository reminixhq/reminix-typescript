# @reminix/sdk

The official TypeScript client for the Reminix API.

```bash
npm install @reminix/sdk
```

```ts
import { createClient } from "@reminix/sdk";

// The key from REMINIX_API_KEY, or pass { token }.
const reminix = createClient();
```

- Guide: https://reminix.com/docs/sdk/
- API reference: https://api.reminix.com/v1/docs

## Building from this repository

```bash
npm ci && npm test && npm run build
```

This repository is generated from Reminix's own repository on
each release; see CONTRIBUTING.md. Licensed under the Apache License 2.0.
