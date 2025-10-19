using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Networking;
using Firebase.Database;
using Firebase.Extensions;

public class AdaptiveGalleryWallPlacerV2 : MonoBehaviour
{
    [Header("Wall (meters)")]
    public Transform wall;
    public float wallWidth = 6f;
    public float wallHeight = 2.7f;
    public bool wallForwardFacesRoom = true;
    public float zOffset = 0.04f;

    [Header("Asymmetric Margins (meters)")]
    public float leftMargin = 0.25f;
    public float rightMargin = 0.25f;
    public float topMargin = 0.25f;
    public float bottomMargin = 0.90f;

    [Header("Gaps (meters)")]
    public float gapX = 0.12f;
    public float gapY = 0.22f;

    [Header("Frame Prefab")]
    public GameObject framePrefab;
    public Vector2 prefabLogicalSize = new(1f, 1f);
    public bool squareFrames = true;
    [Range(0.5f, 1f)] public float frameFill = 0.82f;

    [Header("Test Photos (Editor Only)")]
    public List<Texture2D> photos = new();

    private void Start()
    {
        // If running in editor without Firebase, fallback to test photos
        if (Application.isEditor && photos.Count > 0)
        {
            Place(photos);
        }
        else
        {
            LoadGalleryFromFirebase();
        }
    }

    private void LoadGalleryFromFirebase()
    {
        string nric = SessionData.NRIC;
        if (string.IsNullOrEmpty(nric))
        {
            Debug.LogError("SessionData.NRIC is null or empty.");
            return;
        }

        FirebaseDataManager.Instance.GetUserDataAsync(nric).ContinueWithOnMainThread(task =>
        {
            if (task.IsFaulted || !task.IsCompleted) return;
            DataSnapshot snapshot = task.Result;
            if (snapshot == null || !snapshot.Exists) return;

            var gallerySnap = snapshot.Child("gallery");
            if (!gallerySnap.Exists)
            {
                Debug.Log("No gallery data found.");
                return;
            }

            List<string> urls = new List<string>();
            foreach (var child in gallerySnap.Children)
            {
                string url = child.Value?.ToString();
                if (!string.IsNullOrEmpty(url))
                    urls.Add(url);
            }

            if (urls.Count > 0)
                StartCoroutine(DownloadAndPlace(urls));
        });
    }

    private IEnumerator DownloadAndPlace(List<string> urls)
    {
        List<Texture2D> textures = new List<Texture2D>();
        foreach (string url in urls)
        {
            using (UnityWebRequest req = UnityWebRequestTexture.GetTexture(url))
            {
                yield return req.SendWebRequest();
                if (req.result == UnityWebRequest.Result.Success)
                {
                    Texture2D tex = DownloadHandlerTexture.GetContent(req);
                    textures.Add(tex);
                }
                else
                {
                    Debug.LogError($"Failed to download {url}: {req.error}");
                }
            }
        }

        Place(textures);
    }

    // ---------------- Existing Place() logic ----------------
    public void ClearSpawned()
    {
        for (int i = transform.childCount - 1; i >= 0; i--)
            DestroyImmediate(transform.GetChild(i).gameObject);
    }

    public void Place(List<Texture2D> textures)
    {
        ClearSpawned();
        if (!wall || !framePrefab) return;
        int n = Mathf.Clamp(textures?.Count ?? 0, 0, 6);
        if (n == 0) return;

        int cols, rows;
        switch (n)
        {
            case 1: cols = 1; rows = 1; break;
            case 2: cols = 2; rows = 1; break;
            case 3: cols = 3; rows = 1; break;
            case 4: cols = 2; rows = 2; break;
            default: cols = 3; rows = 2; break;
        }

        var rot = wall.rotation;
        Vector3 right = rot * Vector3.right;
        Vector3 up = rot * Vector3.up;
        Vector3 normal = wallForwardFacesRoom ? wall.forward : -wall.forward;

        float usableW = wallWidth - leftMargin - rightMargin - (cols - 1) * gapX;
        float usableH = wallHeight - topMargin - bottomMargin - (rows - 1) * gapY;
        if (usableW <= 0 || usableH <= 0) { Debug.LogWarning("Margins/gaps too large."); return; }

        float cellW = usableW / cols;
        float cellH = usableH / rows;

        float frameW, frameH;
        if (squareFrames)
        {
            float side = Mathf.Min(cellW, cellH) * frameFill;
            frameW = frameH = side;
        }
        else
        {
            float aspect = prefabLogicalSize.x / Mathf.Max(0.0001f, prefabLogicalSize.y);
            if (cellW / cellH > aspect) { frameH = cellH * frameFill; frameW = frameH * aspect; }
            else { frameW = cellW * frameFill; frameH = frameW / aspect; }
        }

        float padX = (cellW - frameW) * 0.5f;
        float padY = (cellH - frameH) * 0.5f;

        Vector3 wallCenter = wall.position;
        Vector3 origin = wallCenter
                       - right * (wallWidth * 0.5f - leftMargin)
                       - up * (wallHeight * 0.5f - bottomMargin)
                       + normal * zOffset;

        int idx = 0;
        for (int r = 0; r < rows; r++)
        {
            for (int c = 0; c < cols; c++)
            {
                if (idx >= n) break;

                float x = c * (cellW + gapX) + padX + frameW * 0.5f;
                float y = r * (cellH + gapY) + padY + frameH * 0.5f;
                Vector3 pos = origin + right * x + up * y;

                var go = Instantiate(framePrefab, pos, Quaternion.LookRotation(normal, up), transform);
                go.transform.localScale = new(frameW / prefabLogicalSize.x, frameH / prefabLogicalSize.y, 1f);

                var img = go.GetComponent<PhotoFrameImage>();
                if (img && textures[idx]) img.SetPhoto(textures[idx]);

                idx++;
            }
        }
    }
}
