import "server-only";

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { dataDirectory } from "../db";
import { runtimeEnv } from "./server";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function encryptionKey() {
  const secret = encryptionSecret();
  if (!secret || secret.length < 16) {
    throw new Error("保存自定义 API Key 前，请设置至少 16 位的 MODEL_KEY_ENCRYPTION_SECRET 环境变量。");
  }
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(secret));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

function encryptionSecret() {
  const configured = runtimeEnv().MODEL_KEY_ENCRYPTION_SECRET?.trim();
  if (configured) return configured;
  const directory = dataDirectory();
  const secretPath = path.join(directory, ".model-key-secret");
  try {
    return readFileSync(secretPath, "utf8").trim();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  mkdirSync(directory, { recursive: true });
  const generated = bytesToBase64(crypto.getRandomValues(new Uint8Array(32)));
  try {
    writeFileSync(secretPath, generated + "\n", { encoding: "utf8", flag: "wx", mode: 0o600 });
    return generated;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return readFileSync(secretPath, "utf8").trim();
    throw error;
  }
}

export async function encryptSecret(value: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await encryptionKey(), encoder.encode(value));
  return { ciphertext: bytesToBase64(new Uint8Array(encrypted)), iv: bytesToBase64(iv) };
}

export async function decryptSecret(ciphertext: string, iv: string) {
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(iv) },
    await encryptionKey(),
    base64ToBytes(ciphertext),
  );
  return decoder.decode(decrypted);
}

export function maskSecret(value: string) {
  if (value.length <= 8) return "••••••••";
  return value.slice(0, 3) + "••••••" + value.slice(-4);
}
