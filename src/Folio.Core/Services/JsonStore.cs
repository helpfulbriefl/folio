using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Folio.Core;

/// <summary>Small helpers to keep JSON files safe: atomic writes, broken files are moved aside instead of crashing.</summary>
public static class JsonStore
{
    public static readonly JsonSerializerOptions Options = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = true,
        Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    public static JsonNode? LoadNode(string path)
    {
        try
        {
            if (!File.Exists(path)) return null;
            var text = File.ReadAllText(path, Encoding.UTF8);
            if (string.IsNullOrWhiteSpace(text)) return null;
            return JsonNode.Parse(text, documentOptions: new JsonDocumentOptions { AllowTrailingCommas = true, CommentHandling = JsonCommentHandling.Skip });
        }
        catch (Exception ex)
        {
            Log.Warn($"{Path.GetFileName(path)} is damaged and was put aside: {ex.Message}");
            try { File.Copy(path, path + ".bad", true); } catch { }
            return null;
        }
    }

    public static T? Load<T>(string path) where T : class
    {
        var node = LoadNode(path);
        if (node == null) return null;
        try { return node.Deserialize<T>(Options); }
        catch (Exception ex) { Log.Warn($"{Path.GetFileName(path)}: {ex.Message}"); return null; }
    }

    public static void SaveNode(string path, JsonNode? node) => WriteAtomic(path, node?.ToJsonString(Options) ?? "null");

    public static void Save<T>(string path, T value) => WriteAtomic(path, JsonSerializer.Serialize(value, Options));

    public static void WriteAtomic(string path, string content)
    {
        var dir = Path.GetDirectoryName(path)!;
        Directory.CreateDirectory(dir);
        var tmp = path + ".tmp";
        File.WriteAllText(tmp, content, new UTF8Encoding(false));
        try
        {
            if (File.Exists(path)) File.Replace(tmp, path, null, true);
            else File.Move(tmp, path);
        }
        catch (Exception)
        {
            File.Copy(tmp, path, true);
            try { File.Delete(tmp); } catch { }
        }
    }
}
