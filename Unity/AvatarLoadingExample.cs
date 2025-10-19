using Firebase.Database;
using Newtonsoft.Json;
using OpenAI;
using ReadyPlayerMe.Core;
using Samples.Whisper;
using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using UnityEngine;
using UnityEngine.InputSystem;
using UnityEngine.Networking;
using Unity.XR.CoreUtils;   // for XROrigin
using System.Threading.Tasks;



namespace ReadyPlayerMe.Samples.AvatarLoading
{
    /// <summary>
    /// This class is a simple <see cref="Monobehaviour"/>  to serve as an example on how to load Ready Player Me avatars and spawn as a <see cref="GameObject"/> into the scene.
    /// </summary>
    public class AvatarLoadingExample : MonoBehaviour
    {

        private SkinnedMeshRenderer faceSmr;
        private int bsBlinkL = -1, bsBlinkR = -1;
        private int bsSmile = -1, bsFrownL = -1, bsFrownR = -1, bsBrowDownL = -1, bsBrowDownR = -1, bsBrowInnerUp = -1, bsMouthPressL = -1, bsMouthPressR = -1;


        private string displayName;




        private Coroutine blinkCo, exprCo;

        private string avatarUrl;

        private GameObject avatar;

        private AudioClip clip;

        public InputActionReference recordAction;

        private bool isRecording = false;

        private AudioSource audioSource;

        private Animator animator;
        private MetaDoc meta;

        [SerializeField] private string SUPABASE_URL = "abc";
        [SerializeField] private string SUPABASE_ANON = "abc";
        [SerializeField] private string OPENAI_KEY = "abc"; // ok for demo only


        private RagClient rag;
        private OpenAIApi openai;

        private bool hasGreetedOnce = false;


        [SerializeField] private DialogueUI dialogueUI;

        [SerializeField] private Transform avatarSpawn;       // drag AvatarSpawn here
        [SerializeField] private FollowAvatarUI dialogueFollow; // drag Panel here
        [SerializeField] private XROrigin xrOrigin;              // drag your XROrigin here
        [SerializeField, Range(0, 180)] private float autoFaceThreshold = 25f;

        [Serializable]
        public class Turn
        {
            public string role;   // "user" | "assistant"
            public string text;
            public long ts;     // unix seconds
        }


        private void Awake()
        {
            // Don't let OVRLipSyncContextMorphTarget.Start() run before we set the SMR.
            var m = GetComponent<OVRLipSyncContextMorphTarget>();
            if (m) m.enabled = false;
        }

        private async Task AppendTurnAsync(string role, string text)
        {
            try
            {
                var row = new Turn { role = role, text = text, ts = DateTimeOffset.UtcNow.ToUnixTimeSeconds() };
                string json = JsonConvert.SerializeObject(row);

                await FirebaseDatabase.DefaultInstance
                    .RootReference
                    .Child("conversations")
                    .Child(SessionData.NRIC)    // user-specific
                    .Child("log")
                    .Child(row.ts.ToString())
                    .SetRawJsonValueAsync(json);
            }
            catch (Exception e)
            {
                Debug.LogWarning("AppendTurnAsync failed: " + e.Message);
                // no return needed
            }
        }

        private string FormatBackgroundForPrompt(List<string> facts, List<string> avoids)
        {
            var sb = new StringBuilder();
            if (facts.Count > 0)
            {
                sb.AppendLine("The following background includes the user’s personal facts. Use them only when relevant and in a caring way.");
                sb.AppendLine("[USER BACKGROUND]");
                foreach (var f in facts) sb.AppendLine($"- {f}");
            }
            if (avoids.Count > 0)
            {
                sb.AppendLine("[AVOID TOPICS]");
                foreach (var a in avoids) sb.AppendLine($"- {a}");
                sb.AppendLine("Do not introduce [AVOID TOPICS] yourself. If the user mentions them, be gentle and supportive.");
            }
            return sb.ToString().Trim();
        }






        [Serializable]
        public class MetaDoc
        {
            public string lastSummary = "";   // most recent rolling summary
            public long lastSummarizedTs = 0; // last turn timestamp included in the summary
        }

        private async Task<string> SummarizeAsync(string priorSummary, List<Turn> turns)
        {
            var plain = string.Join("\n", turns.Select(t => $"{t.role.ToUpper()}: {t.text}"));

            var msgs = new List<ChatMessage> {
        new ChatMessage{
            Role = "system",
            Content =
            "You are a summarizer that produces a concise MEMORY for future chats. " +
            "Write 5–10 short bullet points (<=1200 chars total). " +
            "Use SECOND PERSON (start with 'You…', 'Your…'), not 'User…'. " +
            "Focus on persistent details, preferences, plans, and open tasks. " +
            "No quotes, no sensitive/medical data, no PII."
        },
        new ChatMessage{
            Role = "user",
            Content =
            $"Previous memory (may be empty):\n{priorSummary}\n\n" +
            $"New turns:\n{plain}\n\n" +
            "Return ONLY the updated memory text."
        }
    };

            var resp = await openai.CreateChatCompletion(new CreateChatCompletionRequest
            {
                Model = "gpt-4o-mini",
                Messages = msgs
            });

            return resp.Choices?.FirstOrDefault().Message.Content?.Trim() ?? "";
        }

        private async Task<string> GenerateGreetingFromSummaryAsync(string summary, string name = null)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(summary))
                    return $"Hello {name}! How's your day going?";

                var msgs = new List<ChatMessage>
            {
                new ChatMessage{
                    Role = "system",
                    Content =
                        "You are a warm, concise companion for an elderly user. " +
                        $"The user's name is {name}. Begin your line by greeting them by name naturally, e.g. 'Hi {name}!'. " +
                        "You are starting a NEW session using a short memory summary. " +
                        "Write ONE short, friendly sentence in SECOND PERSON that naturally references " +
                        "exactly one relevant thing from the summary (paraphrase if needed), do not mention when it happened like saying today or yesterday. treat it as past tense" +
                        "and then smoothly ask how their day is going. " +
                        "No bullet points, no quotes, no emojis, no sensitive topics. " +
                        "Keep it under 25 words."
                },
                new ChatMessage{
                    Role = "user",
                    Content =
                        "Memory summary:\n" + summary + "\n\n" +
                        "Write one friendly opening line that references the memory and ends by asking about their day."
                }
            };

                var resp = await openai.CreateChatCompletion(new CreateChatCompletionRequest
                {
                    Model = "gpt-4o-mini",
                    Messages = msgs
                });

                var line = resp.Choices?.FirstOrDefault().Message.Content?.Trim();
                if (string.IsNullOrWhiteSpace(line))
                    line = "Hi again! How's your day going?";

                if (!line.TrimEnd().EndsWith("?"))
                    line = line.TrimEnd('.', '!', ' ') + " How's your day?";

                return line;
            }
            catch (Exception e)
            {
                Debug.LogWarning("GenerateGreetingFromSummaryAsync failed: " + e.Message);
                return "Hi again! How's your day going?";
            }
        }




        private DatabaseReference ConvRoot =>
        FirebaseDatabase.DefaultInstance
        .RootReference
        .Child("conversations")
        .Child(SessionData.NRIC);

        // load/create meta
        private async Task<MetaDoc> LoadOrCreateMetaAsync()
        {
            try
            {
                var snap = await ConvRoot.Child("meta").GetValueAsync();
                if (snap.Exists)
                {
                    var json = snap.GetRawJsonValue();
                    return JsonConvert.DeserializeObject<MetaDoc>(json) ?? new MetaDoc();
                }
            }
            catch (Exception e) { Debug.LogWarning("LoadOrCreateMetaAsync: " + e.Message); }
            return new MetaDoc();
        }

        private async Task SaveMetaAsync(MetaDoc m)
        {
            try
            {
                string json = JsonConvert.SerializeObject(m);
                await ConvRoot.Child("meta").SetRawJsonValueAsync(json);
            }
            catch (Exception e) { Debug.LogWarning("SaveMetaAsync: " + e.Message); }
        }

        // unsummarized turns after a timestamp
        private async Task<List<Turn>> LoadTurnsAfterAsync(long sinceTs, int limit = 500)
        {
            var list = new List<Turn>();
            try
            {
                var q = ConvRoot.Child("log")
                                .OrderByKey()
                                .StartAt((sinceTs + 1).ToString())
                                .LimitToFirst(limit);

                var snap = await q.GetValueAsync();
                if (snap.Exists)
                {
                    foreach (var child in snap.Children)
                    {
                        var row = JsonConvert.DeserializeObject<Turn>(child.GetRawJsonValue());
                        if (row != null) list.Add(row);
                    }
                }
            }
            catch (Exception e) { Debug.LogWarning("LoadTurnsAfterAsync: " + e.Message); }

            list.Sort((a, b) => a.ts.CompareTo(b.ts));
            return list;
        }

        private async Task RefreshSummaryAtStartAsync()
        {
            meta = await LoadOrCreateMetaAsync();

            var newTurns = await LoadTurnsAfterAsync(meta.lastSummarizedTs);
            if (newTurns.Count == 0) return;

            string updated = await SummarizeAsync(meta.lastSummary ?? "", newTurns);

            long newestTs = newTurns[^1].ts;
            //  await SaveSummarySnapshotAsync(updated, newestTs);

            meta.lastSummary = updated;
            meta.lastSummarizedTs = newestTs;
            await SaveMetaAsync(meta);
        }

        private string BuildGreetingFromSummary(string summary)
        {
            if (string.IsNullOrWhiteSpace(summary))
                return "Hi, I'm your companion! How's your day?";

            var lines = summary.Split(new[] { '\n', '\r' }, StringSplitOptions.RemoveEmptyEntries);
            var first = lines.FirstOrDefault(l => l.Trim().Length > 3) ?? "";
            first = first.TrimStart('-', '•', '*', ' ').Trim();
            if (first.Length > 120) first = first.Substring(0, 117) + "...";

            if (string.IsNullOrEmpty(first))
                return "Hi again! How's your day?";

            return $"Hi again! Last time you mentioned “{first}”. How's your day?";
        }






        private void AssignSmrToOvrMorphTarget(GameObject avatarRoot)
        {
            // Ensure the MorphTarget component exists on THIS object (the one in your screenshot)
            var morph = GetComponent<OVRLipSyncContextMorphTarget>()
                        ?? gameObject.AddComponent<OVRLipSyncContextMorphTarget>();

            // Pick a SkinnedMeshRenderer from the loaded avatar (prefer the one with most blendshapes)
            var smrs = avatarRoot.GetComponentsInChildren<SkinnedMeshRenderer>(true);
            SkinnedMeshRenderer target = null;
            int bestCount = -1;

            foreach (var s in smrs)
            {
                int count = s.sharedMesh ? s.sharedMesh.blendShapeCount : 0;
                if (count > bestCount)
                {
                    bestCount = count;
                    target = s;
                }
            }

            // Fallback if none report blendshapes
            if (target == null) target = smrs.FirstOrDefault();

            if (target == null)
            {
                Debug.LogError("AssignSmrToOvrMorphTarget: No SkinnedMeshRenderer found under avatar.");
                return;
            }

            target.updateWhenOffscreen = true;         // optional but useful for head meshes off-camera
            morph.skinnedMeshRenderer = target;
            morph.laughterKey = KeyCode.None;     // disable laughter key polling
            morph.laughterBlendTarget = -1; // << the important line
            morph.enabled = true;                      // now let its Start()/Update run

            Debug.Log($"OVR LipSync MorphTarget bound to SMR: {target.name} (blendShapes={target.sharedMesh?.blendShapeCount ?? 0})");
        }

        private static int FindBS(Mesh m, params string[] names)
        {
            for (int i = 0; i < m.blendShapeCount; i++)
            {
                var n = m.GetBlendShapeName(i).ToLowerInvariant();
                foreach (var c in names)
                    if (n.Contains(c.ToLowerInvariant())) return i;
            }
            return -1;
        }

        private void SetupFacialRig(GameObject avatarRoot)
        {
            faceSmr = avatarRoot.GetComponentsInChildren<SkinnedMeshRenderer>(true)
                                .OrderByDescending(s => s.sharedMesh ? s.sharedMesh.blendShapeCount : 0)
                                .FirstOrDefault();

            if (!faceSmr || !faceSmr.sharedMesh)
            {
                Debug.LogWarning("FacialRig: No SkinnedMeshRenderer with blendshapes found.");
                return;
            }

            var mesh = faceSmr.sharedMesh;

            // Eyes
            bsBlinkL = FindBS(mesh, "eyeBlinkLeft", "blink_left", "blinkl", "eye_blink_l");
            bsBlinkR = FindBS(mesh, "eyeBlinkRight", "blink_right", "blinkr", "eye_blink_r");

            // Smile / frown / brow
            bsSmile = FindBS(mesh, "mouthSmile", "mouthSmileLeft", "mouthSmileRight", "smile");
            bsFrownL = FindBS(mesh, "mouthFrownLeft", "frown_left");
            bsFrownR = FindBS(mesh, "mouthFrownRight", "frown_right");
            bsMouthPressL = FindBS(mesh, "mouthPressLeft");
            bsMouthPressR = FindBS(mesh, "mouthPressRight");
            bsBrowDownL = FindBS(mesh, "browDownLeft");
            bsBrowDownR = FindBS(mesh, "browDownRight");
            bsBrowInnerUp = FindBS(mesh, "browInnerUp");

            // Start blinking if we have both blink shapes
            if (bsBlinkL >= 0 && bsBlinkR >= 0 && blinkCo == null)
                blinkCo = StartCoroutine(BlinkRoutine());

            Debug.Log($"FacialRig mapped: blinkL={bsBlinkL}, blinkR={bsBlinkR}, smile={bsSmile}, frownL={bsFrownL}, frownR={bsFrownR}, pressL={bsMouthPressL}, pressR={bsMouthPressR}, browDownL={bsBrowDownL}, browDownR={bsBrowDownR}, browInnerUp={bsBrowInnerUp}");
        }

        // Makes the avatar blink forver by animating the eye blink blenshapes up to 100%
        private IEnumerator BlinkRoutine()
        {
            while (true)
            {
                // wait a random interval
                yield return new WaitForSeconds(UnityEngine.Random.Range(2.5f, 5.0f));

                // close fast
                float t = 0f, durClose = UnityEngine.Random.Range(0.08f, 0.12f);
                while (t < durClose)
                {
                    t += Time.deltaTime;
                    float w = Mathf.SmoothStep(0, 1, t / durClose);
                    if (bsBlinkL >= 0) faceSmr.SetBlendShapeWeight(bsBlinkL, w);
                    if (bsBlinkR >= 0) faceSmr.SetBlendShapeWeight(bsBlinkR, w);
                    yield return null;
                }

                // open slightly slower
                t = 0f; float durOpen = UnityEngine.Random.Range(0.12f, 0.16f);
                while (t < durOpen)
                {
                    t += Time.deltaTime;
                    float w = Mathf.Lerp(1, 0, t / durOpen);
                    if (bsBlinkL >= 0) faceSmr.SetBlendShapeWeight(bsBlinkL, w);
                    if (bsBlinkR >= 0) faceSmr.SetBlendShapeWeight(bsBlinkR, w);
                    yield return null;
                }
            }
        }

        // Smoothly apply a set of (index -> targetWeight01) using 0..1 weights (RPM/glTF)
        private IEnumerator LerpExpression(Dictionary<int, float> targets01,
                                          float inTime = 0.25f, float hold = 0f, float outTime = 0.25f)
        {
            if (!faceSmr) yield break;

            // Indices we control (exclude visemes so we don't fight OVR)
            var controlled = new List<int>();
            void add(int idx) { if (idx >= 0 && !controlled.Contains(idx)) controlled.Add(idx); }
            add(bsSmile); add(bsFrownL); add(bsFrownR); add(bsMouthPressL); add(bsMouthPressR);
            add(bsBrowDownL); add(bsBrowDownR); add(bsBrowInnerUp);

            // Capture start weights (already 0..1 on RPM meshes)
            var start01 = new Dictionary<int, float>();
            foreach (var i in controlled) start01[i] = Mathf.Clamp01(faceSmr.GetBlendShapeWeight(i));

            // Fade in
            float t = 0f;
            while (t < inTime)
            {
                t += Time.deltaTime;
                float a = Mathf.Clamp01(t / inTime);
                foreach (var i in controlled)
                {
                    float from01 = start01[i];
                    float to01 = targets01.TryGetValue(i, out var tw) ? Mathf.Clamp01(tw) : 0f;
                    faceSmr.SetBlendShapeWeight(i, Mathf.Lerp(from01, to01, a)); // 0..1
                }
                yield return null;
            }

            if (hold > 0f) yield return new WaitForSeconds(hold);

            // Fade out to neutral
            t = 0f;
            while (t < outTime)
            {
                t += Time.deltaTime;
                float a = Mathf.Clamp01(t / outTime);
                foreach (var i in controlled)
                {
                    float from01 = Mathf.Clamp01(faceSmr.GetBlendShapeWeight(i));
                    faceSmr.SetBlendShapeWeight(i, Mathf.Lerp(from01, 0f, a)); // back to 0
                }
                yield return null;
            }
        }

        private void ApplyExpression(string name, float holdWhileTalkingSec)
        {
            if (!faceSmr) return;

            name = (name ?? "").ToLowerInvariant();
            var tgt = new Dictionary<int, float>(); // 0..1 targets for RPM

            switch (name)
            {
                case "smile":
                    if (bsSmile >= 0) tgt[bsSmile] = 0.65f;
                    if (bsBrowInnerUp >= 0) tgt[bsBrowInnerUp] = 0.10f;
                    break;

                case "sad":
                    // heavier corners-down
                    if (bsFrownL >= 0) tgt[bsFrownL] = 0.78f;  // was 0.45
                    if (bsFrownR >= 0) tgt[bsFrownR] = 0.78f;  // was 0.45
                                                               // tighten lips a bit
                    if (bsMouthPressL >= 0) tgt[bsMouthPressL] = 0.25f;
                    if (bsMouthPressR >= 0) tgt[bsMouthPressR] = 0.25f;
                    // classic “sad” eyebrow shape (inner up)
                    if (bsBrowInnerUp >= 0) tgt[bsBrowInnerUp] = 0.30f;  // was 0.15
                    break;

                case "angry":
                    if (bsBrowDownL >= 0) tgt[bsBrowDownL] = 0.55f;
                    if (bsBrowDownR >= 0) tgt[bsBrowDownR] = 0.55f;
                    if (bsMouthPressL >= 0) tgt[bsMouthPressL] = 0.35f;
                    if (bsMouthPressR >= 0) tgt[bsMouthPressR] = 0.35f;
                    break;

                default:
                    // neutral
                    break;
            }

            if (exprCo != null) StopCoroutine(exprCo);
            exprCo = StartCoroutine(LerpExpression(tgt, 0.20f, holdWhileTalkingSec, 0.25f));
        }

        [Serializable]
        public class ChatChoice
        {
            public string text { get; set; }
            public string facial_expression { get; set; }
            public string body_animation { get; set; }
        }

        [Serializable]
        public class ChatChoiceArray
        {
            public List<ChatChoice> items;
        }

        [Serializable]
        public class ElevenVoiceSettings
        {
            public float stability = 0.4f;
            public float similarity_boost = 0.8f;
        }

        [Serializable]
        public class ElevenTtsPayload
        {
            public string text;
            public string model_id = "eleven_multilingual_v2"; // or eleven_turbo_v2 if you have it
            public ElevenVoiceSettings voice_settings = new ElevenVoiceSettings();
        }

        private static string ExtractJsonArray(string raw)
        {
            if (string.IsNullOrWhiteSpace(raw)) return null;
            var s = raw.Trim();

            // Strip markdown fences ```json ... ```
            if (s.StartsWith("```"))
            {
                int firstNl = s.IndexOf('\n');
                int lastFence = s.LastIndexOf("```");
                if (firstNl >= 0 && lastFence > firstNl)
                {
                    s = s.Substring(firstNl + 1, lastFence - firstNl - 1).Trim();
                    // If the first line was "json", drop it
                    if (s.StartsWith("json", StringComparison.OrdinalIgnoreCase))
                    {
                        int nl = s.IndexOf('\n');
                        if (nl >= 0) s = s.Substring(nl + 1).Trim();
                    }
                }
            }

            // Keep only the first JSON array we find
            var m = Regex.Match(s, @"\[[\s\S]*\]");
            return m.Success ? m.Value : null;
        }

        private ChatChoice[] ParseChoiceArray(string rawJson)
        {
            try
            {
                var json = ExtractJsonArray(rawJson);
                if (string.IsNullOrEmpty(json)) return null;
                return JsonConvert.DeserializeObject<ChatChoice[]>(rawJson);
            }
            catch (Exception e)
            {
                Debug.LogWarning("JSON parse failed: " + e.Message + "\nRaw: " + rawJson);
                return null;
            }
        }



        private void EnsureAudioSource()
        {
            audioSource = GetComponent<AudioSource>();
            if (!audioSource)
            {
                audioSource = gameObject.AddComponent<AudioSource>();
                audioSource.playOnAwake = false;
                audioSource.loop = false;
                audioSource.spatialBlend = 0f; // set >0 for 3D
            }
        }




        private string elevenLabID = "abc";

        [SerializeField] private string elevenVoiceMale = "abc"; 
        [SerializeField] private string elevenVoiceFemale = "abc";                
        private string elevenLabVoice;

        private readonly string fileName = "output.wav";

        [SerializeField] private RuntimeAnimatorController animationController;

        private async void Start()
        {
            openai = new OpenAIApi(OPENAI_KEY);                 // now the Inspector value is applied
            rag = new RagClient(SUPABASE_URL, SUPABASE_ANON, OPENAI_KEY);

            if (!dialogueUI) dialogueUI = FindObjectOfType<DialogueUI>(true);
            if (!dialogueFollow) dialogueFollow = FindObjectOfType<FollowAvatarUI>(true);
            if (!xrOrigin) xrOrigin = FindObjectOfType<Unity.XR.CoreUtils.XROrigin>(true);

            DataSnapshot snapshot = await FirebaseDataManager.Instance.GetUserDataAsync(SessionData.NRIC);
            string gender = snapshot.Child("chosenGender").Value?.ToString()?.Trim().ToLowerInvariant();

            displayName = snapshot.Child("displayName").Value?.ToString()?.Trim();
            // 2) Decide the ElevenLabs voice
            if (gender == "male")
            {
                elevenLabVoice = string.IsNullOrWhiteSpace(elevenVoiceMale) ? elevenVoiceFemale : elevenVoiceMale;
            }
            else if (gender == "female")
            {
                elevenLabVoice = string.IsNullOrWhiteSpace(elevenVoiceFemale) ? elevenVoiceMale : elevenVoiceFemale;
            }
            string avatarID = snapshot.Child("avatarId").Value.ToString();
            avatarUrl = $"https://models.readyplayer.me/{avatarID}.glb";
            Debug.Log($"Avatar URL: {avatarUrl}");
            ApplicationData.Log();
            var avatarLoader = new AvatarObjectLoader();
            // use the OnCompleted event to set the avatar and setup animator
            avatarLoader.OnCompleted += (_, args) =>
            {
                avatar = args.Avatar;

                // Find a likely skin renderer (you can also drag a specific one via Inspector)
                var skin = avatar.GetComponentsInChildren<SkinnedMeshRenderer>(true)
                                 .OrderByDescending(r => r.sharedMaterials.Length).FirstOrDefault();

                


                if (avatarSpawn)
                    avatar.transform.SetPositionAndRotation(avatarSpawn.position, avatarSpawn.rotation);

                // prep the chat panel to track this avatar (but keep hidden for now)
                if (dialogueFollow)
                {
                    dialogueFollow.target = avatar.transform;
                    dialogueFollow.enabled = false;   // enable when chatting
                }

                var a = avatar.GetComponent<Animator>();
                AvatarAnimationHelper.SetupAnimator(args.Metadata, avatar);
                a.runtimeAnimatorController = animationController;

                animator = a;               // cache the field (no local var named 'animator')
                PlayBodyAnimation("idle");  // default pose

                EnsureAudioSource();

                // === Lipsync context on THIS GameObject pointing at that AudioSource ===
                var ctx = GetComponent<OVRLipSyncContext>() ?? gameObject.AddComponent<OVRLipSyncContext>();
                ctx.audioSource = audioSource;
                ctx.provider = OVRLipSync.ContextProviders.Enhanced;
                ctx.skipAudioSource = false;
                ctx.audioLoopback = true;
                ctx.enableKeyboardInput = false;

                SetupFacialRig(avatar);


                // === Bind the RPM avatar's SkinnedMeshRenderer to our MorphTarget ===
                AssignSmrToOvrMorphTarget(avatar);
                
                _ = RefreshThenIntroAsync();


            };
            avatarLoader.LoadAvatar(avatarUrl);


        }





        private async Task RefreshThenIntroAsync()
        {
            await RefreshSummaryAtStartAsync();
            string line = await GenerateGreetingFromSummaryAsync(meta?.lastSummary ?? "", displayName);
            StartCoroutine(AvatarIntroOnce(line));
        }



        private IEnumerator AvatarIntroOnce(String line)
        {
            if (hasGreetedOnce) yield break;
            hasGreetedOnce = true;

            //string line = BuildGreetingFromSummary(meta?.lastSummary);

            if (dialogueUI)
            {
                dialogueUI.Show();
                dialogueUI.SetTyping(false);
                dialogueUI.AddBot(line);
            }

            if (dialogueFollow)
            {
                dialogueFollow.enabled = true;
                if (!dialogueFollow.target && avatar) dialogueFollow.target = avatar.transform;
            }

            EnsureUserFacingAvatar();
            yield return SynthesizeAndPlayWithElevenLabs(line, "Talking", "smile");
        }




        private void OnEnable()
        {
            if (recordAction != null)
            {
                recordAction.action.performed += StartRecording;
                recordAction.action.canceled += StopRecording;
            }
        }

        private void OnDisable()
        {
            if (recordAction != null)
            {
                recordAction.action.performed -= StartRecording;
                recordAction.action.canceled -= StopRecording;
            }
        }

        private void PlayBodyAnimation(string label)
        {
            if (!animator) { Debug.LogWarning("Animator is null"); return; }

            // normalize the label coming from OpenAI
            var k = (label ?? "").Trim().ToLowerInvariant();

            // map to the exact state names in your controller (case-sensitive)
            string state = k switch
            {
                "talking" => "Talking",
                "sad" => "Sad",
                "excited" => "Excited",
                _ => "Idle"
            };

            const int layer = 0;                      // Base Layer
            int hash = Animator.StringToHash(state);

            if (!animator.HasState(layer, hash))
            {
                Debug.LogWarning(
                    $"Animator state '{state}' not found on layer {layer}. " +
                    $"Controller = '{animator.runtimeAnimatorController?.name}'. " +
                    $"Check spelling/case and that this controller is assigned.");
                return;
            }

            animator.CrossFade(hash, 0.12f, layer);   // <- targets layer 0, no -1 warning
        }

        private void StartRecording(InputAction.CallbackContext context)
        {
            if (!isRecording)
            {
                if (dialogueUI) { 
                    dialogueUI.Show(); 
                    dialogueUI.SetTyping(false);
                }
               
                clip = Microphone.Start(null, false, 20, 44100);
                isRecording = true;

                if (dialogueFollow) dialogueFollow.enabled = true;   // follow beside avatar
                EnsureUserFacingAvatar();
            }
        }

        private void EnsureUserFacingAvatar()
        {
            if (!xrOrigin || !avatar) return;

            Transform head = xrOrigin.Camera ? xrOrigin.Camera.transform : Camera.main.transform;
            if (!head) return;

            Vector3 toAvatar = avatar.transform.position - head.position;
            toAvatar.y = 0f;
            if (toAvatar.sqrMagnitude < 0.0001f) return;

            float targetYaw = Quaternion.LookRotation(toAvatar, Vector3.up).eulerAngles.y;
            float currentYaw = xrOrigin.transform.eulerAngles.y;
            float deltaYaw = Mathf.DeltaAngle(currentYaw, targetYaw);

            if (Mathf.Abs(deltaYaw) < autoFaceThreshold) return; // small angle? do nothing
            RotateOriginAroundHead(deltaYaw);
        }

        private void RotateOriginAroundHead(float deltaYawDeg)
        {
            // safe, version-agnostic rotation around the HMD position
            Transform head = xrOrigin.Camera ? xrOrigin.Camera.transform : Camera.main.transform;
            var origin = xrOrigin.transform;

            Quaternion rot = Quaternion.AngleAxis(deltaYawDeg, Vector3.up);
            Vector3 pivot = head.position;
            Vector3 offset = origin.position - pivot;

            origin.position = pivot + rot * offset;
            origin.rotation = rot * origin.rotation;
        }
        private IEnumerator PlayChoicesSequentiallyWithUI(ChatChoice[] choices)
        {
            if (dialogueUI) dialogueUI.SetTyping(false);

            foreach (var c in choices)
            {
                // Show the assistant text immediately in the chat
                if (dialogueUI && !string.IsNullOrWhiteSpace(c.text))
                {
                    dialogueUI.AddBot(c.text.Trim());
                    _ = AppendTurnAsync("assistant", c.text.Trim());
                }

                // Speak it with expression + animation
                yield return SynthesizeAndPlayWithElevenLabs(
                    c.text,
                    string.IsNullOrEmpty(c.body_animation) ? "Talking" : c.body_animation,
                    c.facial_expression
                );

                // small beat between lines
                yield return new WaitForSeconds(0.15f);
            }

            // back to Idle (audio coroutine already does this), and stop typing
            if (dialogueUI) dialogueUI.SetTyping(false);
        }

        private IEnumerator SynthesizeAndPlayWithElevenLabs(string text, string bodyAnim = "Talking", string faceExpr = null)
        {
            if (string.IsNullOrWhiteSpace(text)) yield break;
            EnsureAudioSource();

            string url = $"https://api.elevenlabs.io/v1/text-to-speech/{elevenLabVoice}?output_format=mp3_44100_128";
            var payloadObj = new ElevenTtsPayload { text = text };
            string json = JsonUtility.ToJson(payloadObj);

            var req = new UnityWebRequest(url, "POST");
            req.uploadHandler = new UploadHandlerRaw(Encoding.UTF8.GetBytes(json));
            req.downloadHandler = new DownloadHandlerAudioClip(url, AudioType.MPEG);
            req.SetRequestHeader("Content-Type", "application/json");
            req.SetRequestHeader("Accept", "audio/mpeg");
            req.SetRequestHeader("xi-api-key", elevenLabID);

            yield return req.SendWebRequest();
            if (req.result != UnityWebRequest.Result.Success)
            {
                var body = req.downloadHandler?.data != null ? Encoding.UTF8.GetString(req.downloadHandler.data) : "";
                Debug.LogError($"ElevenLabs TTS error: {req.responseCode} {req.error}\n{body}");
                yield break;
            }

            var ttsClip = DownloadHandlerAudioClip.GetContent(req);
            if (!ttsClip) { Debug.LogError("ElevenLabs returned no audio clip"); yield break; }
            while (ttsClip.loadState == AudioDataLoadState.Loading) yield return null;

            // start expression & body anim for the duration of the clip
            if (!string.IsNullOrEmpty(faceExpr)) ApplyExpression(faceExpr, ttsClip.length);
            PlayBodyAnimation(string.IsNullOrEmpty(bodyAnim) ? "Talking" : bodyAnim);

            audioSource.Stop();
            audioSource.clip = ttsClip;
            audioSource.time = 0f;
            audioSource.loop = false;
            audioSource.volume = 1f;
            audioSource.mute = false;
            audioSource.Play();

            while (audioSource.isPlaying) yield return null;

            // <-- return to Idle after the line
            PlayBodyAnimation("Idle");
        }

        private async void StopRecording(InputAction.CallbackContext context)
        {
            if (isRecording)
            {
        
               
                isRecording = false;
                Debug.Log("Recording stopped.");
                // Process the recorded audio clip here

                int sampleCount = Microphone.GetPosition(null); // get samples recorded
                Microphone.End(null);
                if (sampleCount <= 0) sampleCount = clip ? clip.samples : 0;
                if (sampleCount > 0)
                {
                    float[] samples = new float[sampleCount * clip.channels];
                    clip.GetData(samples, 0);

                    AudioClip trimmedClip = AudioClip.Create("TrimmedClip", sampleCount, clip.channels, clip.frequency, false);
                    trimmedClip.SetData(samples, 0);
                    clip = trimmedClip;
                }

                Debug.Log("Recording Stopped. Length: " + clip.length + " seconds");

                byte[] data = SaveWav.Save(fileName, clip);

                var req = new CreateAudioTranscriptionsRequest
                {
                    FileData = new FileData() { Data = data, Name = "audio.wav" },
                    // File = Application.persistentDataPath + "/" + fileName,
                    Model = "whisper-1",
                    Language = "en"
                };
                var res = await openai.CreateAudioTranscription(req);
                Debug.Log("Transcription: " + res.Text);
                if (dialogueUI && !string.IsNullOrWhiteSpace(res.Text))
                {
                    dialogueUI.AddUser(res.Text.Trim());
                    await AppendTurnAsync("user", res.Text.Trim());
                    dialogueUI.SetTyping(true);
                }

                const float TOPIC_MIN = 0.30f;

                // === Retrieve 1 Topic + 1 Strategy from Supabase via embeddings ===
                RagClient.OneTS pick = null;
                try
                {
                    pick = await rag.GetOneTopicOneStrategyAsync(res.Text.Trim(), 0.25f, 0.20f, true);
                    if (pick != null)
                    {
                        Debug.Log($"RAG Topic: {pick.topic_text} (sim {pick.topic_similarity:F2})");
                        Debug.Log($"RAG Strategy: {pick.strategy_text} (sim {pick.strategy_similarity:F2})");
                    }
                }
                catch (Exception ex)
                {
                    Debug.LogWarning("RAG fetch failed: " + ex.Message);
                }

                bool hasTopic = pick != null
                 && !string.IsNullOrWhiteSpace(pick.topic_text)
                 && pick.topic_similarity >= TOPIC_MIN;

                Debug.Log(pick.topic_similarity);



                var ctx = hasTopic
                ? $"Context:\nTopic: {pick.topic_text}\nStrategy: {pick.strategy_text}\nUse this context to guide the reply.\n"
                : $"Context:\nStrategy: {pick?.strategy_text}\nUse the strategy to guide the reply.\n";


                string functionUrl = "https://asia-southeast1-.cloudfunctions.net/extractFactsForTurn";
                KgOut kg = null;
                try
                {
                    kg = await KgClient.GetFactsForTurnAsync(functionUrl, SessionData.NRIC, res.Text);
                }
                catch (Exception ex)
                {
                    Debug.LogWarning("KG fetch failed: " + ex.Message);
                    kg = new KgOut { facts = new List<string>(), avoids = new List<string>() };
                }
                string background = FormatBackgroundForPrompt(kg?.facts ?? new List<string>(), kg?.avoids ?? new List<string>());

                Debug.Log($"[KG Background]\n{background}");

                List<ChatMessage> messages = new List<ChatMessage>
                {
                    new ChatMessage
                    {
                        Role = "system",
                        Content = "You are a friendly, positive companion for elderly. Use the Background and Context to steer the reply and ask gentle follow-ups."
                    },
                    new ChatMessage { Role = "system", Content = background }, // KG facts/avoids
                    new ChatMessage
                    {
                        Role = "system",
                        Content = "ALWAYS reply with ONLY a raw JSON array (no prose, no markdown). " +
                                  "Schema: [{\"text\": string, \"facial_expression\": \"smile|sad|angry\", \"body_animation\": \"Idle|Talking|Excited|Sad\"}] " +
                                  "Min 1 item, Max 3 items."
                    },
                    new ChatMessage { Role = "system", Content = ctx },        //  RAG context
                    new ChatMessage { Role = "user", Content = string.IsNullOrEmpty(res.Text) ? "Hello!" : res.Text }
                };



                // Complete the instruction
                var completionResponse = await openai.CreateChatCompletion(new CreateChatCompletionRequest()
                {
                    Model = "gpt-4o-mini",
                    Messages = messages
                });

                if (completionResponse.Choices != null && completionResponse.Choices.Count > 0)
                {
                    var message = completionResponse.Choices[0].Message;
                    Debug.Log("ChatGPT Response: " + message.Content);
                    ChatChoice[] choices = ParseChoiceArray(message.Content);
                    if (choices != null && choices.Length > 0)
                    {
                        EnsureAudioSource();
                        StartCoroutine(PlayChoicesSequentiallyWithUI(choices));
                    }
                    else
                    {
                        Debug.LogWarning("Failed to parse JSON; fallback to one TTS call.");
                        EnsureAudioSource();
                        if (dialogueUI && !string.IsNullOrWhiteSpace(message.Content))
                        {
                            dialogueUI.SetTyping(false);
                            dialogueUI.AddBot(message.Content.Trim());
                            await AppendTurnAsync("assistant", message.Content.Trim());
                        }
                        if (audioSource) StartCoroutine(SynthesizeAndPlayWithElevenLabs(message.Content));
                    }
                }
            }
        }



        private void OnDestroy()
        {
            if (avatar != null) Destroy(avatar);
        }

    }
}
