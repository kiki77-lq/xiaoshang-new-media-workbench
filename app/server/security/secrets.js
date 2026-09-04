import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function generateToken() {
  return randomBytes(32).toString("base64url");
}

function secretsPath(dataDir) {
  return path.join(dataDir, "secrets.json");
}

function validateSecrets(value) {
  if (!value || typeof value.token !== "string" || value.token.length < 32) {
    throw new Error("INVALID_SECRETS_FILE");
  }
  return value;
}

function writeSecrets(dataDir, value) {
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dataDir, 0o700);
  const target = secretsPath(dataDir);
  const temporary = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx"
  });
  fs.renameSync(temporary, target);
  fs.chmodSync(target, 0o600);
  return value;
}

export function loadOrCreateSecrets({ dataDir }) {
  const target = secretsPath(dataDir);
  if (fs.existsSync(target)) {
    const value = validateSecrets(JSON.parse(fs.readFileSync(target, "utf8")));
    fs.chmodSync(target, 0o600);
    return value;
  }
  return writeSecrets(dataDir, {
    token: generateToken(),
    createdAt: new Date().toISOString(),
    rotatedAt: null
  });
}

export function rotateToken({ dataDir }) {
  const previous = loadOrCreateSecrets({ dataDir });
  return writeSecrets(dataDir, {
    token: generateToken(),
    createdAt: previous.createdAt,
    rotatedAt: new Date().toISOString()
  });
}
