import { useMemo, useState } from "react";

const API_BASE = process.env.REACT_APP_API_BASE || "http://localhost:4000";

export default function App() {
  const [nric, setNric] = useState("");
  const [photos, setPhotos] = useState([]); // File[]
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  const previews = useMemo(
    () => photos.map((f) => URL.createObjectURL(f)),
    [photos]
  );

  function handlePick(e) {
    const files = Array.from(e.target.files || []);
    // Keep first 6 only, filter out non-images
    const imgs = files.filter((f) => f.type.startsWith("image/")).slice(0, 6);
    setPhotos(imgs);
  }

  function removeAt(i) {
    setPhotos((arr) => arr.filter((_, idx) => idx !== i));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!nric) return setError("Please provide NRIC.");
    if (photos.length < 1)
        return setError("Please select at least 1 image for the gallery.");
    if (photos.length > 6)
        return setError("You can upload a maximum of 6 images.");

    setError("");
    setResult(null);
    setLoading(true);

    try {
      const fd = new FormData();
      fd.append("nric", nric);
      // backend expects an array field named "photos[]"
      photos.forEach((file, idx) => fd.append("photos[]", file, file.name || `photo_${idx}.jpg`));

      const resp = await fetch(`${API_BASE}/api/gallery/upload`, {
        method: "POST",
        body: fd,
      });
      const json = await resp.json();
      if (!resp.ok || !json.ok) throw new Error(json.error || "Server error");
      // Expect: { ok:true, nric:"...", urls: [ ...6 urls... ] }
      setResult(json);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: 800, margin: "2rem auto", fontFamily: "Inter, system-ui, sans-serif" }}>
      <h2>Upload Gallery (6 photos)</h2>

      <form onSubmit={handleSubmit} style={{ display: "grid", gap: 12 }}>
        <label>
          NRIC:&nbsp;
          <input value={nric} onChange={(e) => setNric(e.target.value)} required />
        </label>

        <div>
          <label style={{ display: "block", marginBottom: 6 }}>
            Select 6 images:
          </label>
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={handlePick}
          />
          <small style={{ display: "block", opacity: 0.75 }}>
            Tip: you can Cmd/Ctrl-click to select multiple. Only the first 6 images are kept.
          </small>
        </div>

        {photos.length > 0 && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
              gap: 12,
              marginTop: 8,
            }}
          >
            {photos.map((file, i) => (
              <div
                key={i}
                style={{
                  border: "1px solid #ddd",
                  borderRadius: 8,
                  padding: 8,
                }}
              >
                <img
                  alt={`preview ${i + 1}`}
                  src={previews[i]}
                  style={{ width: "100%", height: 140, objectFit: "cover", borderRadius: 6 }}
                />
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
                  <small style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 180 }}>
                    {file.name}
                  </small>
                  <button type="button" onClick={() => removeAt(i)} style={{ border: "none", background: "transparent", color: "#c00", cursor: "pointer" }}>
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <button type="submit" disabled={loading}>
          {loading ? "Uploading…" : `Save Gallery (${photos.length}/6)`}
        </button>
      </form>

      {error && <p style={{ color: "crimson", marginTop: 12 }}>{error}</p>}

      {result && (
        <div style={{ marginTop: 16 }}>
          <h3>Saved</h3>
          <p><strong>NRIC:</strong> {result.nric}</p>
          <ol>
            {Array.isArray(result.urls) &&
              result.urls.map((u, i) => (
                <li key={i}>
                  Photo {i + 1}: <a href={u} target="_blank" rel="noreferrer">Open</a>
                </li>
              ))}
          </ol>
        </div>
      )}
    </div>
  );
}