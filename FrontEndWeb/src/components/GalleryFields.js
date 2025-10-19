import { useEffect, useState } from "react";

const gridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
  gap: 12,
  marginTop: 8,
};
const cardStyle = { border: "1px solid #ddd", borderRadius: 8, padding: 8 };
const rowStyle = { display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 };
const nameStyle = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 180 };
const removeBtnStyle = { border: "none", background: "transparent", color: "#c00", cursor: "pointer" };

export default function GalleryFields({ photos, setPhotos }) {
  const [previews, setPreviews] = useState([]);

  useEffect(() => {
    const urls = photos.map((f) => URL.createObjectURL(f));
    setPreviews(urls);
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [photos]);

  function onPick(e) {
    const files = Array.from(e.target.files || []);
    const imgs = files.filter((f) => f.type.startsWith("image/")).slice(0, 6);
    setPhotos(imgs);
  }

  function removeAt(i) {
    setPhotos((arr) => arr.filter((_, idx) => idx !== i));
  }

  return (
    <>
      <div>
        <label style={{ display: "block", marginBottom: 6 }}>
          Select up to 6 images:
        </label>
        <input type="file" accept="image/*" multiple onChange={onPick} />
        <small style={{ display: "block", opacity: 0.75 }}>
          Tip: Cmd/Ctrl-click to select multiple. Only the first 6 images are kept.
        </small>
      </div>

      {photos.length > 0 && (
        <div style={gridStyle}>
          {photos.map((file, i) => (
            <div key={i} style={cardStyle}>
              <img
                alt={`preview ${i + 1}`}
                src={previews[i]}
                style={{ width: "100%", height: 140, objectFit: "cover", borderRadius: 6 }}
              />
              <div style={rowStyle}>
                <small style={nameStyle}>{file.name}</small>
                <button type="button" onClick={() => removeAt(i)} style={removeBtnStyle}>
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
