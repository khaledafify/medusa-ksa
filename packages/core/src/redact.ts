/**
 * Secret redaction for log lines, error messages, and any string that may be
 * surfaced to a developer or a log sink.
 *
 * This is the single sanctioned way to scrub secrets out of text before it
 * leaves the process (CONTRACT.md "Outbound HTTP" / "Errors"). The HTTP client
 * redacts at its boundary using this helper; connectors must never hand-roll
 * their own masking.
 *
 * The match is a **literal substring** replacement (not a regex), so secrets
 * containing regex-special characters — `+`, `.`, `?`, `$`, parentheses, etc.,
 * all common in API keys and base64 — are handled correctly and can never be
 * interpreted as a pattern.
 */

/** The token substituted in place of every redacted secret. */
const MASK = "***";

/**
 * Replace every occurrence of each non-empty secret in `input` with `"***"`.
 *
 * - `undefined` and empty-string secrets are ignored (an empty needle would
 *   otherwise match between every character).
 * - Matching is literal and global: every occurrence of every secret is masked.
 * - Longer secrets are masked before shorter ones, so a secret that contains
 *   another secret as a substring is fully replaced rather than partially
 *   shredded into `***` fragments.
 *
 * @param input   the text to scrub
 * @param secrets the secret values to remove; `undefined`/empty entries are skipped
 * @returns the input with every secret occurrence replaced by `"***"`
 */
export function redactSecrets(
  input: string,
  secrets: (string | undefined)[],
): string {
  // Keep only real secrets, de-duplicate, and mask longest-first so that a
  // secret which is a substring of another does not leave a partial leak.
  const needles = Array.from(
    new Set(
      secrets.filter(
        (s): s is string => typeof s === "string" && s.length > 0,
      ),
    ),
  ).sort((a, b) => b.length - a.length);

  let output = input;
  for (const secret of needles) {
    // split/join performs a literal global replace with no regex semantics.
    output = output.split(secret).join(MASK);
  }
  return output;
}
