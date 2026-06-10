/**
 * Sandbox (test) vs live (production) mode is **inferred** from a provider key,
 * never configured with a `mode` flag (CLAUDE.md §7.4, CONTRACT.md "Environment & mode").
 *
 * Most KSA gateways follow the same convention as Stripe-style keys: a `test`
 * segment delimited by underscores (`sk_test_…`, `pk_test_…`) marks sandbox, and
 * a `live` segment (`sk_live_…`) marks production. We detect the `test` marker
 * conservatively — an isolated, underscore-delimited `test` token — so that a key
 * that merely happens to contain the substring "test" (e.g. a merchant id like
 * `contestant_42`) is not misread as sandbox.
 */

/** Matches `test` as a standalone underscore-delimited segment: `_test_`, leading `test_`, or trailing `_test`. */
const TEST_SEGMENT = /(?:^|_)test(?:_|$)/i;

/**
 * Returns `true` when `key` denotes a sandbox/test-mode credential.
 *
 * A key is sandbox when it contains `test` as an underscore-delimited segment
 * (e.g. `sk_test_abc`, `pk_test_abc`, or a bare `test_abc` / `abc_test`). Any other
 * non-empty key — including `sk_live_…` — is treated as live.
 *
 * Empty or whitespace-only input is treated as **not** sandbox: an absent key is a
 * configuration problem for the loader to reject, not something to silently route to
 * the test environment.
 */
export function detectSandbox(key: string): boolean {
  if (typeof key !== "string") {
    return false;
  }
  const trimmed = key.trim();
  if (trimmed.length === 0) {
    return false;
  }
  return TEST_SEGMENT.test(trimmed);
}
