import type { ExecArgs } from "@medusajs/framework/types";
import {
  ContainerRegistrationKeys,
  Modules,
} from "@medusajs/framework/utils";
import {
  CHANNEL,
  EVENTS,
  buildIdempotencyKey,
} from "medusa-plugin-notifications/modules/notifications";

const LIVE_E2E_ENV = "MEDUSA_NOTIFICATIONS_LIVE_E2E";
const LIVE_E2E_ENABLED = "1";
const UNIFONIC_APP_SID_ENV = "UNIFONIC_APP_SID";
const UNIFONIC_SENDER_ID_ENV = "UNIFONIC_SENDER_ID";
const UNIFONIC_TEST_RECIPIENT_ENV = "UNIFONIC_TEST_RECIPIENT";
const ORDER_QUERY_ENTITY = "notification";
const TEST_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 1_000;

interface DemoOrder {
  id: string;
  display_id?: string | number | null;
}

interface OrderModule {
  createOrders(input: Record<string, unknown>): Promise<DemoOrder>;
}

interface EventBusModule {
  emit<TData>(data: {
    name: string;
    data: TData;
  }): Promise<void>;
}

interface QueryService {
  graph(input: {
    entity: string;
    fields: string[];
    filters: Record<string, unknown>;
  }): Promise<{ data: NotificationRow[] }>;
}

interface NotificationRow {
  id: string;
  to: string;
  channel: string;
  template: string | null;
  trigger_type: string | null;
  resource_id: string | null;
  idempotency_key: string | null;
  external_id: string | null;
  status: string;
}

type SkipCheck =
  | { shouldRun: true; recipient: string }
  | { shouldRun: false; reason: string };

function liveE2eCheck(env: NodeJS.ProcessEnv): SkipCheck {
  if (env[LIVE_E2E_ENV] !== LIVE_E2E_ENABLED) {
    return { shouldRun: false, reason: `${LIVE_E2E_ENV} is not enabled` };
  }

  for (const name of [
    UNIFONIC_APP_SID_ENV,
    UNIFONIC_SENDER_ID_ENV,
    UNIFONIC_TEST_RECIPIENT_ENV,
  ]) {
    if (!env[name]) {
      return { shouldRun: false, reason: `${name} is missing` };
    }
  }

  const recipient = env[UNIFONIC_TEST_RECIPIENT_ENV];
  if (!recipient) {
    return { shouldRun: false, reason: `${UNIFONIC_TEST_RECIPIENT_ENV} is missing` };
  }

  return { shouldRun: true, recipient };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function findNotification(
  query: QueryService,
  idempotencyKey: string,
): Promise<NotificationRow | null> {
  const { data } = await query.graph({
    entity: ORDER_QUERY_ENTITY,
    fields: [
      "id",
      "to",
      "channel",
      "template",
      "trigger_type",
      "resource_id",
      "idempotency_key",
      "external_id",
      "status",
    ],
    filters: { idempotency_key: idempotencyKey },
  });

  return data[0] ?? null;
}

async function waitForNotification(
  query: QueryService,
  idempotencyKey: string,
): Promise<NotificationRow> {
  const deadline = Date.now() + TEST_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const notification = await findNotification(query, idempotencyKey);
    if (notification) {
      return notification;
    }
    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error(`notification not found for ${idempotencyKey}`);
}

export default async function e2eNotifications({ container }: ExecArgs) {
  const check = liveE2eCheck(process.env);
  if (!check.shouldRun) {
    console.log(`notifications live e2e skipped: ${check.reason}`);
    return;
  }

  const orderModule = container.resolve(Modules.ORDER) as OrderModule;
  const eventBus = container.resolve(Modules.EVENT_BUS) as EventBusModule;
  const query = container.resolve(ContainerRegistrationKeys.QUERY) as QueryService;
  const suffix = Date.now().toString(36);

  const order = await orderModule.createOrders({
    currency_code: "sar",
    email: `notifications-${suffix}@example.com`,
    customer: {
      first_name: "Khaled",
      last_name: "Afify",
      phone: check.recipient,
      email: `notifications-${suffix}@example.com`,
    },
    shipping_address: {
      first_name: "سارة",
      last_name: "العلي",
      address_1: "Riyadh",
      city: "Riyadh",
      country_code: "sa",
      phone: check.recipient,
    },
    items: [
      {
        title: "Notifications live e2e item",
        quantity: 1,
        unit_price: 12.5,
      },
    ],
    metadata: {
      medusa_ksa_notifications_live_e2e: true,
      suffix,
    },
  });

  await eventBus.emit({
    name: EVENTS.ORDER_PLACED,
    data: { id: order.id },
  });

  const idempotencyKey = buildIdempotencyKey(EVENTS.ORDER_PLACED, order.id);
  const notification = await waitForNotification(query, idempotencyKey);

  if (notification.channel !== CHANNEL) {
    throw new Error(`expected ${CHANNEL} channel, got ${notification.channel}`);
  }
  if (notification.to !== check.recipient) {
    throw new Error(`expected recipient ${check.recipient}, got ${notification.to}`);
  }
  if (notification.resource_id !== order.id) {
    throw new Error(`expected resource_id ${order.id}, got ${notification.resource_id}`);
  }
  if (notification.trigger_type !== EVENTS.ORDER_PLACED) {
    throw new Error(
      `expected trigger_type ${EVENTS.ORDER_PLACED}, got ${notification.trigger_type}`,
    );
  }
  if (notification.idempotency_key !== idempotencyKey) {
    throw new Error("notification idempotency key mismatch");
  }
  if (!notification.template) {
    throw new Error("notification template id was not persisted");
  }
  if (!notification.external_id) {
    throw new Error("notification provider did not return an external id");
  }

  console.log(
    `notifications live e2e passed: order=${order.id} notification=${notification.id} external=${notification.external_id}`,
  );
}
