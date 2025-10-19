import { useEffect, useState } from "react";

export default function AvatarFields({ gender, setGender, file, setFile, relationship, setRelationship }) {
  const [preview, setPreview] = useState(null);

  useEffect(() => {
    if (!file) return setPreview(null);
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  return (
    <>
      {/* Gender selection */}
      <div style={{ marginBottom: 12 }}>
        <span>Gender:&nbsp;</span>
        <label style={{ marginRight: 12 }}>
          <input
            type="radio"
            name="gender"
            value="male"
            checked={gender === "male"}
            onChange={(e) => setGender(e.target.value)}
          />{" "}
          Male
        </label>
        <label>
          <input
            type="radio"
            name="gender"
            value="female"
            checked={gender === "female"}
            onChange={(e) => setGender(e.target.value)}
          />{" "}
          Female
        </label>
      </div>

      {/* NEW: Relationship dropdown */}
      <div style={{ marginBottom: 16 }}>
        <label htmlFor="relationship">Relationship to User:&nbsp;</label>
        <select
          id="relationship"
          value={relationship}
          onChange={(e) => setRelationship(e.target.value)}
          required
          style={{
            padding: "10px 12px",
            fontSize: 15,
            border: "1px solid #ccc",
            borderRadius: 8,
            outline: "none",
            cursor: "pointer",
          }}
        >
          <option value="">Select relationship</option>
          <option value="friend">Friend</option>
          <option value="son">Son</option>
          <option value="daughter">Daughter</option>
          <option value="wife">Wife</option>
          <option value="husband">Husband</option>
        </select>
      </div>

      {/* Avatar photo input */}
      <label>
        Face photo:&nbsp;
        <input
          type="file"
          accept="image/*"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
          required
        />
      </label>

      {/* Preview */}
      {preview && (
        <div style={{ marginTop: 10 }}>
          <img
            src={preview}
            alt="avatar preview"
            style={{
              width: 180,
              height: 180,
              objectFit: "cover",
              borderRadius: 8,
              border: "1px solid #ddd",
            }}
          />
        </div>
      )}
    </>
  );
}
