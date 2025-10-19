// UpdateAvatar.js
import React, { useState } from "react";
import { AvatarCreator } from "@readyplayerme/react-avatar-creator";

const API_BASE = process.env.REACT_APP_API_BASE || "http://localhost:4000";

export default function UpdateAvatar() {
  const [nric, setNric] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [avatarId, setAvatarId] = useState("");  // fetched from Firebase
  const [avatarUrl, setAvatarUrl] = useState(null);

  const subdomain = "healthcareforelderly"; // <-- replace with your RPM Studio subdomain

  async function fetchByNric(e) {
  e.preventDefault();
  setError("");
  setLoading(true);
  try {
    const r = await fetch(`${API_BASE}/api/users/${encodeURIComponent(nric)}`);
    const j = await r.json();   // now this will be valid JSON
    if (!r.ok || !j.ok) throw new Error(j.error || `lookup failed (${r.status})`);
    setAvatarId(j.data.avatarId);
    setAvatarUrl(j.data.lastAvatarUrl || null);
  } catch (err) {
    setError(err.message || "Lookup failed");
  } finally {
    setLoading(false);
  }
}

  // Fired when user clicks "Done" in the RPM editor
  function handleAvatarExported(event) {
    const { url, avatarId: newId } = event.data || {};
    if (!nric) return; // ensure NRIC was loaded

    // 1) Update avatarId (authoritative)
    fetch(`/api/users/${encodeURIComponent(nric)}/avatar-id`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatarId: newId }),
    }).catch(() => {});

    // 2) Update lastAvatarUrl (handy for preview/Unity)
    fetch(`/api/users/${encodeURIComponent(nric)}/avatar-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatarUrl: url }),
    }).catch(() => {});

    // local UI update
    setAvatarUrl(url);
    setAvatarId(newId);
  }


  const config = {
    clearCache: true,
    bodyType: "fullbody",
    avatarId: avatarId || undefined, // preloads existing avatar when found
  };

  return (
    <div style={{ padding: "1rem" }}>
      <h2>Update Avatar Outfit</h2>

      {/* NRIC lookup */}
      <form onSubmit={fetchByNric} style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <input
          type="text"
          placeholder="Enter NRIC"
          value={nric}
          onChange={(e) => setNric(e.target.value)}
          style={{ padding: 8, minWidth: 260 }}
        />
        <button type="submit" disabled={loading || !nric}>
          {loading ? "Loading..." : "Load Avatar"}
        </button>
      </form>
      {error && <div style={{ color: "crimson", marginBottom: 12 }}>{error}</div>}

      {/* Only render the editor after we have the avatarId */}
      {avatarId ? (
        <>
          <div style={{ width: "100%", height: "75vh" }}>
            <AvatarCreator
              subdomain={subdomain}
              config={config}
              style={{ width: "100%", height: "100%", border: "none" }}
              onAvatarExported={handleAvatarExported}
            />
          </div>

          {avatarUrl && (
            <div style={{ marginTop: 12 }}>
              <h4>Updated Avatar Preview</h4>
              <model-viewer
                src={avatarUrl}
                alt="Updated avatar"
                auto-rotate
                camera-controls
                style={{ width: 320, height: 420 }}
              />
              <div style={{ fontSize: 12, marginTop: 6, wordBreak: "break-all" }}>
                {avatarUrl}
              </div>
            </div>
          )}
        </>
      ) : (
        <div style={{ color: "#666" }}>Enter an NRIC and click <b>Load Avatar</b>.</div>
      )}
    </div>
  );
}
