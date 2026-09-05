import { HttpError } from "../http/errors.js";

export function assertObject(value, allowedKeys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "VALIDATION_ERROR", "Request body must be a JSON object.", [{ field: "body" }]);
  }
  const unknown = Object.keys(value).filter((key) => !allowedKeys.includes(key));
  if (unknown.length) {
    throw new HttpError(400, "VALIDATION_ERROR", "Request body contains unsupported fields.", unknown.map((field) => ({ field, rule: "unsupported" })));
  }
  return value;
}

export function requiredString(value, field, max = 5000) {
  if (typeof value !== "string" || !value.trim()) {
    throw new HttpError(400, "VALIDATION_ERROR", `${field} is required.`, [{ field, rule: "required" }]);
  }
  const normalized = value.trim();
  if (normalized.length > max) {
    throw new HttpError(400, "VALIDATION_ERROR", `${field} is too long.`, [{ field, rule: `max:${max}` }]);
  }
  return normalized;
}

export function optionalString(value, field, max = 1000) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new HttpError(400, "VALIDATION_ERROR", `${field} must be a string.`, [{ field }]);
  const normalized = value.trim();
  if (normalized.length > max) throw new HttpError(400, "VALIDATION_ERROR", `${field} is too long.`, [{ field, rule: `max:${max}` }]);
  return normalized || null;
}

export function optionalUrl(value, field) {
  const normalized = optionalString(value, field, 2048);
  if (!normalized) return null;
  try {
    const url = new URL(normalized);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error("protocol");
    return url.toString();
  } catch {
    throw new HttpError(400, "VALIDATION_ERROR", `${field} must be an HTTP(S) URL.`, [{ field, rule: "url" }]);
  }
}

export function enumValue(value, field, allowed, fallback) {
  const candidate = value ?? fallback;
  if (!allowed.includes(candidate)) {
    throw new HttpError(400, "VALIDATION_ERROR", `${field} is invalid.`, [{ field, allowed }]);
  }
  return candidate;
}

export function booleanValue(value, field, fallback = false) {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new HttpError(400, "VALIDATION_ERROR", `${field} must be boolean.`, [{ field }]);
  return value;
}

export function tagValues(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((tag) => typeof tag !== "string")) {
    throw new HttpError(400, "VALIDATION_ERROR", "tags must be an array of strings.", [{ field: "tags" }]);
  }
  return value;
}

export function expectedVersion(value) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new HttpError(400, "VERSION_REQUIRED", "A positive integer version is required.", [{ field: "version" }]);
  }
  return value;
}
