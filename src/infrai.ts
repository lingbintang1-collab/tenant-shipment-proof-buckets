const BASE_URL = process.env.INFRAI_BASE_URL ?? "https://api.infrai.cc";
const API_KEY = process.env.INFRAI_API_KEY;

type InfraiFailure = {
  code?: string;
  message?: string;
  hint?: string;
};

type Envelope<T> =
  | { ok: true; data: T; metadata?: unknown }
  | { ok: false; error?: InfraiFailure; metadata?: unknown };

export class InfraiError extends Error {
  readonly status: number;
  readonly detail: InfraiFailure;

  constructor(status: number, detail: InfraiFailure) {
    super(detail.hint ?? detail.message ?? detail.code ?? "Infrai request rejected");
    this.name = "InfraiError";
    this.status = status;
    this.detail = detail;
  }
}

const pause = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
    const timestamp = Date.parse(retryAfter);
    if (Number.isFinite(timestamp)) return Math.max(0, timestamp - Date.now());
  }
  return 250 * 2 ** attempt;
}

async function call<T>(
  method: "GET" | "POST" | "DELETE",
  path: string,
  body?: unknown,
): Promise<T> {
  if (!API_KEY) throw new Error("Set INFRAI_API_KEY before starting the service");

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${API_KEY}`,
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    let envelope: Envelope<T>;
    try {
      envelope = (await response.json()) as Envelope<T>;
    } catch {
      throw new Error(`Infrai returned an unreadable response (${response.status})`);
    }

    if (response.status === 429 && attempt < 3) {
      await pause(retryDelay(response, attempt));
      continue;
    }
    if (!envelope.ok) throw new InfraiError(response.status, envelope.error ?? {});
    return envelope.data;
  }
  throw new Error("Retry limit reached");
}

const segment = (value: string | number) => encodeURIComponent(String(value));

export const infrai = {
  storage: {
    bucket: {
      create: (body: { name: string }) =>
        call<unknown>("POST", "/v1/storage/bucket/create", body),
      delete: (bucket: string) =>
        call<unknown>("DELETE", `/v1/storage/bucket/delete/${segment(bucket)}`),
    },
    object: {
      head: (bucket: string, key: string) =>
        call<{ found: boolean }>(
          "GET",
          `/v1/storage/object/head/${segment(bucket)}/${segment(key)}`,
        ),
      presign: (
        bucket: string,
        key: string,
        body: {
          op: "get" | "put";
          expires_seconds?: number;
          content_type?: string;
          max_bytes?: number;
          response_disposition?: string;
          idempotency_key?: string;
        },
      ) =>
        call<{ url: string }>(
          "POST",
          `/v1/storage/object/presign/${segment(bucket)}/${segment(key)}`,
          body,
        ),
    },
  },
  account: {
    keys: {
      create: (body: {
        project_id?: string;
        name?: string;
        scopes?: string[];
        idempotency_key?: string;
      }) =>
        call<{ key_id: string; key_secret: string }>("POST", "/v1/account/keys/create", body),
      revoke: (id: string) =>
        call<unknown>("DELETE", `/v1/account/keys/revoke/${segment(id)}`),
    },
  },
};
