using System;
using System.Collections.Generic;
using System.Text;
using System.Threading.Tasks;
using Newtonsoft.Json;
using UnityEngine;
using UnityEngine.Networking;

[Serializable]
public class KgOut
{
    public List<string> facts;
    public List<string> avoids;
}

public static class KgClient
{
    // Call your Firebase HTTPS Function
    public static async Task<KgOut> GetFactsForTurnAsync(string functionUrl, string nricId, string userText)
    {
        var payload = JsonConvert.SerializeObject(new { nricId, text = userText });
        using var req = new UnityWebRequest(functionUrl, "POST");
        req.uploadHandler = new UploadHandlerRaw(Encoding.UTF8.GetBytes(payload));
        req.downloadHandler = new DownloadHandlerBuffer();
        req.SetRequestHeader("Content-Type", "application/json");

        var op = req.SendWebRequest();
        while (!op.isDone)
            await Task.Yield();

        if (req.result != UnityWebRequest.Result.Success)
        {
            Debug.LogWarning($"KG call failed: {req.error}");
            return new KgOut { facts = new List<string>(), avoids = new List<string>() };
        }

        return JsonConvert.DeserializeObject<KgOut>(req.downloadHandler.text);
    }
}
