import { getStatus, HttpError, readCredentials } from "@/lib/higgsfield";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const credentials = readCredentials(request);
    const requestId = new URL(request.url).searchParams.get("requestId") ?? "";
    const result = await getStatus(credentials, requestId);
    return Response.json(result);
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    const message = error instanceof Error ? error.message : "상태를 가져오지 못했습니다.";
    return Response.json({ error: message }, { status });
  }
}
