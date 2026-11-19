import { randomUUID } from "node:crypto";

const base = process.env.SERVICE_URL ?? "http://localhost:3000";
const tenantId = `store-${Date.now()}`;

export {};

async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = (await response.json()) as T;
  if (!response.ok) throw new Error(JSON.stringify(result));
  return result;
}

const tenant = await post<{ bucket: string; credentialId: string; credential: string }>(
  "/tenants",
  { tenantId },
);
console.log("Tenant ready; store this credential now because its plaintext is shown once:", {
  bucket: tenant.bucket,
  credentialId: tenant.credentialId,
  credential: tenant.credential,
});

try {
  const proof = await post<{ proofKey: string; uploadUrl: string; method: "PUT" }>(
    "/proofs/presign",
    { tenantId, shipmentId: "order-1042", contentType: "text/plain", maxBytes: 1024 },
  );
  const upload = await fetch(proof.uploadUrl, {
    method: proof.method,
    headers: { "content-type": "text/plain" },
    body: "Signed by customer at the storefront delivery desk",
  });
  if (!upload.ok) throw new Error(`Proof upload rejected (${upload.status})`);

  const decision = await post("/shipments/events", {
    tenantId,
    shipmentId: "order-1042",
    status: "delivered",
    proofKey: proof.proofKey,
    occurredAt: new Date().toISOString(),
  });
  console.log("Shipment decision:", decision);
} finally {
  await post("/tenants/offboard", {
    tenantId,
    credentialId: tenant.credentialId,
    operationId: randomUUID(),
  });
  console.log("Tenant offboarded:", tenantId);
}
