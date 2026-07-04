import { useState } from "react";
import { api, ApiError, type Profile } from "../api";

/** Retention Lab — API path (owned video id) or image path (screenshot upload). */
export function RetentionTab({ profile }: { profile: Profile }) {
  const [mode, setMode] = useState<"image" | "api">("image");
  const [title, setTitle] = useState("");
  const [length, setLength] = useState("");
  const [videoId, setVideoId] = useState("");
  const [image, setImage] = useState<{ data: string; media_type: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [analysis, setAnalysis] = useState<any>(null);
  const [summary, setSummary] = useState("");

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const data = result.split(",")[1];
      setImage({ data, media_type: file.type });
    };
    reader.readAsDataURL(file);
  };

  const run = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await api.retentionLab(profile.id, {
        video_title: title,
        video_length: length || undefined,
        video_id: mode === "api" ? videoId : undefined,
        image: mode === "image" && image ? image : undefined,
      });
      setAnalysis(result.analysis);
      setSummary(result.summary);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Analysis failed");
    } finally {
      setBusy(false);
    }
  };

  const canRun = title.trim() && (mode === "image" ? image : videoId.trim());

  return (
    <div>
      <p className="muted" style={{ marginTop: 0 }}>
        Second-by-second retention analysis, reasoned from the in-house framework.
      </p>
      <div className="row" style={{ gap: 8, marginBottom: 16 }}>
        <button className={`btn ${mode === "image" ? "btn-primary" : ""}`} onClick={() => setMode("image")}>
          Screenshot
        </button>
        <button className={`btn ${mode === "api" ? "btn-primary" : ""}`} onClick={() => setMode("api")}>
          Owned video (API)
        </button>
      </div>

      <label className="field">
        <span>Video title</span>
        <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="field">
        <span>Video length (optional)</span>
        <input type="text" value={length} onChange={(e) => setLength(e.target.value)} placeholder="18:42" />
      </label>

      {mode === "image" ? (
        <label className="field">
          <span>Retention graph screenshot</span>
          <input type="file" accept="image/png,image/jpeg,image/webp" onChange={onFile} />
          <p className="hint">Timestamps will be approximate when read from an image.</p>
        </label>
      ) : (
        <label className="field">
          <span>Owned video ID</span>
          <input type="text" value={videoId} onChange={(e) => setVideoId(e.target.value)} placeholder="dQw4w9WgXcQ" />
          <p className="hint">Requires this channel's analytics to be connected.</p>
        </label>
      )}

      {error && <p className="error">{error}</p>}
      <button className="btn btn-primary" onClick={run} disabled={!canRun || busy}>
        {busy ? (<><span className="spinner" /> Analyzing…</>) : "Analyze retention"}
      </button>

      {analysis && (
        <div style={{ marginTop: 24 }}>
          <div className="card" style={{ marginBottom: 16 }}>
            <div><span className="muted">Chart type:</span> {analysis.overall?.chart_type}</div>
            <div><span className="muted">Journey pattern:</span> {analysis.overall?.journey_pattern}</div>
            <div><span className="muted">Top-level fix:</span> {analysis.overall?.top_level_fix}</div>
          </div>

          <h2>Sections</h2>
          <div className="stack">
            {(analysis.sections ?? []).map((s: any, i: number) => (
              <div className="card" key={i}>
                <div className="row spread">
                  <strong>{s.timespan}</strong>
                  <span className="pill">{s.note_type}</span>
                </div>
                <p style={{ margin: "6px 0" }}><span className="muted">{s.pattern}</span> — {s.curve_behaviour}</p>
                <p style={{ margin: "0 0 6px" }} className="muted">Cause: {s.likely_cause}</p>
                <p style={{ margin: 0 }}>Fix: {s.fix}</p>
              </div>
            ))}
          </div>

          <h2>Top fixes</h2>
          <div className="card stack">
            {(analysis.top_fixes ?? []).map((f: string, i: number) => (
              <div key={i}>{i + 1}. {f}</div>
            ))}
          </div>

          <h2>Next-video rules</h2>
          <div className="card stack">
            {(analysis.next_video_rules ?? []).map((r: string, i: number) => (
              <div key={i}>• {r}</div>
            ))}
          </div>
          {summary && <p className="muted" style={{ marginTop: 12 }}>{summary}</p>}
        </div>
      )}
    </div>
  );
}
