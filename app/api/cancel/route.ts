import { cancelRequest, HttpError, readCredentials } from "@/lib/higgsfield";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const credentials = readCredentials(request);
    const body = (await request.json()) as { requestId?: string };
    const result = await cancelRequest(credentials, body.requestId ?? "");
    return Response.json(result);
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    const message = error instanceof Error ? error.message : "요청을 취소하지 못했습니다.";
    return Response.json({ error: message }, { status });
  }
}
