import { HttpError } from "../http/errors.js";

export function assertVersion({ expectedVersion, actualVersion }) {
  if (!Number.isInteger(expectedVersion) || !Number.isInteger(actualVersion)) {
    throw new HttpError(400, "INVALID_VERSION", "Version must be an integer.");
  }
  if (expectedVersion !== actualVersion) {
    throw new HttpError(
      409,
      "VERSION_CONFLICT",
      "The record changed after it was loaded.",
      [{ expectedVersion, actualVersion }]
    );
  }
}
