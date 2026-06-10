# Verification Plan

Run after every fix phase:

```bash
pnpm --filter @medusa-ksa/core test
pnpm --filter @medusa-ksa/core typecheck
pnpm --filter @medusa-ksa/core build
pnpm lint
```

Before final sign-off, also run these adversarial probes manually or encode them as tests:

```bash
node --input-type=module <<'EOF'
import { createHmac } from "node:crypto";
import {
  HttpClient,
  KsaErrorCodes,
  decrypt,
  encrypt,
  redactSecrets,
  sarToHalalas,
  secrets,
  verifyWebhook,
} from "./packages/core/dist/index.js";

const checks = [];

checks.push(["secrets namespace", typeof secrets?.encrypt === "function" && typeof secrets?.decrypt === "function"]);

try {
  new HttpClient({ baseUrl: "https://api.example.test", timeoutMs: Number.NaN });
  checks.push(["reject NaN timeout", false]);
} catch {
  checks.push(["reject NaN timeout", true]);
}

try {
  new HttpClient({
    baseUrl: "https://api.example.test",
    timeoutMs: 1000,
    retry: { retries: Number.POSITIVE_INFINITY, baseDelayMs: 0 },
  });
  checks.push(["reject infinite retries", false]);
} catch {
  checks.push(["reject infinite retries", true]);
}

try {
  sarToHalalas(Number.MAX_SAFE_INTEGER / 100 + 1);
  checks.push(["reject unsafe halalas", false]);
} catch {
  checks.push(["reject unsafe halalas", true]);
}

const key = Buffer.alloc(32, 1);
try {
  decrypt(encrypt("secret", key), Buffer.alloc(32, 2));
  checks.push(["decrypt wrong key fails", false]);
} catch (err) {
  checks.push(["decrypt public code", err.code === KsaErrorCodes.DECRYPTION_FAILED]);
}

const redacted = redactSecrets("provider echoed sk_live_TOKEN", ["Bearer sk_live_TOKEN", "sk_live_TOKEN"]);
checks.push(["redact bare bearer token", !redacted.includes("sk_live_TOKEN")]);

const body = JSON.stringify({ id: "evt_old" });
const sig = createHmac("sha256", "whsec").update(body).digest("hex");
checks.push([
  "tolerance without timestamp rejected",
  verifyWebhook(body, sig, "whsec", { toleranceSec: 300, now: 1_700_000_000 }) === false,
]);

console.log(checks);
if (checks.some(([, ok]) => !ok)) process.exit(1);
EOF
```

Final acceptance:

- All gates pass.
- Every item in `SECURITY-FIXES.md` is either fixed or explicitly documented as intentionally deferred with a reason.
- Every missing/weak test in `TEST-GAPS.md` is either implemented or intentionally rewritten with a stronger equivalent.
- `packages/core/CONTRACT.md` and generated `dist/*.d.ts` agree on exported runtime symbols and public types.
