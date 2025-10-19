import { useState } from "react";
import AvatarFields from "../components/AvatarFields";
import RoomFields from "../components/RoomFields";
import GalleryFields from "../components/GalleryFields";
import ResultBlock from "../components/ResultBlock";
import { createAvatar, uploadGallery, uploadWalls } from "../lib/api";

export default function PersonalizationUploader() {
  const [nric, setNric] = useState("");

  // avatar
  const [avatarFile, setAvatarFile] = useState(null);
  const [gender, setGender] = useState("male");
  const [relationship, setRelationship] = useState("");
  const [elderlyName, setElderlyName] = useState(""); // NEW

  // walls
  const [left, setLeft] = useState(null);
  const [front, setFront] = useState(null);
  const [right, setRight] = useState(null);

  // gallery
  const [photos, setPhotos] = useState([]);

  // general
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  const canSubmit =
    nric &&
    elderlyName &&                             // NEW
    avatarFile &&
    left && front && right &&
    photos.length >= 1 && photos.length <= 6;

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setResult(null);

    if (!nric) return setError("Please provide NRIC.");
    if (!avatarFile) return setError("Please upload an avatar face photo.");
    if (!left || !front || !right) return setError("Please upload all three room wall images.");
    if (photos.length < 1) return setError("Please upload at least one gallery photo.");
    if (photos.length > 6) return setError("You can upload a maximum of 6 gallery photos.");
    if (!elderlyName) return setError("Please provide the elderly user's name.");


    try {
      setLoading(true);

      // 1) Avatar
      const avatarRes = await createAvatar({ photo: avatarFile, nric, gender, relationship, name: elderlyName });


      // 2) Room walls
      const wallRes = await uploadWalls({ nric, left, front, right });

      // 3) Gallery
      const galleryRes = await uploadGallery({ nric, photos });

      setResult({
        avatar: avatarRes,
        walls: wallRes,
        gallery: galleryRes,
      });
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: 900, margin: "2rem auto", fontFamily: "Inter, system-ui, sans-serif" }}>
      <h2>Welcome To Personalization Setup for VR Game</h2>
      <p style={{ marginTop: 24, opacity: 0.8 }}>
        To start, please enter a valid NRIC number, then upload all required images below.
      </p>
      <p>1. Upload a face photo to generate the 3D companion.</p>
      <p>2. Upload three photos of the physical location (Left, Front, Right) to build the room.</p>
      <p>3. Upload up to six personal photos for the virtual gallery.</p>

      <form onSubmit={handleSubmit} style={{ display: "grid", gap: 20, marginTop: 16 }}>
        {/* NRIC */}
        <div className="form-row">
          <label htmlFor="nric">NRIC:</label>
          <input
            id="nric"
            type="text"
            value={nric}
            onChange={(e) => setNric(e.target.value)}
            required
          />
        </div>
        <div className="form-row">
            <label htmlFor="elderlyName">Name:</label>
            <input
                id="elderlyName"
                type="text"
                value={elderlyName}
                onChange={(e) => setElderlyName(e.target.value)}
                required
            />
        </div>


        {/* Avatar Section */}
        <section style={sectionStyle}>
          <h3>1) Companion Photo</h3>
          <p style={hintStyle}>Upload a clear, front-facing face photo.</p>
          <AvatarFields
            gender={gender}
            setGender={setGender}
            file={avatarFile}
            setFile={setAvatarFile}
            relationship={relationship}
            setRelationship={setRelationship}
          />
        </section>

        {/* Room Walls Section */}
        <section style={sectionStyle}>
          <h3>2) Room Wall Images</h3>
          <p style={hintStyle}>Upload Left, Front, and Right wall photos.</p>
          <RoomFields
            left={left} setLeft={setLeft}
            front={front} setFront={setFront}
            right={right} setRight={setRight}
          />
        </section>

        {/* Gallery Section */}
        <section style={sectionStyle}>
          <h3>3) Gallery Photos</h3>
          <p style={hintStyle}>Upload up to 6 images for the in-room gallery.</p>
          <GalleryFields
            photos={photos}
            setPhotos={setPhotos}
          />
        </section>

        <button type="submit" disabled={loading || !canSubmit}>
          {loading ? "Uploading…" : "Submit All"}
        </button>
      </form>

      {error && <p className="error" style={{ marginTop: 12 }}>{error}</p>}

      {result && (
        <div style={{ marginTop: 24 }}>
          <h3>✅ Upload Complete!</h3>
          <ResultBlock result={{ mode: "avatar", ...result.avatar }} />
          <ResultBlock result={{ mode: "rooms", ...result.walls }} />
          <ResultBlock result={{ mode: "gallery", ...result.gallery }} />
        </div>
      )}
    </div>
  );
}

const sectionStyle = {
  border: "1px solid #eee",
  borderRadius: 10,
  padding: 16,
  background: "#fff",
  boxShadow: "0 2px 6px rgba(0,0,0,0.05)",
};

const hintStyle = {
  fontSize: 14,
  color: "#666",
  marginTop: -8,
  marginBottom: 12,
};

