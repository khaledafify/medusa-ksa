# Unifonic API Notes

S0 verification completed on 2026-06-12 against Unifonic's public documentation.

## Chosen API generation

Use the classic Unifonic REST SMS endpoint, not the NextGen Basic Auth / JSON API.

- Base URL: `https://el.cloud.unifonic.com`
- Endpoint: `POST /rest/SMS/messages`
- Content type: `application/x-www-form-urlencoded`
- Accept: `application/json`

Source: Unifonic's "Sending Your First SMS via Unifonic API" page states that the URL is `https://el.cloud.unifonic.com/rest/SMS/messages` and the method is `POST`.

## Authentication

Authentication is request-field based:

- `AppSid`: the application authentication string.

There is no HTTP Authorization header for this classic endpoint. `AppSid` is a secret and must be redacted from every error path.

## Request fields

Required for v1:

- `AppSid`: Unifonic application id / secret.
- `SenderID`: registered sender id. The docs say Unifonic can fall back to an account default when omitted, but this package intentionally requires an explicit default `UNIFONIC_SENDER_ID` or per-message `notification.from` per PRD/ADR-0014.
- `Body`: already-rendered notification text. Unifonic documents English and Unicode character support, including Arabic.
- `Recipient`: destination mobile number.
- `responseType`: `JSON`.
- `baseEncode`: `true`.
- `async`: `false`.
- `MessageType`: `6` for Unicode / UCS-2 SMS. Unifonic's examples include `MessageType=6`, and its status-code page names UCS2/GSM7 as the valid encodings.

Deferred/not used in v1:

- `CorrelationID`
- `statusCallback`
- scheduled/bulk fields

## Recipient format

Unifonic's classic API requires the `Recipient` field in international format without `00` or `+`, for example `966507679351`.

Package behavior:

- The pure recipient normalizer returns the internal canonical form with a leading plus, for example `+966507679351`, matching the PRD's "international format" test matrix.
- The transport converts that canonical value to Unifonic's required digits-only wire value before posting, for example `966507679351`.

This is not a PRD contradiction: the provider stores and tests normalized recipients as `+9665...`, while the client adapts the wire value to Unifonic's documented format.

## Success response and message id

The documented success response is HTTP 200 with:

```json
{
  "success": true,
  "message": "",
  "errorCode": "ER-00",
  "data": {
    "MessageID": 42000348806924,
    "Status": "Sent"
  }
}
```

The provider message id is `data.MessageID`, returned as a string from `send()`.

## Failure responses

Unifonic can fail either through:

- non-2xx HTTP status codes such as `401 Authentication failed`, `410 Invalid recipient format`, `421 No message body specified`, `440 Wrong sender format`, `460 Invalid encoding (Should be UCS2 or GSM7)`, or `480 This user cannot use specified SenderID`; or
- HTTP 200 with `"success": false`, `message`, `errorCode`, and an empty `data` object.

Both must map to `KsaError` without leaking `AppSid`.

## Sources

- Unifonic, "Sending Your First SMS via Unifonic API": https://docs.unifonic.com/articles/products-documentation/sending-your-first-sms-via-unifonic-api
- Unifonic, "HTTP Status Codes": https://docs.unifonic.com/articles/api-documentation/http-status-codes/a/rest-api
- Medusa, "Notification Module": https://docs.medusajs.com/resources/infrastructure-modules/notification
- Medusa installed types: `AbstractNotificationProviderService` from `@medusajs/framework/utils`, and `NotificationTypes.ProviderSendNotificationDTO` / `NotificationTypes.ProviderSendNotificationResultsDTO` from `@medusajs/framework/types`.
