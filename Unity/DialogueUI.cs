using System.Collections;
using UnityEngine;
using UnityEngine.UI;
using TMPro;

public class DialogueUI : MonoBehaviour
{
    [Header("Wiring")]
    [SerializeField] private ScrollRect scrollRect;        // the Scroll View
    [SerializeField] private RectTransform contentRoot;    // Scroll View -> Viewport -> Content
    [SerializeField] private GameObject botBubblePrefab;   // left bubble
    [SerializeField] private GameObject userBubblePrefab;  // right bubble
    [SerializeField] private GameObject typingPrefab;      // optional typing indicator

    private CanvasGroup cg;
    private GameObject typingInstance;

    void Awake()
    {
        cg = GetComponent<CanvasGroup>() ?? gameObject.AddComponent<CanvasGroup>();
        if (scrollRect && contentRoot == null) contentRoot = scrollRect.content;

    }

    // === Use these instead of SetActive ===
    public void Show()
    {
        EnsureCG();
        cg.alpha = 1f;
        cg.interactable = true;
        cg.blocksRaycasts = true;
        StartCoroutine(ScrollToBottomSoon());
    }

    public void Hide()
    {
        EnsureCG();
        cg.alpha = 0f;
        cg.interactable = false;
        cg.blocksRaycasts = false;
        // do NOT disable GameObject, so coroutines can still run
    }

    // Backwards-compat names if other scripts call them
    public void Open() => Show();
    public void Close() => Hide();
    public void Toggle()
    {
        EnsureCG();
        if (cg.alpha > 0.5f) Hide(); else Show();
    }

    public void Clear()
    {
        if (!contentRoot) return;
        foreach (Transform c in contentRoot) Destroy(c.gameObject);
        typingInstance = null;
    }

    public void AddUser(string text) => AddBubble(userBubblePrefab, $"You: {text}");
    public void AddBot(string text) => AddBubble(botBubblePrefab, $"Companion: {text}");

    private void AddBubble(GameObject prefab, string text)
    {
        if (!prefab || !contentRoot) return;
        var go = Instantiate(prefab, contentRoot, false);
        var tmp = go.GetComponentInChildren<TMP_Text>(true);
        if (tmp) tmp.text = text;
        LayoutRebuilder.ForceRebuildLayoutImmediate(contentRoot);
        StartCoroutine(ScrollToBottomSoon());
    }

    public void SetTyping(bool on)
    {
        if (!typingPrefab || !contentRoot) return;

        if (on)
        {
            if (!typingInstance)
                typingInstance = Instantiate(typingPrefab, contentRoot, false);
        }
        else
        {
            if (typingInstance) Destroy(typingInstance);
            typingInstance = null;
        }
        LayoutRebuilder.ForceRebuildLayoutImmediate(contentRoot);
        StartCoroutine(ScrollToBottomSoon());
    }

    public void CloseDialogue()
    {
        Hide();
    }

    private IEnumerator ScrollToBottomSoon()
    {
        yield return null; yield return null;  // wait for layout
        if (scrollRect)
        {
            Canvas.ForceUpdateCanvases();
            scrollRect.verticalNormalizedPosition = 0f;
        }
    }

    private void EnsureCG()
    {
        if (!cg) cg = GetComponent<CanvasGroup>() ?? gameObject.AddComponent<CanvasGroup>();
    }
}