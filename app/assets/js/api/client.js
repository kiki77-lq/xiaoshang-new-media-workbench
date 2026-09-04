export class ApiError extends Error {
  constructor({ status, code, message, details = [], requestId = null }) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }
}

export function createApiClient({ baseUrl = "/api/v1", fetchImpl = globalThis.fetch } = {}) {
  async function request(path, { method = "GET", body, version, idempotencyKey } = {}) {
    const headers = { Accept: "application/json" };
    let payload;
    if (body !== undefined || version !== undefined) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(version === undefined ? body : { ...(body || {}), version });
    }
    if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

    let response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, { method, headers, body: payload });
    } catch (cause) {
      throw new ApiError({ status: 0, code: "NETWORK_ERROR", message: "无法连接本地服务。", details: [], requestId: null, cause });
    }

    let envelope;
    try {
      envelope = await response.json();
    } catch {
      throw new ApiError({ status: response.status, code: "INVALID_RESPONSE", message: "服务返回了无法识别的数据。" });
    }
    if (!response.ok) {
      throw new ApiError({
        status: response.status,
        code: envelope.error?.code || "REQUEST_FAILED",
        message: envelope.error?.message || "请求失败。",
        details: envelope.error?.details || [],
        requestId: envelope.requestId || response.headers.get("x-request-id")
      });
    }
    return { data: envelope.data, requestId: envelope.meta?.requestId || response.headers.get("x-request-id") };
  }

  return {
    request,
    get: (path) => request(path),
    post: (path, body, options = {}) => request(path, { ...options, method: "POST", body }),
    patch: (path, body, options = {}) => request(path, { ...options, method: "PATCH", body }),
    delete: (path, options = {}) => request(path, { ...options, method: "DELETE" })
  };
}

export const api = createApiClient();
