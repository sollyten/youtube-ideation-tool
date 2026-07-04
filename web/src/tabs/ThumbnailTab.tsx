import { useEffect, useState } from "react";
import { api, ApiError } from "../api";

/**
 * Thumbnail Lab tab — ISOLATED. It receives only the slug (a visual-store key),
 * never the strategic profile. It talks solely to /api/thumbnail-lab.
 */
export function ThumbnailTab({ slug, readOnly }: { slug: string; readOnly: boolean }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.thumbnail.get>> | null>(null);
  const [styleText, setStyleText] = useState("");
  const [negatives, setNegatives] = useState("");
  const [request, setRequest] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [latest, setLatest] = useState<{ images: string[]; promptUsed: string; styleLocked: string } | null>(null);

  const load = () =>
    api.thumbnail
      .get(slug)
      .then((d) => {
        setData(d);
        setStyleText(JSON.stringify(d.style.descriptor, null, 2));
        setNegatives(d.style.negativeStyle.join(", "));
      })
      .catch((e) => setError(e.message));
  useEffect(() => {
    void load();
  }, [slug]);

  const saveStyle = async () => {
    setError("");
    try {
      const descriptor = styleText.trim() ? JSON.parse(styleText) : {};
      await api.thumbnail.saveStyle(
        slug,
        descriptor,
        negatives.split(",").map((s) => s.trim()).filter(Boolean),
      );
      await load();
    } catch (err) {
      setError(err instanceof SyntaxError ? "Style descriptor must be valid JSON" : (err as Error).message);
    }
  };

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const b64 = (reader.result as string).split(",")[1];
      try {
        await api.thumbnail.addReference(slug, {
          filename: file.name,
          note: "",
          media_type: file.type,
          data: b64,
        });
        await load();
      } catch (err) {
        setError((err as Error).message);
      }
    };
    reader.readAsDataURL(file);
  };

  const generate = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await api.thumbnail.generate(slug, request);
      setLatest(result);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Generation failed");
    } finally {
      setBusy(false);
    }
  };

  if (!data) return <p className="muted"><span className="spinner" /> Loading…</p>;

  return (
    <div>
      <p className="muted" style={{ marginTop: 0 }}>
        Isolated visual module — Higgsfield only. No strategy, memory, or profile data crosses in here.
      </p>

      <h2>Visual style</h2>
      <label className="field">
        <span>Style descriptor (JSON)</span>
        <textarea value={styleText} onChange={(e) => setStyleText(e.target.value)} rows={8} disabled={readOnly} />
        <p className="hint">Composition, palette, lighting, typography, subject treatment, mood, brand mark.</p>
      </label>
      <label className="field">
        <span>Avoid (comma separated)</span>
        <input type="text" value={negatives} onChange={(e) => setNegatives(e.target.value)} disabled={readOnly} />
      </label>
      {!readOnly && <button className="btn" onClick={saveStyle}>Save style</button>}

      <h2>Reference thumbnails</h2>
      {data.references.length === 0 ? (
        <p className="muted">None yet.</p>
      ) : (
        <div className="chips" style={{ marginBottom: 10 }}>
          {data.references.map((r) => (
            <span className="chip" key={r.id}>{r.filename}</span>
          ))}
        </div>
      )}
      {!readOnly && <input type="file" accept="image/png,image/jpeg,image/webp" onChange={onFile} />}

      <h2>Generate</h2>
      <label className="field">
        <span>Request</span>
        <input
          type="text"
          value={request}
          onChange={(e) => setRequest(e.target.value)}
          placeholder="thumbnail for a video on the ratlines out of Europe"
          disabled={readOnly}
        />
      </label>
      {error && <p className="error">{error}</p>}
      {!readOnly && (
        <button className="btn btn-primary" onClick={generate} disabled={!request.trim() || busy}>
          {busy ? (<><span className="spinner" /> Generating…</>) : "Generate thumbnail"}
        </button>
      )}

      {latest && (
        <div style={{ marginTop: 20 }}>
          <div className="thumb-grid">
            {latest.images.map((src, i) => (
              <img src={src} key={i} alt="generated thumbnail" />
            ))}
          </div>
          <p className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>{latest.styleLocked}</p>
          <p className="muted" style={{ fontSize: 12.5 }}>Prompt: {latest.promptUsed}</p>
        </div>
      )}

      {data.generations.length > 0 && (
        <>
          <h2>Recent generations</h2>
          <div className="thumb-grid">
            {data.generations.flatMap((g) =>
              (g.result.images ?? []).map((src, i) => <img src={src} key={g.id + i} alt={g.request} />),
            )}
          </div>
        </>
      )}
    </div>
  );
}
