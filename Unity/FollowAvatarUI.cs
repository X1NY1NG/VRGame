using UnityEngine;

public class FollowAvatarUI : MonoBehaviour
{
    public Transform target;                     // assign avatar at runtime
    public bool faceCamera = true;

    [Header("Offsets (meters)")]
    public float up = 1.6f;                      // height near head
    public float side = 0.9f;                    // lateral distance from avatar
    public float forward = 0.0f;                 // push toward/away from camera
    public float minSeparation = 0.85f;          // never get closer than this (plan view)

    [Header("Look & size")]
    public bool keepConstantScreenSize = true;   // helpful for world-space canvases
    public float sizePerMeter = 0.12f;           // tune to your canvas
    public float rotateLerp = 8f;                // smooth facing

    Camera cam;

    void Start() { cam = Camera.main; }

    void LateUpdate()
    {
        if (target == null) return;
        if (cam == null) cam = Camera.main;
        if (cam == null) return;

        // Camera-relative axes at avatar (flattened so it works on slopes)
        Vector3 toCam = cam.transform.position - target.position;
        Vector3 toCamFlat = Vector3.ProjectOnPlane(toCam, Vector3.up).normalized;
        if (toCamFlat.sqrMagnitude < 1e-4f) toCamFlat = cam.transform.forward;

        Vector3 right = Vector3.Cross(Vector3.up, toCamFlat).normalized;

        // Desired spot: to the side of avatar, at head height
        Vector3 desired = target.position
                        + Vector3.up * up
                        + right * side
                        + toCamFlat * forward;

        // Enforce minimum separation from avatar in the horizontal plane
        Vector3 a = target.position; a.y = 0f;
        Vector3 b = desired; b.y = 0f;
        Vector3 dir = (b - a);
        float d = dir.magnitude;
        if (d < minSeparation && d > 1e-4f)
            desired += dir.normalized * (minSeparation - d);

        transform.position = desired;

        // Face the camera
        if (faceCamera)
        {
            Quaternion look = Quaternion.LookRotation(transform.position - cam.transform.position, Vector3.up);
            transform.rotation = Quaternion.Slerp(transform.rotation, look, Time.deltaTime * rotateLerp);
        }

    }
}
