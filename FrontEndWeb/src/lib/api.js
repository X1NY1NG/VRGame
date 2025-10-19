const API_BASE = process.env.REACT_APP_API_BASE || "http://localhost:4000";

export async function createAvatar({ photo, nric, gender, relationship, name }) {
  const fd = new FormData();
  fd.append("photo", photo);
  fd.append("nric", nric);
  fd.append("gender", gender);
  if (relationship) fd.append("relationship", relationship); // NEW
  fd.append("name", name); // NEW

  const resp = await fetch(`${API_BASE}/api/avatars/from-image`, { method: "POST", body: fd });
  const json = await resp.json();
  if (!resp.ok || !json.ok) throw new Error(json.error || "Server error");

  const avatarId = json.avatarId || json.glbUrl?.split("/").pop()?.replace(".glb", "");
  const pngUrl = avatarId ? `https://models.readyplayer.me/${avatarId}.png` : null;
  return { ...json, avatarId, pngUrl };
}

export async function uploadWalls({ nric, left, front, right }) {
  const fd = new FormData();
  fd.append("nric", nric);
  fd.append("left", left);
  fd.append("front", front);
  fd.append("right", right);

  const resp = await fetch(`${API_BASE}/api/walls/upload`, { method: "POST", body: fd });
  const json = await resp.json();
  if (!resp.ok || !json.ok) throw new Error(json.error || "Server error");
  return json;
}

export async function uploadGallery({ nric, photos }) {
  const fd = new FormData();
  fd.append("nric", nric);
  photos.forEach((file, idx) => fd.append("photos[]", file, file.name || `photo_${idx}.jpg`));

  const resp = await fetch(`${API_BASE}/api/gallery/upload`, { method: "POST", body: fd });
  const json = await resp.json();
  if (!resp.ok || !json.ok) throw new Error(json.error || "Server error");
  return json;
}
