import { HttpError } from "./errors.js";

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store"
  });
  res.end(payload);
}

export function sendData(res, status, data, meta = {}) {
  sendJson(res, status, { data, meta });
}

export function sendError(res, error, requestId) {
  const normalized = error instanceof HttpError
    ? error
    : new HttpError(500, "INTERNAL_ERROR", "An unexpected error occurred.");
  sendJson(res, normalized.status, {
    error: {
      code: normalized.code,
      message: normalized.message,
      details: normalized.details
    },
    requestId
  });
}
