import { useState } from "react";
import { api, ApiError, type Profile } from "../api";
import { fileToBase64 } from "../util/file";

interface Resource {
  id?: string;
  label: string;
  type: "pasted_text" | "uploaded_file";
  content: string;
  added_at?: string;
}
interface Competitor {
  name: string;
  url: string;
  channel_id: string;
}

/**
 * Channel Details tab: read-only AUTO fields plus editable/removable resources,
 * competitors, and audience (SPEC §2 Req #3 & #4 — "Editable/removable in UI").
 */
export function DetailsTab({ profile, onSaved }: { profile: Profile; onSaved: (p: Profile) => void }) {
  const d = profile.data;
  const ro = profile.readOnly;
  const [resources, setResources] = useState<Resource[]>((d.resources as Resource[]) ?? []);
  const [competitors, setCompetitors] = useState<Competitor[]>(d.competitors ?? []);
  const [ages, setAges] = useState((d.audience?.age_ranges ?? []).join(", "));
  const [countries, setCountries] = useState((d.audience?.top_countries ?? []).join(", "));
  const [newCompetitor, setNewCompetitor] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const flash = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const save = async (patch: Record<string, unknown>) => {
    setBusy(true);
    setError("");
    try {
      const updated = await api.patchProfile(profile.id, patch);
      onSaved(updated.profile);
      flash();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const uploadFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const data = await fileToBase64(file);
      const { text } = await api.extractText({ filename: file.name, media_type: file.type, data });
      const next = [...resources, { label: file.name, type: "uploaded_file" as const, content: text }];
      setResources(next);
      await save({ resources: next });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not extract file text");
      setBusy(false);
    }
  };

  const addCompetitor = async () => {
    if (!newCompetitor.trim()) return;
    setBusy(true);
    setError("");
    try {
      const resolved = await api.resolveChannel(newCompetitor.trim());
      const next = [...competitors, resolved];
      setCompetitors(next);
      setNewCompetitor("");
      await save({ competitors: next });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not resolve that channel");
      setBusy(false);
    }
  };

  return (
    <div>
      {error && <p className="error">{error}</p>}
      {saved && <p className="muted" style={{ color: "var(--accent)" }}>Saved ✓</p>}

      <h2>Channel profile (auto-derived)</h2>
      <div className="card stack">
        <div><span className="muted">Niche:</span> {d.niche}</div>
        <div><span className="muted">Style (your words):</span> {d.user_style_description}</div>
        <div><span className="muted">Format:</span> {d.format_style}</div>
        <div><span className="muted">Tone:</span> {d.tone}</div>
        <div><span className="muted">House style:</span> {d.house_style_notes}</div>
      </div>

      <h2>Resources</h2>
      <div className="stack">
        {resources.length === 0 && <p className="muted">None yet.</p>}
        {resources.map((r, i) => (
          <div className="card" key={r.id ?? i}>
            <div className="row spread">
              <div className="row" style={{ gap: 8 }}>
                <strong>{r.label || "(untitled)"}</strong>
                <span className="pill">{r.type === "uploaded_file" ? "file" : "text"}</span>
              </div>
              {!ro && (
                <button
                  className="btn btn-ghost"
                  onClick={() => {
                    const next = resources.filter((_, j) => j !== i);
                    setResources(next);
                    void save({ resources: next });
                  }}
                >
                  Remove
                </button>
              )}
            </div>
            {!ro ? (
              <textarea
                value={r.content}
                onChange={(e) =>
                  setResources((rs) => rs.map((x, j) => (j === i ? { ...x, content: e.target.value } : x)))
                }
                onBlur={() => save({ resources })}
                style={{ marginTop: 8 }}
              />
            ) : (
              <p className="muted" style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>{r.content.slice(0, 400)}</p>
            )}
          </div>
        ))}
      </div>
      {!ro && (
        <div className="row" style={{ marginTop: 10, flexWrap: "wrap" }}>
          <button
            className="btn"
            onClick={() => {
              const next = [...resources, { label: "New note", type: "pasted_text" as const, content: "" }];
              setResources(next);
            }}
          >
            Add text
          </button>
          <label className="btn" style={{ cursor: "pointer" }}>
            {busy ? <span className="spinner" /> : "Upload file"}
            <input
              type="file"
              accept=".txt,.md,.pdf,.docx,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={uploadFile}
              style={{ display: "none" }}
            />
          </label>
        </div>
      )}

      <h2>Competitors</h2>
      <div className="stack">
        {competitors.length === 0 && <p className="muted">None yet.</p>}
        {competitors.map((c, i) => (
          <div className="card row spread" key={c.channel_id || c.url || i}>
            <div>
              <strong>{c.name}</strong>
              <div className="muted" style={{ fontSize: 12 }}>{c.url}{c.channel_id ? "" : " · unresolved"}</div>
            </div>
            {!ro && (
              <button
                className="btn btn-ghost"
                onClick={() => {
                  const next = competitors.filter((_, j) => j !== i);
                  setCompetitors(next);
                  void save({ competitors: next });
                }}
              >
                Remove
              </button>
            )}
          </div>
        ))}
      </div>
      {!ro && (
        <div className="row" style={{ marginTop: 10 }}>
          <input
            type="text"
            value={newCompetitor}
            onChange={(e) => setNewCompetitor(e.target.value)}
            placeholder="https://youtube.com/@competitor"
          />
          <button className="btn" onClick={addCompetitor} disabled={busy || !newCompetitor.trim()}>
            {busy ? <span className="spinner" /> : "Add"}
          </button>
        </div>
      )}

      <h2>Audience</h2>
      {ro ? (
        <div className="card stack">
          <div><span className="muted">Ages:</span> {d.audience?.age_ranges?.join(", ")}</div>
          <div><span className="muted">Countries:</span> {d.audience?.top_countries?.join(", ")}</div>
        </div>
      ) : (
        <div className="card">
          <label className="field">
            <span>Top age brackets (comma separated)</span>
            <input type="text" value={ages} onChange={(e) => setAges(e.target.value)} />
          </label>
          <label className="field" style={{ marginBottom: 8 }}>
            <span>Top countries (comma separated)</span>
            <input type="text" value={countries} onChange={(e) => setCountries(e.target.value)} />
          </label>
          <button
            className="btn"
            disabled={busy}
            onClick={() =>
              save({
                audience: {
                  age_ranges: ages.split(",").map((s) => s.trim()).filter(Boolean),
                  top_countries: countries.split(",").map((s) => s.trim()).filter(Boolean),
                },
              })
            }
          >
            Save audience
          </button>
        </div>
      )}
    </div>
  );
}
