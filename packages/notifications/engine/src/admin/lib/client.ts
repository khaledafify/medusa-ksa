import Medusa from "@medusajs/js-sdk";

/** Session-authenticated Medusa Admin SDK client for notification settings. */
export const sdk = new Medusa({
  baseUrl: typeof window !== "undefined" ? window.location.origin : "/",
  auth: {
    type: "session",
  },
});
