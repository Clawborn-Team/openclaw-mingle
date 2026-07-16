#!/usr/bin/env node

import { installMingle, parseInstallerArgs } from "../dist/src/installer.js";

try {
  const options = parseInstallerArgs(process.argv.slice(2));
  console.log("Installing and configuring the Mingle channel for OpenClaw…");
  await installMingle(options);
  console.log("Mingle is connected. The OpenClaw Gateway has been restarted.");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
