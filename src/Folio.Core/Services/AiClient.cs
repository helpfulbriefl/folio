using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Folio.Core;

public sealed class AiMessage
{
    public string Role { get; set; } = "user";
    public string Content { get; set; } = "";
}

public sealed class AiRequest
{
    public string BaseUrl { get; set; } = "https://api.openai.com/v1";
    public string? ApiKey { get; set; }
    public string Model { get; set; } = "gpt-4o-mini";
    public List<AiMessage> Messages { get; set; } = new();
    public double? Temperature { get; set; }
    public int? MaxTokens { get; set; }
    public bool Stream { get; set; } = true;
    public int TimeoutSeconds { get; set; } = 120;
}

public sealed class AiException : Exception
{
    public string Code { get; }
    public int Status { get; }
    public AiException(string code, string message, int status = 0, Exception? inner = null) : base(message, inner) { Code = code; Status = status; }
}

/// <summary>Client for any OpenAI-compatible chat completions API (OpenAI, OpenRouter, DeepSeek, Groq, Mistral, Ollama, LM Studio…).</summary>
public static class AiClient
{
    static HttpClient? _http;
    static HttpClient Http => _http ??= CreateHttp();

    static HttpClient CreateHttp()
    {
        var h = new HttpClient(new SocketsHttpHandler
        {
            AutomaticDecompression = DecompressionMethods.All,
            ConnectTimeout = TimeSpan.FromSeconds(20),
            PooledConnectionLifetime = TimeSpan.FromMinutes(5),
        })
        { Timeout = Timeout.InfiniteTimeSpan };
        h.DefaultRequestHeaders.UserAgent.Add(new ProductInfoHeaderValue("Folio", UpdateChecker.CurrentVersion));
        return h;
    }

    public static string Endpoint(string baseUrl, string path)
    {
        var b = (baseUrl ?? "").Trim().TrimEnd('/');
        if (b.EndsWith("/chat/completions", StringComparison.OrdinalIgnoreCase)) b = b[..^"/chat/completions".Length];
        return b + "/" + path.TrimStart('/');
    }

    static void Authorize(HttpRequestMessage req, string? key, string baseUrl)
    {
        if (!string.IsNullOrWhiteSpace(key)) req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", key.Trim());
        if (baseUrl.Contains("openrouter.ai", StringComparison.OrdinalIgnoreCase))
        {
            req.Headers.TryAddWithoutValidation("HTTP-Referer", UpdateChecker.RepoUrl);
            req.Headers.TryAddWithoutValidation("X-Title", "Folio");
        }
    }

    /// <summary>Sends the chat, calls onDelta with pieces of the answer as they arrive, returns the whole answer.</summary>
    public static async Task<string> CompleteAsync(AiRequest r, Action<string>? onDelta, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(r.BaseUrl)) throw new AiException("config", "API address is empty");
        if (string.IsNullOrWhiteSpace(r.Model)) throw new AiException("config", "Model is not selected");
        var body = new JsonObject
        {
            ["model"] = r.Model,
            ["messages"] = new JsonArray(r.Messages.Select(m => (JsonNode)new JsonObject { ["role"] = m.Role, ["content"] = m.Content }).ToArray()),
            ["stream"] = r.Stream,
        };
        if (r.Temperature is double t) body["temperature"] = t;
        if (r.MaxTokens is int mt && mt > 0) body["max_tokens"] = mt;

        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        cts.CancelAfter(TimeSpan.FromSeconds(Math.Clamp(r.TimeoutSeconds, 10, 900)));
        using var req = new HttpRequestMessage(HttpMethod.Post, Endpoint(r.BaseUrl, "chat/completions"))
        {
            Content = new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json"),
        };
        Authorize(req, r.ApiKey, r.BaseUrl);
        if (r.Stream) req.Headers.Accept.ParseAdd("text/event-stream");
        HttpResponseMessage resp;
        try { resp = await Http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, cts.Token); }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw new AiException("cancelled", "Cancelled"); }
        catch (OperationCanceledException ex) { throw new AiException("timeout", "The server did not answer in time", 0, ex); }
        catch (HttpRequestException ex) { throw new AiException("network", ex.Message, 0, ex); }

        using (resp)
        {
            if (!resp.IsSuccessStatusCode)
            {
                string text = "";
                try { text = await resp.Content.ReadAsStringAsync(cts.Token); } catch { }
                throw MapError((int)resp.StatusCode, text);
            }
            var media = resp.Content.Headers.ContentType?.MediaType ?? "";
            try
            {
                if (media.Contains("event-stream", StringComparison.OrdinalIgnoreCase))
                    return await ReadStreamAsync(resp, onDelta, cts.Token);
                var json = await resp.Content.ReadAsStringAsync(cts.Token);
                var answer = ParseFull(json);
                onDelta?.Invoke(answer);
                return answer;
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw new AiException("cancelled", "Cancelled"); }
            catch (OperationCanceledException ex) { throw new AiException("timeout", "The answer took too long", 0, ex); }
            catch (IOException ex) { throw new AiException("network", ex.Message, 0, ex); }
        }
    }

    static async Task<string> ReadStreamAsync(HttpResponseMessage resp, Action<string>? onDelta, CancellationToken ct)
    {
        await using var s = await resp.Content.ReadAsStreamAsync(ct);
        using var reader = new StreamReader(s, Encoding.UTF8);
        var all = new StringBuilder();
        var data = new StringBuilder();
        while (true)
        {
            var line = await reader.ReadLineAsync(ct);
            if (line == null) break;
            if (line.Length == 0)
            {
                if (data.Length > 0 && Dispatch(data.ToString(), all, onDelta)) break;
                data.Clear();
                continue;
            }
            if (line.StartsWith(':')) continue;
            if (line.StartsWith("data:", StringComparison.Ordinal))
            {
                var v = line.Length > 5 && line[5] == ' ' ? line[6..] : line[5..];
                if (data.Length > 0) data.Append('\n');
                data.Append(v);
                // many servers send one JSON per line without blank separators – dispatch eagerly when it parses
                if (v == "[DONE]") break;
                if (LooksComplete(v)) { if (Dispatch(data.ToString(), all, onDelta)) break; data.Clear(); }
            }
        }
        if (data.Length > 0) Dispatch(data.ToString(), all, onDelta);
        return all.ToString();
    }

    static bool LooksComplete(string v) => v.StartsWith('{') && v.EndsWith('}');

    /// <returns>true when the stream is finished</returns>
    static bool Dispatch(string payload, StringBuilder all, Action<string>? onDelta)
    {
        if (payload == "[DONE]") return true;
        JsonNode? n;
        try { n = JsonNode.Parse(payload); } catch { return false; }
        if (n?["error"] is JsonNode err)
            throw new AiException("server", err["message"]?.ToString() ?? err.ToJsonString());
        var choice = n?["choices"]?[0];
        var piece = choice?["delta"]?["content"]?.ToString() ?? choice?["message"]?["content"]?.ToString() ?? choice?["text"]?.ToString();
        if (!string.IsNullOrEmpty(piece)) { all.Append(piece); onDelta?.Invoke(piece); }
        return false;
    }

    static string ParseFull(string json)
    {
        JsonNode? n;
        try { n = JsonNode.Parse(json); }
        catch { throw new AiException("format", "The server answered with something that is not JSON"); }
        if (n?["error"] is JsonNode err) throw new AiException("server", err["message"]?.ToString() ?? err.ToJsonString());
        var c = n?["choices"]?[0];
        return c?["message"]?["content"]?.ToString() ?? c?["text"]?.ToString()
            ?? throw new AiException("format", "No answer in the response");
    }

    public static AiException MapError(int status, string body)
    {
        string msg = body;
        try
        {
            var n = JsonNode.Parse(body);
            msg = n?["error"]?["message"]?.ToString() ?? n?["error"]?.ToString() ?? n?["message"]?.ToString() ?? body;
        }
        catch { }
        if (msg.Length > 400) msg = msg[..400] + "…";
        var code = status switch
        {
            401 or 403 => "auth",
            402 => "billing",
            404 => "notFound",
            408 => "timeout",
            413 => "tooLarge",
            429 => "rateLimit",
            >= 500 => "server",
            _ => "http",
        };
        return new AiException(code, string.IsNullOrWhiteSpace(msg) ? $"HTTP {status}" : msg, status);
    }

    public static async Task<IReadOnlyList<string>> ModelsAsync(string baseUrl, string? key, CancellationToken ct)
    {
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        cts.CancelAfter(TimeSpan.FromSeconds(20));
        using var req = new HttpRequestMessage(HttpMethod.Get, Endpoint(baseUrl, "models"));
        Authorize(req, key, baseUrl);
        HttpResponseMessage resp;
        try { resp = await Http.SendAsync(req, cts.Token); }
        catch (OperationCanceledException ex) { throw new AiException("timeout", "The server did not answer in time", 0, ex); }
        catch (HttpRequestException ex) { throw new AiException("network", ex.Message, 0, ex); }
        using (resp)
        {
            var text = await resp.Content.ReadAsStringAsync(cts.Token);
            if (!resp.IsSuccessStatusCode) throw MapError((int)resp.StatusCode, text);
            var list = new List<string>();
            try
            {
                var n = JsonNode.Parse(text);
                var arr = n?["data"] as JsonArray ?? n?["models"] as JsonArray ?? n as JsonArray;
                if (arr != null)
                    foreach (var m in arr)
                    {
                        var id = m?["id"]?.ToString() ?? m?["name"]?.ToString() ?? m?["model"]?.ToString();
                        if (!string.IsNullOrEmpty(id)) list.Add(id);
                    }
            }
            catch { throw new AiException("format", "Unexpected answer from /models"); }
            list.Sort(StringComparer.OrdinalIgnoreCase);
            return list.Distinct().ToList();
        }
    }
}
