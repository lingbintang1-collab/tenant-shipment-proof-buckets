import { randomUUID } from "node:crypto";
import { infrai } from "./infrai.ts";
import { decideShipmentEvent, type ShipmentEvent } from "./delivery_decision.ts";

export function tenantBucket(tenantId: string): string {
  return `logistics-${tenantId.toLowerCase().replace(/[^a-z0-9-]/g, "-")}`;
}

export async function provisionTenant(input: {
  tenantId: string;
  projectId?: string;
}) {
  const bucket = tenantBucket(input.tenantId);
  await infrai.storage.bucket.create({ name: bucket });
  const credential = await infrai.account.keys.create({
    project_id: input.projectId,
    name: `logistics-${input.tenantId}`,
    idempotency_key: `tenant-${input.tenantId}`,
  });
  return {
    bucket,
    credentialId: credential.key_id,
    credential: credential.key_secret,
  };
}

export async function createProofUpload(input: {
  tenantId: string;
  shipmentId: string;
  contentType: string;
  maxBytes: number;
}) {
  const bucket = tenantBucket(input.tenantId);
  const proofKey = `proofs/${input.shipmentId}`;
  const signed = await infrai.storage.object.presign(bucket, proofKey, {
    op: "put",
    expires_seconds: 600,
    content_type: input.contentType,
    max_bytes: input.maxBytes,
    idempotency_key: randomUUID(),
  });
  return { bucket, proofKey, uploadUrl: signed.url, method: "PUT" as const };
}

export async function handleShipmentEvent(event: ShipmentEvent) {
  const proof = event.proofKey
    ? await infrai.storage.object.head(tenantBucket(event.tenantId), event.proofKey)
    : { found: false };
  return decideShipmentEvent(event, proof.found);
}

type OffboardingCheckpoint = "started" | "bucket_deleted" | "complete";
const offboarding = new Map<string, OffboardingCheckpoint>();

export async function offboardTenant(input: {
  tenantId: string;
  credentialId: string;
  operationId: string;
}) {
  let checkpoint = offboarding.get(input.operationId) ?? "started";
  offboarding.set(input.operationId, checkpoint);

  if (checkpoint === "started") {
    await infrai.storage.bucket.delete(tenantBucket(input.tenantId));
    checkpoint = "bucket_deleted";
    offboarding.set(input.operationId, checkpoint);
  }
  if (checkpoint === "bucket_deleted") {
    await infrai.account.keys.revoke(input.credentialId);
    checkpoint = "complete";
    offboarding.set(input.operationId, checkpoint);
  }
  return { operationId: input.operationId, state: checkpoint };
}
