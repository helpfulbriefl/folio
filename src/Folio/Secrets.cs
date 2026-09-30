using System.Text;
using System.Text.Json.Nodes;
using Folio.Core;

namespace Folio;

/// <summary>API keys, encrypted with Windows DPAPI for the current user (secrets.dat). Keys never go to the UI.</summary>
internal static class Secrets
{
    static readonly object Gate = new();

    static JsonObject Read()
    {
        try
        {
            if (!File.Exists(AppPaths.Secrets)) return new JsonObject();
            var plain = Dpapi.Unprotect(File.ReadAllBytes(AppPaths.Secrets));
            return JsonNode.Parse(Encoding.UTF8.GetString(plain)) as JsonObject ?? new JsonObject();
        }
        catch (Exception ex) { Log.Warn("secrets.dat could not be read: " + ex.Message); return new JsonObject(); }
    }

    static void Write(JsonObject o)
    {
        var bytes = Dpapi.Protect(Encoding.UTF8.GetBytes(o.ToJsonString()));
        var tmp = AppPaths.Secrets + ".tmp";
        File.WriteAllBytes(tmp, bytes);
        File.Move(tmp, AppPaths.Secrets, true);
    }

    static string Norm(string? provider) => string.IsNullOrWhiteSpace(provider) ? "openai" : provider.Trim().ToLowerInvariant();

    public static string? Get(string? provider)
    {
        lock (Gate) return Read()[Norm(provider)]?.GetValue<string>() is { Length: > 0 } k ? k : null;
    }

    public static void Set(string? provider, string? key)
    {
        lock (Gate)
        {
            var o = Read();
            if (string.IsNullOrWhiteSpace(key)) o.Remove(Norm(provider));
            else o[Norm(provider)] = key.Trim();
            Write(o);
        }
    }
}
