import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { z } from "zod";
import { InfraiError } from "./infrai.ts";
import {
  createProofUpload,
  handleShipmentEvent,
  offboardTenant,
  provisionTenant,
} from "./tenant_logistics.ts";

const tenantSchema = z.object({
  tenantId: z.string().min(2).max(48).regex(/^[a-zA-Z0-9-]+$/),
  projectId: z.string().min(1).optional(),
});
const proofSchema = z.object({
  tenantId: z.string().min(2),
  shipmentId: z.string().min(1),
  contentType: z.string().min(1),
  maxBytes: z.number().int().positive().max(20_000_000),
});
const eventSchema = z.object({
  tenantId: z.string().min(2),
  shipmentId: z.string().min(1),
  status: z.enum(["in_transit", "delivered", "delivery_failed"]),
  proofKey: z.string().min(1).optional(),
  occurredAt: z.string().datetime(),
});
const offboardSchema = z.object({
  tenantId: z.string().min(2),
  credentialId: z.string().min(1),
  operationId: z.string().uuid(),
});

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function json(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

async function route(request: IncomingMessage, response: ServerResponse) {
  if (request.method !== "POST") return json(response, 405, { error: "method_not_allowed" });
  const input = await readJson(request);

  if (request.url === "/tenants") {
    return json(response, 201, await provisionTenant(tenantSchema.parse(input)));
  }
  if (request.url === "/proofs/presign") {
    return json(response, 200, await createProofUpload(proofSchema.parse(input)));
  }
  if (request.url === "/shipments/events") {
    return json(response, 200, await handleShipmentEvent(eventSchema.parse(input)));
  }
  if (request.url === "/tenants/offboard") {
    return json(response, 200, await offboardTenant(offboardSchema.parse(input)));
  }
  return json(response, 404, { error: "route_not_found" });
}

const server = createServer((request, response) => {
  route(request, response).catch((error: unknown) => {
    if (error instanceof z.ZodError) return json(response, 400, { error: "invalid_request", issues: error.issues });
    if (error instanceof InfraiError) {
      const status = error.status >= 400 && error.status < 500 ? error.status : 502;
      return json(response, status, { error: error.detail });
    }
    console.error(error);
    return json(response, 500, { error: "service_error" });
  });
});

const port = Number(process.env.PORT ?? 3000);
server.listen(port, () => console.log(`Shipment service listening on http://localhost:${port}`));
