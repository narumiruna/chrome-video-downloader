#!/usr/bin/env node

import { runMergeCli } from "../src/local/merge-cli";

const controller = new AbortController();
process.once("SIGINT", () => controller.abort());
process.once("SIGTERM", () => controller.abort());

process.exitCode = await runMergeCli(
  process.argv.slice(2),
  {
    error: (message) => console.error(message),
    log: (message) => console.log(message),
  },
  { signal: controller.signal },
);
