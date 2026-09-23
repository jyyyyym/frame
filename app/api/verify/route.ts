import { HttpError, readCredentials, verifyCredentials } from "@/lib/higgsfield";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const credentials = readCredentials(request);
    await verifyCredentials(credentials);
    return Response.json({ ok: true });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    const message = error instanceof Error ? error.message : "연결을 확인하지 못했습니다.";
    return Response.json({ error: message }, { status });
  }
}
