/**
 * Secret redaction for log lines, error messages, and any string that may be
 * surfaced to a developer or a log sink.
 *
 * This is the single sanctioned way to scrub secrets out of text before it
 * leaves the process (CONTRACT.md "Outbound HTTP" / "Errors"). The HTTP client
 * redacts at its boundary using this helper; connectors must never hand-roll
 * their own masking.
 *
 * String secrets are matched as a **literal substring** replacement (not a
 * regex), so secrets containing regex-special characters — `+`, `.`, `?`, `$`,
 * parentheses, etc., all common in API keys and base64 — are handled correctly
 * and can never be interpreted as a pattern. A `RegExp` needle is also accepted
 * for structural secrets (e.g. a `Bearer \S+` header shape) and is applied
 * globally.
 */

/** The token substituted in place of every redacted secret. */
const MASK = "***";

/** A secret to scrub: a literal string, a pattern, or an ignored `undefined`. */
export type RedactNeedle = string | RegExp | undefined;

/**
 * Replace every occurrence of each non-empty secret in `input` with `"***"`.
 *
 * - `undefined` and empty-string secrets are ignored (an empty needle would
 *   otherwise match between every character).
 * - String matching is literal and global: every occurrence of every secret is
 *   masked. Longer secrets are masked before shorter ones, so a secret that
 *   contains another secret as a substring is fully replaced rather than
 *   partially shredded into `***` fragments.
 * - `RegExp` needles are applied globally (the `g` flag is added if missing).
 *
 * @param input   the text to scrub
 * @param secrets the secret values/patterns to remove; `undefined`/empty entries are skipped
 * @returns the input with every secret occurrence replaced by `"***"`
 */
export function redactSecrets(
  input: string,
  secrets: RedactNeedle[],
): string {
  // Keep only real string secrets, de-duplicate, and mask longest-first so that
  // a secret which is a substring of another does not leave a partial leak.
  const stringNeedles = Array.from(
    new Set(
      secrets.filter(
        (s): s is string => typeof s === "string" && s.length > 0,
      ),
    ),
  ).sort((a, b) => b.length - a.length);

  const patternNeedles = secrets.filter(
    (s): s is RegExp => s instanceof RegExp,
  );

  let output = input;
  for (const secret of stringNeedles) {
    // split/join performs a literal global replace with no regex semantics.
    output = output.split(secret).join(MASK);
  }
  for (const pattern of patternNeedles) {
    const global = pattern.flags.includes("g")
      ? pattern
      : new RegExp(pattern.source, `${pattern.flags}g`);
    output = output.replace(global, MASK);
  }
  return output;
}
