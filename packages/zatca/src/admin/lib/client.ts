import Medusa from "@medusajs/js-sdk";

/** Same-origin admin client — the dashboard session carries auth. */
export const sdk = new Medusa({
  baseUrl: typeof window !== "undefined" ? window.location.origin : "/",
  auth: {
    type: "session",
  },
});
