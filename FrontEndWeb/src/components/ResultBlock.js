export default function ResultBlock({ result }) {
  if (!result) return null;

  if (result.mode === "avatar") {
    return (
      <div style={{ marginTop: 16 }}>
        <h3>Avatar Ready</h3>
        <p><strong>NRIC:</strong> {result.nric}</p>
        <p><strong>ID:</strong> {result.avatarId}</p>
        {result.glbUrl && (
          <p><a href={result.glbUrl} target="_blank" rel="noreferrer">Download GLB</a></p>
        )}
        {result.pngUrl && (
          <img src={result.pngUrl} alt="Avatar preview" style={{ width: 200, borderRadius: 8 }} />
        )}
      </div>
    );
  }

  if (result.mode === "rooms") {
    return (
      <div style={{ marginTop: 16 }}>
        <h3>Saved Room Walls</h3>
        <p><strong>NRIC:</strong> {result.nric}</p>
        <ul>
          <li>Left: <a href={result.urls?.left} target="_blank" rel="noreferrer">Open</a></li>
          <li>Front: <a href={result.urls?.front} target="_blank" rel="noreferrer">Open</a></li>
          <li>Right: <a href={result.urls?.right} target="_blank" rel="noreferrer">Open</a></li>
        </ul>
      </div>
    );
  }

  if (result.mode === "gallery") {
    return (
      <div style={{ marginTop: 16 }}>
        <h3>Saved Gallery</h3>
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
    );
  }

  return null;
}
