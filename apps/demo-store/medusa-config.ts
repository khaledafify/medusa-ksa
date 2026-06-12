import { loadEnv, defineConfig } from "@medusajs/framework/utils"

loadEnv(process.env.NODE_ENV || "development", process.cwd())

export default defineConfig({
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
    redisUrl: process.env.REDIS_URL,
    http: {
      storeCors: process.env.STORE_CORS!,
      adminCors: process.env.ADMIN_CORS!,
      authCors: process.env.AUTH_CORS!,
      jwtSecret: process.env.JWT_SECRET || "supersecret",
      cookieSecret: process.env.COOKIE_SECRET || "supersecret",
    },
  },
  plugins: [
    {
      // ZATCA e-invoicing (custom module + workflows + admin wizard).
      // Non-secret bootstrap only — EGS credentials are generated through
      // onboarding and stored encrypted, never in env (SPEC §6).
      resolve: "medusa-plugin-zatca",
      options: {
        environment: process.env.ZATCA_ENV ?? "sandbox",
        encryptionKey: process.env.ZATCA_ENCRYPTION_KEY,
        trigger: process.env.ZATCA_TRIGGER ?? "payment_captured",
      },
    },
    {
      // Provider-agnostic order notification engine. Delivery is handled by
      // whichever sms transport provider is registered in the Notification module.
      resolve: "medusa-plugin-notifications",
      options: {},
    },
  ],
  modules: [
    {
      // Re-declare the Payment module to register the Moyasar provider.
      // The hosted-redirect default needs only MOYASAR_SECRET_KEY (read from
      // env by the provider's core loader — no options block required).
      resolve: "@medusajs/medusa/payment",
      options: {
        providers: [
          {
            resolve: "medusa-payment-moyasar/providers/moyasar",
            id: "moyasar",
          },
        ],
      },
    },
    {
      // Re-declare the Fulfillment module to register the Torod aggregator.
      // Credentials are read env-first by the provider's core-backed option resolver.
      resolve: "@medusajs/medusa/fulfillment",
      options: {
        providers: [
          {
            resolve: "medusa-fulfillment-torod/providers/torod",
            id: "torod",
          },
        ],
      },
    },
    {
      // Re-declare the Notification module to register Unifonic for SMS.
      // AppSid and Sender ID are read env-first by the provider.
      resolve: "@medusajs/medusa/notification",
      options: {
        providers: [
          {
            resolve: "medusa-notification-unifonic/providers/unifonic",
            id: "unifonic",
            options: {
              channels: ["sms"],
            },
          },
        ],
      },
    },
  ],
})
