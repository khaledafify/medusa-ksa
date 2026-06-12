import { spawnSync } from "node:child_process";

const LIVE_E2E_ENV = "MEDUSA_NOTIFICATIONS_LIVE_E2E";
const LIVE_E2E_ENABLED = "1";
const UNIFONIC_APP_SID_ENV = "UNIFONIC_APP_SID";
const UNIFONIC_SENDER_ID_ENV = "UNIFONIC_SENDER_ID";
const UNIFONIC_TEST_RECIPIENT_ENV = "UNIFONIC_TEST_RECIPIENT";
const EXECUTABLE = "medusa";
const EXEC_ARGS = ["exec", "./src/scripts/e2e-notifications.ts"];

function skip(reason) {
  console.log(`notifications live e2e skipped: ${reason}`);
  process.exit(0);
}

if (process.env[LIVE_E2E_ENV] !== LIVE_E2E_ENABLED) {
  skip(`${LIVE_E2E_ENV} is not enabled`);
}

for (const name of [
  UNIFONIC_APP_SID_ENV,
  UNIFONIC_SENDER_ID_ENV,
  UNIFONIC_TEST_RECIPIENT_ENV,
]) {
  if (!process.env[name]) {
    skip(`${name} is missing`);
  }
}

const result = spawnSync(EXECUTABLE, EXEC_ARGS, {
  env: process.env,
  stdio: "inherit",
});

if (result.error) {
  console.error(`notifications live e2e failed to start: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
