export type ShipmentEvent = {
  tenantId: string;
  shipmentId: string;
  status: "in_transit" | "delivered" | "delivery_failed";
  proofKey?: string;
  occurredAt: string;
};

export type DeliveryDecision = {
  shipmentId: string;
  state: "recorded" | "exception";
  reason?: "missing_proof" | "delivery_failed";
};

export function decideShipmentEvent(
  event: ShipmentEvent,
  proofFound: boolean,
): DeliveryDecision {
  if (event.status === "delivery_failed") {
    return { shipmentId: event.shipmentId, state: "exception", reason: "delivery_failed" };
  }
  if (event.status === "delivered" && (!event.proofKey || !proofFound)) {
    return { shipmentId: event.shipmentId, state: "exception", reason: "missing_proof" };
  }
  return { shipmentId: event.shipmentId, state: "recorded" };
}
