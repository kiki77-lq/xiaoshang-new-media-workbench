import { HttpError } from "./errors.js";

export async function readJson(req, limitBytes) {
  const declaredLength = Number(req.headers["content-length"] || 0);
  if (Number.isFinite(declaredLength) && declaredLength > limitBytes) {
    throw new HttpError(413, "PAYLOAD_TOO_LARGE", "Request body exceeds the allowed size.");
  }

  const chunks = [];
  let received = 0;
  let tooLarge = false;
  for await (const chunk of req) {
    received += chunk.length;
    if (received > limitBytes) {
      tooLarge = true;
      continue;
    }
    chunks.push(chunk);
  }
  if (tooLarge) {
    throw new HttpError(413, "PAYLOAD_TOO_LARGE", "Request body exceeds the allowed size.");
  }

  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "INVALID_JSON", "Request body must be valid JSON.");
  }
}
