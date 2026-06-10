import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

import { KsaError, KsaErrorCodes } from "./errors.js";

/**
 * Secret encryption at rest — AES-256-GCM.
 *
 * Used for credentials persisted in the DB (e.g. the ZATCA `ZatcaCredential`).
 * The encryption key comes from a `*_ENCRYPTION_KEY` env var and is validated
 * for length here (see CONTRACT.md "Secrets at rest").
 *
 * Wire format (all binary, then base64-encoded as one string):
 *
 *   base64( iv | authTag | ciphertext )
 *      12 bytes ^   16 bytes ^  N bytes
 *
 * Plaintext is never logged and never surfaced from an API route. Error
 * messages never echo the key or the payload.
 */

const PREFIX = "secrets";

/** AES-256 requires a 32-byte key. */
const KEY_BYTES = 32;
/** Recommended GCM nonce size. */
const IV_BYTES = 12;
/** GCM authentication tag size. */
const TAG_BYTES = 16;

const ALGORITHM = "aes-256-gcm";

/**
 * Copy a byte view into a `Uint8Array` that is unambiguously backed by a plain
 * `ArrayBuffer`.
 *
 * `node:crypto` (under recent `@types/node` + TS 5.7+) types its key / iv /
 * data arguments as `Uint8Array<ArrayBuffer>`, whereas `Buffer` is typed as
 * `Buffer<ArrayBufferLike>` (its backing buffer may, in theory, be a
 * `SharedArrayBuffer`). This bridges the gap without an `as`-cast.
 */
function view(buf: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(buf);
}

/**
 * Normalize the caller-supplied key to a 32-byte Buffer.
 *
 * Accepts either:
 *  - a raw 32-byte `Buffer`, or
 *  - a base64-encoded string that decodes to exactly 32 bytes.
 *
 * Throws a `KsaError` (code `INVALID_ENCRYPTION_KEY`) otherwise — never
 * silently truncates or pads, which would weaken the cipher.
 */
function coerceKey(key: Buffer | string): Buffer {
  let raw: Buffer;

  if (typeof key === "string") {
    // A 32-byte key encodes to 44 base64 characters; decoding a string of the
    // wrong length yields a Buffer of the wrong length, which we reject below.
    raw = Buffer.from(key, "base64");
  } else {
    raw = key;
  }

  if (raw.length !== KEY_BYTES) {
    throw new KsaError(
      `encryption key must be ${KEY_BYTES} bytes ` +
        `(raw Buffer or base64 string), received ${raw.length} bytes. ` +
        `Generate one with: openssl rand -base64 32`,
      { prefix: PREFIX, code: KsaErrorCodes.INVALID_ENCRYPTION_KEY },
    );
  }

  return raw;
}

/**
 * Encrypt `plaintext` with AES-256-GCM under `key`.
 *
 * @param plaintext UTF-8 string to protect.
 * @param key       32-byte raw `Buffer` or base64 string decoding to 32 bytes.
 * @returns base64 of `iv | authTag | ciphertext`.
 * @throws KsaError when the key is not 32 bytes.
 */
export function encrypt(plaintext: string, key: Buffer | string): string {
  const keyBuf = coerceKey(key);
  const iv = randomBytes(IV_BYTES);

  const cipher = createCipheriv(ALGORITHM, view(keyBuf), view(iv));
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([iv, authTag, ciphertext]).toString("base64");
}

/**
 * Decrypt a payload produced by {@link encrypt}.
 *
 * @param payload base64 of `iv | authTag | ciphertext`.
 * @param key     32-byte raw `Buffer` or base64 string decoding to 32 bytes.
 * @returns the original UTF-8 plaintext.
 * @throws KsaError when the key is the wrong length, the payload is malformed,
 *         or authentication fails (wrong key / tampered data).
 */
export function decrypt(payload: string, key: Buffer | string): string {
  const keyBuf = coerceKey(key);

  const data = Buffer.from(payload, "base64");
  if (data.length < IV_BYTES + TAG_BYTES) {
    throw new KsaError(
      "encrypted payload is too short to contain iv and auth tag",
      { prefix: PREFIX, code: KsaErrorCodes.DECRYPTION_FAILED },
    );
  }

  const iv = data.subarray(0, IV_BYTES);
  const authTag = data.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = data.subarray(IV_BYTES + TAG_BYTES);

  const decipher = createDecipheriv(ALGORITHM, view(keyBuf), view(iv));
  decipher.setAuthTag(view(authTag));

  try {
    return Buffer.concat([
      decipher.update(view(ciphertext)),
      decipher.final(),
    ]).toString("utf8");
  } catch (cause) {
    // GCM `final()` throws when the auth tag does not verify — i.e. the key is
    // wrong or the ciphertext/iv/tag was tampered with. We never echo the
    // payload or key in the message.
    throw new KsaError(
      "failed to decrypt payload: wrong key or tampered data",
      { prefix: PREFIX, code: KsaErrorCodes.DECRYPTION_FAILED, cause },
    );
  }
}

/**
 * Namespace mirror of the secret primitives, matching the
 * `secrets.encrypt` / `secrets.decrypt` surface in CONTRACT.md. The bare
 * {@link encrypt} / {@link decrypt} named exports remain available.
 */
export const secrets = { encrypt, decrypt } as const;
