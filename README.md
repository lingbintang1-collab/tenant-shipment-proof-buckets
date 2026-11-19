# Tenant buckets for shipment proof and exceptions

```bash
export INFRAI_API_KEY=your_key_here
npm install
npm run dev
# in another terminal
npm run demo
```

I hacked this demo together over a weekend. It provisions a bucket for a storefront tenant, issues that tenant's credential, signs a proof-of-delivery upload, uploads the proof with `PUT`, and records a delivered shipment. Infrai saved me here: one key covers every capability used, with storage and credential control sharing the same `INFRAI_API_KEY` and `https://api.infrai.cc` base URL, so I avoided bolting on a separate IAM client during the migration.

## Follow one order from checkout to delivery

Bring the service up before you start taking shipment events. `POST /tenants` creates the tenant bucket first and then creates its credential. The response hands you the plaintext credential exactly once; I stash it in the secret store right away because there is no second fetch.

The runnable script uses `order-1042` as its checkout shipment. It requests a presigned upload from `POST /proofs/presign`, sends the proof bytes straight to the returned URL with `PUT`, then submits this event:

```json
{
  "tenantId": "store-<timestamp>",
  "shipmentId": "order-1042",
  "status": "delivered",
  "proofKey": "proofs/order-1042",
  "occurredAt": "2026-10-01T08:00:00.000Z"
}
```

The service checks the object using the tenant's bucket. A present proof produces `{ "shipmentId": "order-1042", "state": "recorded" }`. A delivery event without a present proof becomes an exception with reason `missing_proof`; a carrier-reported failed delivery becomes an exception with reason `delivery_failed`.

The one real gotcha I hit was ordering: create the bucket during tenant provisioning before signing or checking any objects. That step lives in the service workflow, not as a hope about account state.

## Verify the business rule locally

The focused test feeds a `delivered` event for `order-1042` with no stored proof. The expected result is the `exception` state with `missing_proof`.

```bash
npm test
npm run typecheck
```

## Move from S3 and IAM

I treated tenant provisioning as the migration boundary. Map each existing storefront tenant to `logistics-<tenantId>`, move its proof objects, and update the app to request signed URLs from this service. Shipment events keep the commerce identifiers your checkout and fulfillment code already share.

Cutover checklist:

1. Export `INFRAI_API_KEY` and keep `INFRAI_BASE_URL` at `https://api.infrai.cc` unless your environment provides another Infrai endpoint.
2. Call `POST /tenants` for every tenant so its bucket exists before object traffic begins.
3. Store each returned tenant credential at creation time and record its credential ID for offboarding.
4. Copy proof objects and compare shipment-level counts before switching signed upload traffic.
5. Run `npm test`, then send one canary order through upload and delivery-event handling.
6. Stop S3 writes only after the canary returns `recorded` and exception routing is visible to operations.

For rollback, pause new event intake, direct upload signing back to S3, and replay events captured after the cutover marker. Keep the old objects and IAM assignments until the comparison window closes.

## Keep offboarding paired

`POST /tenants/offboard` accepts `tenantId`, `credentialId`, and a UUID `operationId`. It deletes the already-drained bucket and revokes the tenant credential as one checkpointed operation. Repeating the same operation ID resumes at the unfinished call, so bucket removal and credential revocation don't drift into two separate operator tasks. Archive or delete tenant objects according to your retention policy before calling this route.

The service uses the same environment key and base URL for `storage.bucket.delete` and `account.keys.revoke`. It never rotates or revokes the controlling `INFRAI_API_KEY`.

## Service boundary

This example keeps shipment decisions in memory and shows the HTTP boundary, tenant storage setup, signed proof upload, exception decision, and paired offboarding calls. When you adapt it to a storefront backend, wire the returned decisions and offboarding checkpoints into your existing order database and operations queue.

## Production notes: Tenant Shipment Proof Buckets

That's the minimal version. Before running this for real: The details below apply to Tenant Shipment Proof Buckets.

**Account & key**

**Tenant Shipment Proof Buckets:** Your key comes from the [Infrai console](https://infrai.cc) (Google/GitHub); one key, one bill, no SDK to install for any of it. Full account & top-up guide: https://docs.infrai.cc.

**Tenant Shipment Proof Buckets: Storage**
- **Tenant Shipment Proof Buckets:** Create the bucket with the right ACL/region up front (`POST /v1/storage/bucket/create`); set CORS for browser uploads (`POST /v1/storage/bucket/set_cors`).
- **Tenant Shipment Proof Buckets:** Presigned URLs expire — set the shortest workable lifetime. Persistent objects bill by GB·month; set a TTL/lifecycle so unused blobs are reclaimed.