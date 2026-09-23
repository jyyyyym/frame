import { HttpError, readCredentials, startGeneration } from "@/lib/higgsfield";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    const credentials = readCredentials(request);
    const form = await request.formData();
    const result = await startGeneration(credentials, form);
    return Response.json(result);
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    const message = error instanceof Error ? error.message : "영상을 시작하지 못했습니다.";
    return Response.json({ error: message }, { status });
  }
}
