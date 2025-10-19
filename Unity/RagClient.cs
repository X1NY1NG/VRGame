using OpenAI;
using System;
using System.Collections.Generic;
using System.Text;
using System.Threading.Tasks;
using Newtonsoft.Json;
using UnityEngine;
using UnityEngine.Networking;

public sealed class RagClient
{
    private readonly string supabaseUrl;
    private readonly string supabaseAnon;
    private readonly string openAiKey;
    private readonly OpenAIApi openai;

    [Serializable] private class EmbeddingData { public List<double> embedding; }
    [Serializable] private class EmbeddingsResponse { public List<EmbeddingData> data; }


    // DTO returned by the RPC
    [Serializable]
    public class OneTS
    {
        public string topic_id;
        public string topic_text;
        public Dictionary<string, object> topic_metadata;
        public float topic_similarity;

        public string strategy_id;
        public string strategy_text;
        public Dictionary<string, object> strategy_metadata;
        public float strategy_similarity;
    }

    public RagClient(string supabaseUrl, string supabaseAnon, string openAiKey)
    {
        this.supabaseUrl = supabaseUrl.TrimEnd('/');
        this.supabaseAnon = supabaseAnon;
        this.openAiKey = openAiKey; // for Embeddings only (or call your Edge Function instead)
    }

    // Public convenience: text -> (topic,strategy)
    public async Task<OneTS?> GetOneTopicOneStrategyAsync(string userText,
        float minTopic = 0.25f, float minStrategy = 0.20f, bool fallback = true)
    {
        var qvec = await EmbedAsync(userText);
        return await MatchOneTopicStrategyAsync(qvec, minTopic, minStrategy, fallback);
    }

    // --- Internals ---

    private async Task<float[]> EmbedAsync(string text)
    {
        if (openai != null)
        {
            var req = new CreateEmbeddingsRequest
            {
                Model = "text-embedding-3-small",
                Input = text
            };
            var res = await openai.CreateEmbeddings(req);

            // Some SDK versions return List<double>, others List<float>.
            var arrD = res.Data[0].Embedding;
            var vec = new float[arrD.Count];
            for (int i = 0; i < arrD.Count; i++) vec[i] = (float)arrD[i];
            return vec;
        }

        // ---- fallback: raw HTTP if you constructed RagClient with an API key string ----
        var url = "https://api.openai.com/v1/embeddings";
        var payload = new { model = "text-embedding-3-small", input = text };
        var json = JsonConvert.SerializeObject(payload);

        using var reqHttp = new UnityWebRequest(url, "POST");
        reqHttp.uploadHandler = new UploadHandlerRaw(Encoding.UTF8.GetBytes(json));
        reqHttp.downloadHandler = new DownloadHandlerBuffer();
        reqHttp.SetRequestHeader("Content-Type", "application/json");
        reqHttp.SetRequestHeader("Authorization", "Bearer " + openAiKey);

        var op = reqHttp.SendWebRequest();
        while (!op.isDone) await Task.Yield();
        if (reqHttp.result != UnityWebRequest.Result.Success)
            throw new Exception($"Embeddings error {reqHttp.responseCode}: {reqHttp.error}\n{reqHttp.downloadHandler.text}");

        var obj = JsonConvert.DeserializeObject<EmbeddingsResponse>(reqHttp.downloadHandler.text);
        var src = obj.data[0].embedding;
        var vec2 = new float[src.Count];
        for (int i = 0; i < src.Count; i++) vec2[i] = (float)src[i];
        return vec2;
    }


    private async Task<OneTS?> MatchOneTopicStrategyAsync(float[] qvec, float minTopic, float minStrategy, bool fallback)
    {
        var url = $"{supabaseUrl}/rest/v1/rpc/match_one_topic_strategy";
        var bodyObj = new
        {
            qvec = qvec,
            min_sim_topic = minTopic,
            min_sim_strategy = minStrategy,
            fallback = fallback
        };
        var json = JsonConvert.SerializeObject(bodyObj);

        using var req = new UnityWebRequest(url, "POST");
        req.uploadHandler = new UploadHandlerRaw(Encoding.UTF8.GetBytes(json));
        req.downloadHandler = new DownloadHandlerBuffer();
        req.SetRequestHeader("Content-Type", "application/json");
        req.SetRequestHeader("apikey", supabaseAnon);
        req.SetRequestHeader("Authorization", "Bearer " + supabaseAnon);

        var op = req.SendWebRequest();
        while (!op.isDone) await Task.Yield();

        if (req.result != UnityWebRequest.Result.Success)
            throw new Exception($"Supabase RPC error {req.responseCode}: {req.error}\n{req.downloadHandler.text}");

        var list = JsonConvert.DeserializeObject<List<OneTS>>(req.downloadHandler.text);
        return (list != null && list.Count > 0) ? list[0] : null;
    }
}
