# Notification Engine API Notes

Date: 2026-06-12

## Scope

This S0 pass verifies the Medusa platform contracts that `medusa-plugin-notifications`
will use. `docs/prompts/notification-engine-codex.md` remains authoritative for the
implementation loop, architecture, test matrix, gates, and acceptance criteria.

## Sources Checked

- Medusa docs: Plugins
  <https://docs.medusajs.com/learn/fundamentals/plugins>
- Medusa docs: Loaders
  <https://docs.medusajs.com/learn/fundamentals/modules/loaders>
- Medusa docs: Events and Subscribers
  <https://docs.medusajs.com/learn/fundamentals/events-and-subscribers>
- Medusa docs: Notification module
  <https://docs.medusajs.com/resources/infrastructure-modules/notification>
- Medusa docs: API routes
  <https://docs.medusajs.com/learn/fundamentals/api-routes>
- Medusa docs: Admin pages
  <https://docs.medusajs.com/learn/fundamentals/admin-extensions/pages>
- Installed package declarations under `node_modules/@medusajs/*`

## Installed Medusa Version

The workspace resolves installed Medusa packages to `2.15.5` while root
development dependencies are declared as `^2.13.0`. The plugin should target the
declared project baseline and compile against the installed `2.15.5` API surface.

## Plugin Shape

Verified. A Medusa plugin can ship multiple customizations in one package:

- a custom module with models, migrations, service, and loaders
- API routes under `src/api`
- event subscribers under `src/subscribers`
- an admin UI extension under `src/admin`

This matches the runner's expected one-package architecture.

## Module And Self-Seed Hook

Verified. Module loaders are exported through the module definition and receive
`{ container, options }`. They run during application startup and migration flows.

Implementation rule for this plugin:

- use a module loader for lightweight, idempotent default-template seeding
- seed only missing defaults
- never overwrite edited rows
- do not require a host app seed script

## Container Keys

Verified from installed declarations and built-in Medusa code:

- resolve the notification module with `container.resolve(Modules.NOTIFICATION)`
- resolve Query with `container.resolve(ContainerRegistrationKeys.QUERY)`
- resolve Logger with `container.resolve(ContainerRegistrationKeys.LOGGER)`

`Modules.NOTIFICATION` resolves to the `notification` module key.

## Notification Creation Contract

Verified from installed declarations:

`NotificationTypes.CreateNotificationDTO` includes:

- `to: string`
- `channel: string`
- `template?: string | null`
- `data?: Record<string, unknown> | null`
- `provider_data?: Record<string, unknown> | null`
- `content?: NotificationTypes.NotificationContent | null`
- `idempotency_key?: string | null`

The module service exposes:

- `createNotifications(data: CreateNotificationDTO, sharedContext?)`
- `createNotifications(data: CreateNotificationDTO[], sharedContext?)`

Provider-level delivery DTOs require a `template: string`. Therefore the engine
must pass both the resolved template id and rendered `content.text` when creating
notifications.

## Event Names

Verified from installed `@medusajs/utils` event declarations:

- order placed: `order.placed`
- shipment created: `shipment.created`
- delivery created: `delivery.created`
- order canceled: `order.canceled`

The runner only requires order placement and shipped notifications. The closest
Medusa event for "shipped" is `shipment.created`; it is emitted by the built-in
create-shipment workflow with payload `{ id, no_notification }`, where `id` is
the fulfillment id. The subscriber must query the order through that fulfillment.

## Query Contract

Verified. Query is available from the container as
`ContainerRegistrationKeys.QUERY` and returns graph data with `query.graph`.
Subscriber implementations should query only the fields needed for rendering and
recipient resolution, and tests should mock this boundary.

## Admin Extension

Verified. Medusa admin extensions can add pages under `src/admin/routes`. The
installed admin SDK exposes `defineRouteConfig`, which supports Settings route
registration metadata. This supports the sanctioned Settings -> Notifications
editor.

## API Routes

Verified. Medusa plugins can ship API routes under `src/api`, auto-loaded by the
host application. Admin routes should live under `src/api/admin/...` and export
HTTP method handlers.

## Contradictions

None found. The verified Medusa docs and installed declarations support the
runner's architecture.
