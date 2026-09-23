import { getStatus, HttpError, readCredentials } from "@/lib/higgsfield";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  try {
    const credentials = readCredentials(request);
    const requestId = new URL(request.url).searchParams.get("requestId") ?? "";
    const status = await getStatus(credentials, requestId);
    if (!status.videoUrl) {
      return Response.json({ error: "받을 영상이 없습니다." }, { status: 404 });
    }

    const upstream = await fetch(status.videoUrl, {
      cache: "no-store",
      redirect: "follow",
      signal: AbortSignal.timeout(60_000),
    });
    if (!upstream.ok || !upstream.body) {
      return Response.json({ error: "영상 파일을 가져오지 못했습니다." }, { status: 502 });
    }

    const ext = /\.mov(\?|$)/i.test(status.videoUrl) ? "mov" : "mp4";
    const type = upstream.headers.get("content-type") || (ext === "mov" ? "video/quicktime" : "video/mp4");
    const headers = new Headers({
      "Content-Type": type,
      "Content-Disposition": `attachment; filename="frame-${requestId}.${ext}"`,
      "Cache-Control": "no-store",
    });
    const length = upstream.headers.get("content-length");
    if (length) headers.set("Content-Length", length);

    return new Response(upstream.body, { status: 200, headers });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    const message = error instanceof Error ? error.message : "영상을 받지 못했습니다.";
    return Response.json({ error: message }, { status });
  }
}
