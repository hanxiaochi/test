"use strict";

const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const profiles = [
  { id: "cn-mainland-commercial", packs: "core-platform,cn-mainland" },
  { id: "fidic-international-commercial", packs: "core-platform,fidic-international" }
];

for (const profile of profiles) {
  const env = {
    ...process.env,
    APP_REGION_PROFILE_PATH: path.join(ROOT, "config", "region-profiles", `${profile.id}.json`),
    APP_REGION_TEST_PROFILE: profile.id
  };
  delete env.APP_REGION_PACKS;
  const result = spawnSync(process.execPath, [path.join(__dirname, "with-test-server.js"), "scripts/verify-region-profile.js"], {
    cwd: ROOT,
    env,
    stdio: "inherit"
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
