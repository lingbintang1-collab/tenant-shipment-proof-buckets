import assert from "node:assert/strict";
import test from "node:test";
import { decideShipmentEvent } from "../src/delivery_decision.ts";

test("a delivered checkout shipment without proof enters exception handling", () => {
  const result = decideShipmentEvent(
    {
      tenantId: "store-hangzhou",
      shipmentId: "order-1042",
      status: "delivered",
      proofKey: "proofs/order-1042",
      occurredAt: "2026-10-01T08:00:00.000Z",
    },
    false,
  );

  assert.deepEqual(result, {
    shipmentId: "order-1042",
    state: "exception",
    reason: "missing_proof",
  });
});
