import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { applicationSecret } from "./secret-box";

type PaperExportClaims = {
  paperId: string;
  ownerId: string;
  expiresAt: number;
};

function signature(payload: string) {
  return createHmac("sha256", applicationSecret()).update(payload).digest("base64url");
}

export function createPaperExportToken(paperId: string, ownerId: string, lifetimeSeconds = 120) {
  const claims: PaperExportClaims = {
    paperId,
    ownerId,
    expiresAt: Math.floor(Date.now() / 1000) + lifetimeSeconds,
  };
  const payload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  return `${payload}.${signature(payload)}`;
}

export function verifyPaperExportToken(token: string | null | undefined, expectedPaperId: string): PaperExportClaims | null {
  if (!token) return null;
  const [payload, suppliedSignature, extra] = token.split(".");
  if (!payload || !suppliedSignature || extra) return null;
  const expectedSignature = signature(payload);
  const suppliedBytes = Buffer.from(suppliedSignature);
  const expectedBytes = Buffer.from(expectedSignature);
  if (suppliedBytes.length !== expectedBytes.length || !timingSafeEqual(suppliedBytes, expectedBytes)) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as PaperExportClaims;
    if (claims.paperId !== expectedPaperId || !claims.ownerId || claims.expiresAt < Math.floor(Date.now() / 1000)) return null;
    return claims;
  } catch {
    return null;
  }
}
