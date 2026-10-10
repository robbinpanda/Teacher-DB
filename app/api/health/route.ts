import { proxyBackendRequest } from "../../../lib/backend-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return proxyBackendRequest(request);
}
