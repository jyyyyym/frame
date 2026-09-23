"use client";

import { useEffect, useRef, useState } from "react";

type Mode = "text" | "image";
type JobStatus = "idle" | "queued" | "in_progress" | "completed" | "failed" | "nsfw" | "canceled";

type Shot = {
  id: string;
  requestId?: string;
  mode: Mode;
  prompt: string;
  status: JobStatus;
  videoUrl?: string;
  createdAt: number;
};

const HISTORY_KEY = "frame.hf.history";

const TEXT_PROMPTS = [
  "비 오는 밤, 네온이 번지는 골목을 천천히 걷는 트래킹 샷",
  "유리 온실 안에서 햇살이 먼지 사이로 내려앉는다",
  "파도가 검은 모래사장을 덮고 천천히 물러나는 슬로모션",
];

const IMAGE_PROMPTS = [
  "피사체가 천천히 카메라를 바라보며 미소 짓는다",
  "바람이 커튼과 머리카락을 같은 방향으로 밀어낸다",
  "카메라가 앞으로 다가가며 배경이 부드럽게 흐려진다",
];

const ASPECTS = ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"];
const TERMINAL = new Set(["completed", "failed", "nsfw", "canceled"]);

const STATUS_LABEL: Record<string, string> = {
  idle: "대기",
  queued: "대기열",
  in_progress: "생성 중",
  completed: "완료",
  failed: "실패",
  nsfw: "정책으로 거절",
  canceled: "취소",
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadHistory(): Shot[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = sessionStorage.getItem(HISTORY_KEY);
    return raw ? (JSON.parse(raw) as Shot[]) : [];
  } catch {
    return [];
  }
}

export default function Studio() {
  const [apiKey, setApiKey] = useState("");

  const [mode, setMode] = useState<Mode>("text");
  const [prompt, setPrompt] = useState(TEXT_PROMPTS[0]);
  const [duration, setDuration] = useState(5);
  const [aspect, setAspect] = useState("16:9");
  const [resolution, setResolution] = useState<"480p" | "720p">("720p");
  const [format, setFormat] = useState<"mp4" | "mov">("mp4");
  const [audio, setAudio] = useState(true);
  const [image, setImage] = useState<File | null>(null);
  const [endImage, setEndImage] = useState<File | null>(null);
  const [imageUrl, setImageUrl] = useState("");
  const [endUrl, setEndUrl] = useState("");

  const [shots, setShots] = useState<Shot[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const pollToken = useRef(0);

  const credentials = apiKey.trim();

  const active = shots.find((shot) => shot.id === activeId) ?? null;

  useEffect(() => {
    sessionStorage.removeItem("frame.hf.credentials");
    localStorage.removeItem("frame.hf.credentials");
    localStorage.removeItem("frame.hf.remember");
    const history = loadHistory();
    setShots(history);
    if (history[0]) setActiveId(history[0].id);
  }, []);

  useEffect(() => {
    if (!image) {
      setImageUrl("");
      return;
    }
    const url = URL.createObjectURL(image);
    setImageUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [image]);

  useEffect(() => {
    if (!endImage) {
      setEndUrl("");
      return;
    }
    const url = URL.createObjectURL(endImage);
    setEndUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [endImage]);

  function saveHistory(next: Shot[]) {
    setShots(next);
    sessionStorage.setItem(HISTORY_KEY, JSON.stringify(next.slice(0, 12)));
  }

  function updateShot(id: string, patch: Partial<Shot>) {
    setShots((current) => {
      const next = current.map((shot) => (shot.id === id ? { ...shot, ...patch } : shot));
      sessionStorage.setItem(HISTORY_KEY, JSON.stringify(next.slice(0, 12)));
      return next;
    });
  }

  async function api(path: string, init: RequestInit = {}) {
    const response = await fetch(path, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        "x-hf-credentials": credentials,
      },
    });
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) throw new Error(data.error || "요청에 실패했습니다.");
    return data;
  }

  async function poll(requestId: string, shotId: string, token: number) {
    let delay = 2000;
    const started = Date.now();
    while (pollToken.current === token && Date.now() - started < 12 * 60 * 1000) {
      await sleep(delay);
      if (pollToken.current !== token) return;
      const response = await fetch(`/api/status?requestId=${requestId}`, {
        headers: { "x-hf-credentials": credentials },
        cache: "no-store",
      });
      const data = (await response.json()) as {
        error?: string;
        status?: JobStatus;
        videoUrl?: string | null;
      };
      if (!response.ok) throw new Error(data.error || "상태 확인에 실패했습니다.");
      const status = data.status ?? "queued";
      updateShot(shotId, {
        status,
        videoUrl: data.videoUrl || undefined,
      });
      if (TERMINAL.has(status)) {
        if (status === "failed") setError("영상 생성에 실패했습니다. 크레딧과 프롬프트를 확인해 주세요.");
        if (status === "nsfw") setError("콘텐츠 정책에 걸려 생성이 거절되었습니다.");
        return;
      }
      delay = Math.min(delay * 1.35, 8000);
    }
  }

  async function generate() {
    setError("");
    if (!credentials.includes(":")) {
      setError("API 키를 넣어 주세요. 콘솔에서 복사한 한 줄을 그대로 붙여 넣으면 됩니다.");
      return;
    }
    if (mode === "text" && !prompt.trim()) {
      setError("영상으로 만들 문장을 입력해 주세요.");
      return;
    }
    if (mode === "image" && !image) {
      setError("이미지를 올려 주세요.");
      return;
    }

    const shot: Shot = {
      id: crypto.randomUUID(),
      mode,
      prompt: prompt.trim() || "이미지에서 영상",
      status: "queued",
      createdAt: Date.now(),
    };
    setActiveId(shot.id);
    saveHistory([shot, ...shots].slice(0, 12));
    setBusy(true);
    const token = ++pollToken.current;

    try {
      const form = new FormData();
      form.set("mode", mode);
      form.set("prompt", prompt.trim());
      form.set("duration", String(duration));
      form.set("resolution", resolution);
      form.set("aspectRatio", aspect);
      form.set("outputFormat", format);
      form.set("generateAudio", audio ? "true" : "false");
      if (image) form.set("image", image);
      if (endImage) form.set("endImage", endImage);

      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "x-hf-credentials": credentials },
        body: form,
      });
      const data = (await response.json()) as { error?: string; requestId?: string; status?: JobStatus };
      if (!response.ok || !data.requestId) {
        throw new Error(data.error || "영상을 시작하지 못했습니다.");
      }
      updateShot(shot.id, { requestId: data.requestId, status: data.status ?? "queued" });
      await poll(data.requestId, shot.id, token);
    } catch (err) {
      updateShot(shot.id, { status: "failed" });
      setError(err instanceof Error ? err.message : "영상을 만들지 못했습니다.");
    } finally {
      if (pollToken.current === token) setBusy(false);
    }
  }

  async function cancel() {
    if (!active?.requestId) return;
    try {
      await api("/api/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: active.requestId }),
      });
      pollToken.current += 1;
      updateShot(active.id, { status: "canceled" });
      setBusy(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "취소하지 못했습니다.");
    }
  }

  const prompts = mode === "text" ? TEXT_PROMPTS : IMAGE_PROMPTS;
  const running = active?.status === "queued" || active?.status === "in_progress";

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand">
          <h1>FRAME</h1>
          <p>텍스트나 이미지를 넣으면 Higgsfield가 영상을 만듭니다.</p>
        </div>
      </header>

      <section className="layout">
        <div className="card composer">
          <label className="field api-field">
            API
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={apiKey}
              placeholder="쓸 때마다 키 한 줄을 붙여 넣으세요"
              onChange={(event) => setApiKey(event.target.value)}
            />
          </label>

          <div className="modes" role="tablist" aria-label="입력 방식">
            <button type="button" className={mode === "text" ? "active" : ""} onClick={() => setMode("text")}>
              텍스트로 영상
            </button>
            <button type="button" className={mode === "image" ? "active" : ""} onClick={() => setMode("image")}>
              이미지로 영상
            </button>
          </div>

          {mode === "image" && (
            <div className="drops">
              <label className="drop">
                {imageUrl ? <img src={imageUrl} alt="시작 프레임 미리보기" /> : null}
                <span>
                  <strong>{image ? image.name : "시작 이미지"}</strong>
                  <small>JPEG, PNG, WebP, GIF · 15MB 이하</small>
                </span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  onChange={(event) => setImage(event.target.files?.[0] ?? null)}
                />
                {image && (
                  <button
                    className="ghost clear"
                    type="button"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setImage(null);
                    }}
                  >
                    제거
                  </button>
                )}
              </label>
              <label className="drop">
                {endUrl ? <img src={endUrl} alt="끝 프레임 미리보기" /> : null}
                <span>
                  <strong>{endImage ? "끝 프레임" : "끝 프레임"}</strong>
                  <small>선택 사항</small>
                </span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  onChange={(event) => setEndImage(event.target.files?.[0] ?? null)}
                />
                {endImage && (
                  <button
                    className="ghost clear"
                    type="button"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setEndImage(null);
                    }}
                  >
                    제거
                  </button>
                )}
              </label>
            </div>
          )}

          <div className="prompt-head">
            <span>{mode === "text" ? "프롬프트" : "움직임 설명"}</span>
            <span>Seedance 2.5</span>
          </div>
          <textarea
            value={prompt}
            placeholder={mode === "text" ? "어떤 장면을 찍을까요?" : "이미지가 어떻게 움직이면 좋을까요?"}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                void generate();
              }
            }}
          />
          <div className="chips">
            {prompts.map((sample) => (
              <button key={sample} type="button" onClick={() => setPrompt(sample)}>
                {sample.slice(0, 18)}…
              </button>
            ))}
          </div>

          <div className="controls">
            <div className="control-block">
              <div className="label">
                <span>길이</span>
                <span>{duration}초</span>
              </div>
              <input
                type="range"
                min={4}
                max={30}
                value={duration}
                onChange={(event) => setDuration(Number(event.target.value))}
              />
            </div>

            {mode === "text" && (
              <div className="control-block">
                <div className="label"><span>화면 비율</span></div>
                <div className="choices">
                  {ASPECTS.map((item) => (
                    <button
                      key={item}
                      type="button"
                      className={`choice ${aspect === item ? "active" : ""}`}
                      onClick={() => setAspect(item)}
                    >
                      {item}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="control-block">
              <div className="label"><span>화질 · 형식</span></div>
              <div className="choices">
                {(["480p", "720p"] as const).map((item) => (
                  <button
                    key={item}
                    type="button"
                    className={`choice ${resolution === item ? "active" : ""}`}
                    onClick={() => setResolution(item)}
                  >
                    {item}
                  </button>
                ))}
                {(["mp4", "mov"] as const).map((item) => (
                  <button
                    key={item}
                    type="button"
                    className={`choice ${format === item ? "active" : ""}`}
                    onClick={() => setFormat(item)}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>

            <label className="toggle">
              <span>소리 포함</span>
              <input type="checkbox" checked={audio} onChange={(event) => setAudio(event.target.checked)} />
            </label>
          </div>

          {error && <div className="banner" role="alert">{error}</div>}
          <div className="submit-row">
            <p>영상은 초 단위로 과금됩니다. 4–5초로 먼저 시험해 보세요. ⌘Enter로도 만들 수 있습니다.</p>
            <button className="primary large" type="button" onClick={() => void generate()} disabled={busy}>
              {busy ? "만드는 중" : "영상 만들기"}
            </button>
          </div>
        </div>

        <aside className="card stage">
          <div className="stage-head">
            <span>미리보기</span>
            {active?.videoUrl && (
              <a href={active.videoUrl} download target="_blank" rel="noreferrer">
                다운로드
              </a>
            )}
          </div>
          <div className="frame">
            {active?.videoUrl ? (
              <video key={active.videoUrl} src={active.videoUrl} controls autoPlay loop playsInline />
            ) : mode === "image" && imageUrl && !running ? (
              <img className="poster" src={imageUrl} alt="올릴 이미지" />
            ) : (
              <div className="placeholder">
                <em>{running ? "노광 중" : "아직 비어 있음"}</em>
                {running
                  ? "대기열에 들어간 뒤 영상이 돌아오면 여기에 재생됩니다."
                  : "왼쪽에서 문장이나 이미지를 넣고 영상을 만들어 보세요."}
              </div>
            )}
          </div>
          {running && (
            <div className="meter" aria-hidden="true">
              <span />
            </div>
          )}
          <div className="status-line">
            <span>
              {active ? `${STATUS_LABEL[active.status] ?? active.status} · ${active.prompt}` : "생성 전"}
            </span>
            {active?.status === "queued" && (
              <button className="text-btn" type="button" onClick={() => void cancel()}>
                취소
              </button>
            )}
          </div>
        </aside>
      </section>

      {shots.length > 0 && (
        <section className="history">
          <div className="history-head">
            <span>이번 세션</span>
            <span>{shots.length}</span>
          </div>
          <div className="strip">
            {shots.map((shot) => (
              <article key={shot.id}>
                <button className="reel" type="button" onClick={() => setActiveId(shot.id)}>
                  {shot.videoUrl ? (
                    <video src={shot.videoUrl} muted />
                  ) : (
                    <div className="empty-reel">{STATUS_LABEL[shot.status] ?? shot.status}</div>
                  )}
                  <p>{shot.prompt}</p>
                </button>
              </article>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
