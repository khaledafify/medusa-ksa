import Handlebars from "handlebars";

import { CURRENCY, HELPERS, LIMITS, LOCALES, WARNINGS } from "../constants";

/** Structured value accepted by notification render contexts. */
export type RenderValue =
  | string
  | number
  | boolean
  | Date
  | null
  | undefined
  | RenderValue[]
  | RenderRecord;

/** Object shape accepted by Handlebars templates. */
export interface RenderRecord {
  [key: string]: RenderValue;
}

/** SMS segment analysis returned with every render. */
export interface SmsSegmentAnalysis {
  encoding: "gsm" | "unicode";
  length: number;
  segments: number;
  perSegment: number;
}

/** Non-fatal render warning. */
export interface NotificationRenderWarning {
  code: (typeof WARNINGS)[keyof typeof WARNINGS];
  message: string;
  segments: SmsSegmentAnalysis;
}

/** Input for rendering a stored template body. */
export interface RenderTemplateInput {
  templateId: string;
  body: string;
  context: RenderRecord;
}

/** Rendered SMS body plus length metadata. */
export interface RenderTemplateResult {
  templateId: string;
  text: string;
  segments: SmsSegmentAnalysis;
  warnings: NotificationRenderWarning[];
}

const CONTROL_START = 0x00;
const CONTROL_END = 0x1f;
const DELETE_CONTROL = 0x7f;
const C1_CONTROL_START = 0x80;
const C1_CONTROL_END = 0x9f;
const BIDI_OVERRIDE_START = 0x202a;
const BIDI_OVERRIDE_END = 0x202e;
const BIDI_ISOLATE_START = 0x2066;
const BIDI_ISOLATE_END = 0x2069;

const DANGEROUS_CONTEXT_KEYS = new Set([
  "__proto__",
  "prototype",
  "constructor",
]);

const HANDLEBARS_RUNTIME_OPTIONS = {
  allowProtoMethodsByDefault: false,
  allowProtoPropertiesByDefault: false,
} as const;

/** Strip SMS-unsafe control and bidi override characters, then cap length. */
export function sanitizeText(
  value: unknown,
  maxLength: number = LIMITS.SMS_MAX_LEN,
): string {
  return stripUnsafeText(value).slice(0, maxLength);
}

function stripUnsafeText(value: unknown): string {
  return Array.from(stringifyScalar(value))
    .filter((character) => !isUnsafeCodePoint(character.codePointAt(0) ?? 0))
    .join("");
}

function stringifyScalar(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return "";
}

function isUnsafeCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= CONTROL_START && codePoint <= CONTROL_END) ||
    codePoint === DELETE_CONTROL ||
    (codePoint >= C1_CONTROL_START && codePoint <= C1_CONTROL_END) ||
    (codePoint >= BIDI_OVERRIDE_START && codePoint <= BIDI_OVERRIDE_END) ||
    (codePoint >= BIDI_ISOLATE_START && codePoint <= BIDI_ISOLATE_END)
  );
}

/** Recursively sanitize all string values before template interpolation. */
export function sanitizeRenderValue(value: RenderValue): RenderValue {
  if (typeof value === "string") {
    return sanitizeText(value);
  }
  if (
    value === null ||
    value === undefined ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value instanceof Date
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeRenderValue(item));
  }

  const output: RenderRecord = {};
  for (const key of Object.keys(value)) {
    if (DANGEROUS_CONTEXT_KEYS.has(key)) {
      continue;
    }
    const item = value[key];
    output[key] = sanitizeRenderValue(item);
  }
  return output;
}

/** Convert halalas to a fixed two-decimal SAR string. */
export function formatSar(value: unknown): string {
  const numeric =
    typeof value === "number" ? value : Number.parseFloat(stringifyScalar(value));
  const halalas = Number.isFinite(numeric) ? numeric : 0;
  return `${(halalas / 100).toFixed(2)} ${CURRENCY.SAR}`;
}

/** Format date-like input as a stable Gregorian date. */
export function formatDate(value: unknown): string {
  const date = value instanceof Date ? value : new Date(stringifyScalar(value));
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toISOString().slice(0, 10);
}

/** Select an Arabic pluralized phrase from explicit category strings. */
export function pluralizeAr(
  value: unknown,
  zero: unknown,
  one: unknown,
  two: unknown,
  few: unknown,
  many: unknown,
  other: unknown,
): string {
  const count =
    typeof value === "number" ? value : Number.parseFloat(stringifyScalar(value));
  const category = new Intl.PluralRules(LOCALES.AR).select(
    Number.isFinite(count) ? count : 0,
  );
  const choices = {
    zero,
    one,
    two,
    few,
    many,
    other,
  } satisfies Record<Intl.LDMLPluralRule, unknown>;
  return sanitizeText(choices[category]);
}

/** Analyze rendered SMS text for GSM/Unicode segment count. */
export function analyzeSmsSegments(text: string): SmsSegmentAnalysis {
  const length = Array.from(text).length;
  const encoding = Array.from(text).some(
    (character) => character.charCodeAt(0) > 127,
  )
    ? "unicode"
    : "gsm";
  const singleLimit =
    encoding === "unicode"
      ? LIMITS.UNICODE_SINGLE_SEGMENT
      : LIMITS.GSM_SINGLE_SEGMENT;
  const multiLimit =
    encoding === "unicode"
      ? LIMITS.UNICODE_MULTI_SEGMENT
      : LIMITS.GSM_MULTI_SEGMENT;
  const perSegment = length <= singleLimit ? singleLimit : multiLimit;
  return {
    encoding,
    length,
    perSegment,
    segments: Math.max(1, Math.ceil(length / perSegment)),
  };
}

/** Handlebars renderer with a compile cache and a fixed helper whitelist. */
export class NotificationRenderEngine {
  private readonly handlebars = Handlebars.create();
  private readonly cache = new Map<
    string,
    Handlebars.TemplateDelegate<RenderRecord>
  >();

  constructor() {
    this.handlebars.registerHelper(HELPERS.FORMAT_SAR, (value: unknown) =>
      formatSar(value),
    );
    this.handlebars.registerHelper(HELPERS.FORMAT_DATE, (value: unknown) =>
      formatDate(value),
    );
    this.handlebars.registerHelper(
      HELPERS.PLURALIZE_AR,
      (
        value: unknown,
        zero: unknown,
        one: unknown,
        two: unknown,
        few: unknown,
        many: unknown,
        other: unknown,
      ) => pluralizeAr(value, zero, one, two, few, many, other),
    );
  }

  /** Render a stored template body into SMS-safe plain text. */
  render(input: RenderTemplateInput): RenderTemplateResult {
    const compiled = this.compile(stripUnsafeText(input.body));
    const context = sanitizeRenderValue(input.context) as RenderRecord;
    const rawText = compiled(context, HANDLEBARS_RUNTIME_OPTIONS);
    const strippedText = stripUnsafeText(rawText);
    const text = sanitizeText(strippedText);
    const segments = analyzeSmsSegments(text);
    const warnings =
      strippedText.length > LIMITS.SMS_MAX_LEN || segments.segments > 1
        ? [
            {
              code: WARNINGS.SMS_SEGMENTS,
              message: `Rendered SMS uses ${segments.segments} segments.`,
              segments,
            },
          ]
        : [];
    return {
      templateId: input.templateId,
      text,
      segments,
      warnings,
    };
  }

  private compile(body: string): Handlebars.TemplateDelegate<RenderRecord> {
    const cached = this.cache.get(body);
    if (cached) {
      return cached;
    }
    const compiled = this.handlebars.compile<RenderRecord>(body, {
      noEscape: true,
      strict: false,
      assumeObjects: false,
    });
    this.cache.set(body, compiled);
    return compiled;
  }
}

/** Render a stored template body with the default notification renderer. */
export function renderNotificationTemplate(
  input: RenderTemplateInput,
): RenderTemplateResult {
  return new NotificationRenderEngine().render(input);
}
