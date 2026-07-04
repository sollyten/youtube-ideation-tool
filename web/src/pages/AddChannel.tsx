import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError, type ProfileData } from "../api";
import { fileToBase64 } from "../util/file";

/**
 * Add Channel wizard — follows the SPEC §2 collection order:
 * URL → near-term focus → style description → resources → competitors →
 * audience → AI-assembled preview shown for confirmation before saving.
 */
const STEPS = ["Channel", "Focus", "Style", "Resources", "Competitors", "Audience", "Confirm"];

interface ResourceDraft {
  label: string;
  type: "pasted_text" | "uploaded_file";
  content: string;
}

export function AddChannel() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const [channelUrl, setChannelUrl] = useState("");
  const [focus, setFocus] = useState("");
  const [style, setStyle] = useState("");
  const [resources, setResources] = useState<ResourceDraft[]>([]);
  const [competitors, setCompetitors] = useState<string>("");
  const [ageRanges, setAgeRanges] = useState("");
  const [countries, setCountries] = useState("");

  const [preview, setPreview] = useState<{ slug: string; data: ProfileData; warnings: string[] } | null>(null);

  const next = () => setStep((s) => Math.min(s + 1, STEPS.length - 1));
  const back = () => setStep((s) => Math.max(s - 1, 0));

  const buildPreview = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await api.previewProfile({
        channel_url: channelUrl,
        focus_statement: focus,
        user_style_description: style,
        resources,
        competitors: competitors
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean)
          .map((url) => ({ url })),
        audience: {
          age_ranges: ageRanges.split(",").map((s) => s.trim()).filter(Boolean),
          top_countries: countries.split(",").map((s) => s.trim()).filter(Boolean),
        },
      });
      setPreview(result);
      next();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Preview failed");
    } finally {
      setBusy(false);
    }
  };

  const save = async (overwrite = false) => {
    if (!preview) return;
    setBusy(true);
    setError("");
    try {
      const saved = await api.saveProfile({ slug: preview.slug, data: preview.data, overwrite });
      navigate(`/channels/${saved.profile.id}`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && !overwrite) {
        if (confirm("You already have a profile for this channel. Overwrite it?")) {
          await save(true);
          return;
        }
      } else {
        setError(err instanceof ApiError ? err.message : "Save failed");
      }
    } finally {
      setBusy(false);
    }
  };

  const addResource = () => setResources((r) => [...r, { label: "", type: "pasted_text", content: "" }]);

  const uploadResourceFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const data = await fileToBase64(file);
      const { text } = await api.extractText({ filename: file.name, media_type: file.type, data });
      setResources((r) => [...r, { label: file.name, type: "uploaded_file", content: text }]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not extract text from that file");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ maxWidth: 620 }}>
      <h1>Add channel</h1>
      <div className="steps">
        {STEPS.map((s, i) => (
          <span key={s} className={i <= step ? "done" : ""} title={s} />
        ))}
      </div>
      {error && <p className="error">{error}</p>}

      {step === 0 && (
        <div>
          <label className="field">
            <span>Channel URL or @handle</span>
            <input
              type="text"
              value={channelUrl}
              onChange={(e) => setChannelUrl(e.target.value)}
              placeholder="https://youtube.com/@yourchannel"
              autoFocus
            />
            <p className="hint">We'll pull stats and the last 50 videos from YouTube.</p>
          </label>
          <button className="btn btn-primary" onClick={next} disabled={channelUrl.trim().length < 3}>
            Continue
          </button>
        </div>
      )}

      {step === 1 && (
        <div>
          <label className="field">
            <span>What is your catalogue steering toward in the near future?</span>
            <textarea
              value={focus}
              onChange={(e) => setFocus(e.target.value)}
              placeholder="e.g. Shifting from WW2 vehicles toward Nazi-era escape/manhunt stories with a true-crime tension."
              autoFocus
            />
            <p className="hint">
              Weighted most heavily in every ideation run. You can edit this any time from the
              channel page — focus changes often.
            </p>
          </label>
          <div className="row">
            <button className="btn btn-ghost" onClick={back}>Back</button>
            <button className="btn btn-primary" onClick={next} disabled={!focus.trim()}>Continue</button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div>
          <label className="field">
            <span>Describe the channel's style in your own words</span>
            <textarea
              value={style}
              onChange={(e) => setStyle(e.target.value)}
              placeholder="Voice, pacing, structure — whatever makes it yours."
              autoFocus
            />
            <p className="hint">Treated as ground truth, above anything the AI infers.</p>
          </label>
          <div className="row">
            <button className="btn btn-ghost" onClick={back}>Back</button>
            <button className="btn btn-primary" onClick={next} disabled={!style.trim()}>Continue</button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div>
          <p className="muted" style={{ marginBottom: 14 }}>
            Optional steering material: planned ideas, brand rules, banned topics. Paste text below —
            each entry becomes an editable resource.
          </p>
          <div className="stack">
            {resources.map((r, i) => (
              <div className="card" key={i}>
                <label className="field">
                  <span>Label</span>
                  <input
                    type="text"
                    value={r.label}
                    placeholder="e.g. Q3 planned videos"
                    onChange={(e) =>
                      setResources((rs) => rs.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))
                    }
                  />
                </label>
                <label className="field" style={{ marginBottom: 8 }}>
                  <span>Content</span>
                  <textarea
                    value={r.content}
                    onChange={(e) =>
                      setResources((rs) => rs.map((x, j) => (j === i ? { ...x, content: e.target.value } : x)))
                    }
                  />
                </label>
                <button className="btn btn-ghost" onClick={() => setResources((rs) => rs.filter((_, j) => j !== i))}>
                  Remove
                </button>
              </div>
            ))}
          </div>
          <div className="row" style={{ marginTop: 14, flexWrap: "wrap" }}>
            <button className="btn btn-ghost" onClick={back}>Back</button>
            <button className="btn" onClick={addResource}>Paste text</button>
            <label className="btn" style={{ cursor: "pointer" }}>
              {busy ? <span className="spinner" /> : "Upload file"}
              <input
                type="file"
                accept=".txt,.md,.pdf,.docx,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                onChange={uploadResourceFile}
                style={{ display: "none" }}
              />
            </label>
            <button className="btn btn-primary" onClick={next}>Continue</button>
          </div>
          <p className="hint" style={{ marginTop: 8 }}>PDF, DOCX, or plain text — the text is extracted and stored.</p>
        </div>
      )}

      {step === 4 && (
        <div>
          <label className="field">
            <span>Competitor channels (one URL per line)</span>
            <textarea
              value={competitors}
              onChange={(e) => setCompetitors(e.target.value)}
              placeholder={"https://youtube.com/@channel1\nhttps://youtube.com/@channel2"}
              autoFocus
            />
            <p className="hint">
              The channels your audience also watches. Used by both ideation and competitor analysis.
            </p>
          </label>
          <div className="row">
            <button className="btn btn-ghost" onClick={back}>Back</button>
            <button className="btn btn-primary" onClick={next}>Continue</button>
          </div>
        </div>
      )}

      {step === 5 && (
        <div>
          <p className="muted" style={{ marginBottom: 14 }}>
            From YouTube Studio → Audience.
          </p>
          <label className="field">
            <span>Top 3 age brackets (comma separated)</span>
            <input
              type="text"
              value={ageRanges}
              onChange={(e) => setAgeRanges(e.target.value)}
              placeholder="25-34, 18-24, 35-44"
              autoFocus
            />
          </label>
          <label className="field">
            <span>Top countries (comma separated)</span>
            <input
              type="text"
              value={countries}
              onChange={(e) => setCountries(e.target.value)}
              placeholder="United States, United Kingdom, Germany"
            />
          </label>
          <div className="row">
            <button className="btn btn-ghost" onClick={back}>Back</button>
            <button className="btn btn-primary" onClick={buildPreview} disabled={busy || !ageRanges.trim()}>
              {busy ? <span className="spinner" /> : "Build profile"}
            </button>
          </div>
          {busy && (
            <p className="muted" style={{ marginTop: 12 }}>
              Fetching channel data and inferring the profile — this takes a moment.
            </p>
          )}
        </div>
      )}

      {step === 6 && preview && (
        <div>
          <p className="muted" style={{ marginBottom: 14 }}>
            Review the assembled profile. Nothing is saved until you confirm.
          </p>
          {preview.warnings.map((w) => (
            <p className="error" key={w}>{w}</p>
          ))}
          <div className="card stack">
            <div><strong>{preview.data.channel_name}</strong> <span className="muted">({preview.slug})</span></div>
            <div><span className="muted">Niche:</span> {preview.data.niche}</div>
            <div><span className="muted">Format:</span> {preview.data.format_style}</div>
            <div><span className="muted">Tone:</span> {preview.data.tone}</div>
            <div><span className="muted">House style:</span> {preview.data.house_style_notes}</div>
            <div><span className="muted">Focus:</span> {preview.data.focus.statement}</div>
            <div>
              <span className="muted">Competitors:</span>{" "}
              {preview.data.competitors.map((c) => c.name).join(", ") || "none"}
            </div>
            <div>
              <span className="muted">Stats:</span>{" "}
              {preview.data.stats.subscriber_count.toLocaleString()} subs · median{" "}
              {preview.data.stats.median_views.toLocaleString()} views
            </div>
          </div>
          <div className="row" style={{ marginTop: 16 }}>
            <button className="btn btn-ghost" onClick={back}>Back</button>
            <button className="btn btn-primary" onClick={() => save()} disabled={busy}>
              {busy ? <span className="spinner" /> : "Save channel"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
