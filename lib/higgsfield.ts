import { credentialProblem, normalizeCredentials } from "@/lib/credentials";

const API = "https://api.higgsfield.ai";

const TEXT_MODEL = "bytedance/seedance-2.5/text-to-video";
const IMAGE_MODEL = "bytedance/seedance-2.5/image-to-video";

const ASPECTS = new Set(["16:9", "4:3", "1:1", "3:4", "9:16", "21:9"]);
const RESOLUTIONS = new Set(["480p", "720p"]);
const FORMATS = new Set(["mp4", "mov"]);
const IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
]);

export class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function readCredentials(request: Request): string {
  const raw = normalizeCredentials(request.headers.get("x-hf-credentials") ?? "");
  const problem = credentialProblem(raw);
  if (problem) throw new HttpError(401, problem);
  if (raw.length > 400) {
    throw new HttpError(400, "자격 증명이 너무 깁니다.");
  }
  return raw;
}

function authHeaders(credentials: string, json = false): HeadersInit {
  const headers: Record<string, string> = {
    Authorization: `Key ${credentials}`,
  };
  if (json) headers["Content-Type"] = "application/json";
  return headers;
}

async function readError(response: Response): Promise<string> {
  const text = await response.text();
  if (!text) return `Higgsfield 응답 오류 (${response.status})`;
  try {
    const data = JSON.parse(text) as { detail?: unknown; message?: unknown };
    return formatDetail(data.detail ?? data.message) || text.slice(0, 400);
  } catch {
    return text.slice(0, 400);
  }
}

function formatDetail(detail: unknown): string {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && "msg" in item) {
          const loc = "loc" in item && Array.isArray(item.loc) ? item.loc.join(".") : "";
          const msg = String((item as { msg: unknown }).msg);
          return loc ? `${loc}: ${msg}` : msg;
        }
        return "";
      })
      .filter(Boolean)
      .join(" ");
  }
  return "";
}

async function higgsfield(credentials: string, path: string, init: RequestInit = {}) {
  const response = await fetch(`${API}${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      ...authHeaders(credentials, false),
      ...(init.headers ?? {}),
    },
    signal: init.signal ?? AbortSignal.timeout(90_000),
  });
  return response;
}

export async function verifyCredentials(credentials: string): Promise<void> {
  const response = await higgsfield(
    credentials,
    "/requests/00000000-0000-4000-8000-000000000000/status",
    { signal: AbortSignal.timeout(20_000) },
  );
  if (response.status === 401) {
    throw new HttpError(401, "API 키가 올바르지 않습니다. 콘솔에서 다시 복사해 주세요.");
  }
  if (response.status === 404 || response.ok) return;
  throw new HttpError(response.status, await readError(response));
}

function normalizeImageType(type: string): string {
  if (type === "image/jpg") return "image/jpeg";
  return type;
}

async function uploadImage(credentials: string, file: File): Promise<string> {
  const type = normalizeImageType(file.type);
  if (!IMAGE_TYPES.has(file.type) && !IMAGE_TYPES.has(type)) {
    throw new HttpError(400, "이미지는 JPEG, PNG, WebP, GIF만 올릴 수 있습니다.");
  }
  if (file.size > 4 * 1024 * 1024) {
    throw new HttpError(400, "이미지는 4MB 이하만 올릴 수 있습니다.");
  }
  if (file.size === 0) {
    throw new HttpError(400, "빈 이미지 파일입니다.");
  }

  const created = await higgsfield(credentials, "/files/generate-upload-url", {
    method: "POST",
    headers: authHeaders(credentials, true),
    body: JSON.stringify({ content_type: type }),
  });
  if (!created.ok) {
    throw new HttpError(created.status, await readError(created));
  }

  const upload = (await created.json()) as {
    public_url?: string;
    upload_url?: string;
    upload_headers?: Record<string, string>;
  };
  if (!upload.upload_url || !upload.public_url) {
    throw new HttpError(502, "이미지 업로드 주소를 받지 못했습니다.");
  }

  const headers = new Headers();
  for (const [key, value] of Object.entries(upload.upload_headers ?? {})) {
    headers.set(key, value);
  }
  if (!headers.has("Content-Type")) headers.set("Content-Type", type);

  const put = await fetch(upload.upload_url, {
    method: "PUT",
    headers,
    body: new Uint8Array(await file.arrayBuffer()),
    cache: "no-store",
    signal: AbortSignal.timeout(90_000),
  });
  if (!put.ok) {
    throw new HttpError(502, "이미지를 Higgsfield 저장소에 올리지 못했습니다.");
  }
  return upload.public_url;
}

function readEnum(value: FormDataEntryValue | null, allowed: Set<string>, fallback: string) {
  const text = typeof value === "string" ? value : "";
  return allowed.has(text) ? text : fallback;
}

function readDuration(value: FormDataEntryValue | null) {
  const n = Number(typeof value === "string" ? value : "");
  if (!Number.isFinite(n)) return 5;
  return Math.min(30, Math.max(4, Math.round(n)));
}

function readBool(value: FormDataEntryValue | null) {
  return value === "true" || value === "on" || value === "1";
}

export async function startGeneration(credentials: string, form: FormData) {
  const mode = form.get("mode") === "image" ? "image" : "text";
  const prompt = String(form.get("prompt") ?? "").trim();
  const duration = readDuration(form.get("duration"));
  const resolution = readEnum(form.get("resolution"), RESOLUTIONS, "720p");
  const outputFormat = readEnum(form.get("outputFormat"), FORMATS, "mp4");
  const generateAudio = readBool(form.get("generateAudio"));

  const body: Record<string, unknown> = {
    duration,
    resolution,
    output_format: outputFormat,
    generate_audio: generateAudio,
  };

  let path = `/${TEXT_MODEL}`;

  if (mode === "text") {
    if (!prompt) throw new HttpError(400, "영상으로 만들 문장을 입력해 주세요.");
    body.prompt = prompt;
    body.aspect_ratio = readEnum(form.get("aspectRatio"), ASPECTS, "16:9");
  } else {
    const image = form.get("image");
    if (!(image instanceof File) || image.size === 0) {
      throw new HttpError(400, "움직임을 줄 이미지를 올려 주세요.");
    }
    body.image_url = await uploadImage(credentials, image);
    if (prompt) body.prompt = prompt;
    const end = form.get("endImage");
    if (end instanceof File && end.size > 0) {
      body.end_image_url = await uploadImage(credentials, end);
    }
    path = `/${IMAGE_MODEL}`;
  }

  const response = await higgsfield(credentials, path, {
    method: "POST",
    headers: authHeaders(credentials, true),
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new HttpError(response.status, await readError(response));
  }

  const data = (await response.json()) as {
    request_id?: string;
    status?: string;
  };
  if (!data.request_id) {
    throw new HttpError(502, "생성 요청 번호를 받지 못했습니다.");
  }
  return { requestId: data.request_id, status: data.status ?? "queued" };
}

export async function getStatus(credentials: string, requestId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(requestId)) {
    throw new HttpError(400, "요청 번호 형식이 올바르지 않습니다.");
  }
  const response = await higgsfield(credentials, `/requests/${requestId}/status`, {
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new HttpError(response.status, await readError(response));
  }
  const data = (await response.json()) as {
    status?: string;
    request_id?: string;
    error?: string | null;
    video?: { url?: string };
  };
  return {
    requestId: data.request_id ?? requestId,
    status: data.status ?? "queued",
    error: data.error ?? null,
    videoUrl: data.video?.url ?? null,
  };
}

export async function cancelRequest(credentials: string, requestId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(requestId)) {
    throw new HttpError(400, "요청 번호 형식이 올바르지 않습니다.");
  }
  const response = await higgsfield(credentials, `/requests/${requestId}/cancel`, {
    method: "POST",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok && response.status !== 409) {
    throw new HttpError(response.status, await readError(response));
  }
  return { requestId, status: "canceled" as const };
}
