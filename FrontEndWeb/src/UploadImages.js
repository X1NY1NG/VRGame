import { useState } from "react";

const API_BASE = process.env.REACT_APP_API_BASE || "http://localhost:4000";

export default function App() {
  const [nric, setNric] = useState("");
  const [left, setLeft] = useState(null);
  const [front, setFront] = useState(null);
  const [right, setRight] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!nric || !left || !front || !right) {
      setError("Please provide NRIC and all three images.");
      return;
    }
    setError(""); setResult(null); setLoading(true);

    try {
      const fd = new FormData();
      fd.append("nric", nric);
      fd.append("left", left);
      fd.append("front", front);
      fd.append("right", right);

      const resp = await fetch(`${API_BASE}/api/walls/upload`, {
        method: "POST",
        body: fd,
      });
      const json = await resp.json();
      if (!resp.ok || !json.ok) throw new Error(json.error || "Server error");

      // json will include public (or signed) URLs for each wall
      setResult(json);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: 720, margin: "2rem auto", fontFamily: "Inter, system-ui, sans-serif" }}>
      <h2>Upload Wall Photos (Left, Front, Right)</h2>

      <form onSubmit={handleSubmit} style={{ display: "grid", gap: 12 }}>
        <label>
          NRIC:&nbsp;
          <input value={nric} onChange={e => setNric(e.target.value)} required />
        </label>

        <label>Left wall: <input type="file" accept="image/*" onChange={e => setLeft(e.target.files?.[0] || null)} required /></label>
        <label>Front wall: <input type="file" accept="image/*" onChange={e => setFront(e.target.files?.[0] || null)} required /></label>
        <label>Right wall: <input type="file" accept="image/*" onChange={e => setRight(e.target.files?.[0] || null)} required /></label>

        <button type="submit" disabled={loading}>{loading ? "Uploading…" : "Save Walls"}</button>
      </form>

      {error && <p style={{ color: "crimson" }}>{error}</p>}

      {result && (
        <div style={{ marginTop: 16 }}>
          <h3>Saved</h3>
          <p><strong>NRIC:</strong> {result.nric}</p>
          <ul>
            <li>Left: <a href={result.urls.left} target="_blank" rel="noreferrer">Open</a></li>
            <li>Front: <a href={result.urls.front} target="_blank" rel="noreferrer">Open</a></li>
            <li>Right: <a href={result.urls.right} target="_blank" rel="noreferrer">Open</a></li>
          </ul>
        </div>
      )}
    </div>
  );
}