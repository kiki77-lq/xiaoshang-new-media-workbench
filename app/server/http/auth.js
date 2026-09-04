import { timingSafeEqual } from "node:crypto";

import { HttpError } from "./errors.js";

function equalTokens(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function authenticateRequest(req, config) {
  const origin = req.headers.origin;
  if (origin) {
    if (!config.allowedOrigins.has(origin)) {
      throw new HttpError(403, "ORIGIN_FORBIDDEN", "Browser write origin is not allowed.");
    }
    return { actor: "web" };
  }

  const authorization = req.headers.authorization || "";
  const match = /^Bearer ([A-Za-z0-9_-]+)$/.exec(authorization);
  if (!match || !config.authToken || !equalTokens(match[1], config.authToken)) {
    throw new HttpError(401, "UNAUTHORIZED", "A valid local bearer token is required.");
  }
  return { actor: "workbuddy" };
}
