using System.Collections.Generic;
using UnityEngine;

public class HeadGazeLogger : MonoBehaviour
{
    [Header("What to hit")]
    public LayerMask wallMask;          // set in Inspector to your "Walls" layer
    public float maxDistance = 20f;

    [Header("Dwell settings")]
    public float minDwellToCount = 0.5f;  // ignore very brief glances
    public float hysteresis = 0.15f;      // buffer to avoid flicker at edges

    [Header("Optional: periodic console summary")]
    public bool printSnapshots = false;
    public float snapshotEvery = 10f;     // seconds

    // current focus state
    string currentTarget = null;
    float startTime = 0f;                 // when we *started counting* (after hysteresis)
    bool counting = false;

    // cumulative totals
    readonly Dictionary<string, float> totals = new Dictionary<string, float>();

    float nextSnapshotAt = 0f;

    void Start()
    {
        if (printSnapshots) nextSnapshotAt = Time.time + snapshotEvery;
    }

    void Update()
    {
        var cam = Camera.main ? Camera.main.transform : null;
        if (!cam) return;

        // head-gaze ray
        var ray = new Ray(cam.position, cam.forward);

        if (Physics.Raycast(ray, out RaycastHit hit, maxDistance, wallMask))
        {
            string id = hit.collider.gameObject.name;

            // switched target?
            if (currentTarget != id)
            {
                // finalize previous dwell segment (adds to totals)
                FinalizeCurrentDwell();

                // start new target
                currentTarget = id;
                startTime = Time.time + hysteresis;  // will start counting *after* hysteresis
                counting = true;
            }
            // else: still on the same target; nothing special to do here
        }
        else
        {
            // looking at nothing of interest; finalize any ongoing dwell
            FinalizeCurrentDwell();
            currentTarget = null;
            counting = false;
        }

        // optional periodic snapshot of totals
        if (printSnapshots && Time.time >= nextSnapshotAt)
        {
            PrintTotals(prefix: "SNAPSHOT");
            nextSnapshotAt += snapshotEvery;
        }
    }

    void FinalizeCurrentDwell()
    {
        if (!counting || string.IsNullOrEmpty(currentTarget)) return;

        float dwell = Time.time - startTime;
        if (dwell >= minDwellToCount)
        {
            if (!totals.ContainsKey(currentTarget)) totals[currentTarget] = 0f;
            totals[currentTarget] += dwell;

            // Per-segment and running total logs
            Debug.Log($"GAZE_DWELL target={currentTarget} segment={dwell:F2}s total={totals[currentTarget]:F2}s");

            // >>> OPTIONAL: push this segment to Firebase instead of Debug.Log
            // PushGazeEvent(currentTarget, dwell, totals[currentTarget]);
        }

        counting = false;
    }

    void OnDisable()
    {
        FinalizeCurrentDwell();
        PrintTotals(prefix: "FINAL");
    }

    void OnApplicationQuit()
    {
        FinalizeCurrentDwell();
        PrintTotals(prefix: "FINAL");
    }

    void PrintTotals(string prefix = "TOTALS")
    {
        if (totals.Count == 0)
        {
            Debug.Log($"{prefix}: no gaze totals yet.");
            return;
        }

        foreach (var kvp in totals)
            Debug.Log($"{prefix}: {kvp.Key} = {kvp.Value:F2}s");
    }

    // ===== Optional Firebase upload stub =====
    // Replace this stub with your Firebase write if you want persistence.
    /*
    void PushGazeEvent(string target, float segmentSeconds, float totalSeconds)
    {
        var payload = new
        {
            tsUtc = System.DateTime.UtcNow.ToString("o"),
            target = target,
            segment = segmentSeconds,
            total = totalSeconds
        };
        string json = JsonUtility.ToJson(payload);
        // FirebaseDatabase.DefaultInstance.RootReference
        //   .Child("sessions").Child(nric).Child(sessionId)
        //   .Child("gazeEvents").Push()
        //   .SetRawJsonValueAsync(json);
    }
    */
}
