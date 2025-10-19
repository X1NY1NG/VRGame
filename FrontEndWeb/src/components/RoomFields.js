import { useEffect, useState } from "react";

const thumbStyle = {
  width: 220, height: 140, objectFit: "cover",
  borderRadius: 8, border: "1px solid #ddd"
};

function usePreview(file) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    if (!file) return setUrl(null);
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  return url;
}

export default function RoomFields({ left, setLeft, front, setFront, right, setRight }) {
  const leftUrl = usePreview(left);
  const frontUrl = usePreview(front);
  const rightUrl = usePreview(right);

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <label>
        Left wall:&nbsp;
        <input type="file" accept="image/*" onChange={(e) => setLeft(e.target.files?.[0] || null)} required />
      </label>
      {leftUrl && <img src={leftUrl} alt="left preview" style={thumbStyle} />}

      <label>
        Front wall:&nbsp;
        <input type="file" accept="image/*" onChange={(e) => setFront(e.target.files?.[0] || null)} required />
      </label>
      {frontUrl && <img src={frontUrl} alt="front preview" style={thumbStyle} />}

      <label>
        Right wall:&nbsp;
        <input type="file" accept="image/*" onChange={(e) => setRight(e.target.files?.[0] || null)} required />
      </label>
      {rightUrl && <img src={rightUrl} alt="right preview" style={thumbStyle} />}
    </div>
  );
}
