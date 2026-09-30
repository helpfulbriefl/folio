using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Folio.Core;

/// <summary>Hot exit: the list of open tabs lives in session.json, unsaved texts in backups\&lt;tabId&gt;.txt.</summary>
public static partial class SessionStore
{
    [GeneratedRegex("^[A-Za-z0-9_-]{1,48}$")]
    private static partial Regex SafeId();

    public static bool IsSafeId(string? id) => id != null && SafeId().IsMatch(id);

    /// <summary>Saves the session. Tabs carrying a "text" property get it written to a backup file (the property is not stored in JSON).</summary>
    public static void Save(JsonObject session)
    {
        Directory.CreateDirectory(AppPaths.Backups);
        var keep = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        if (session["tabs"] is JsonArray tabs)
        {
            foreach (var node in tabs)
            {
                if (node is not JsonObject tab) continue;
                var id = tab["id"]?.GetValue<string>();
                if (!IsSafeId(id)) continue;
                if (tab["text"] is JsonNode textNode)
                {
                    var text = textNode.GetValue<string>();
                    tab.Remove("text");
                    var file = Path.Combine(AppPaths.Backups, id + ".txt");
                    JsonStore.WriteAtomic(file, text);
                    tab["backup"] = true;
                    keep.Add(id + ".txt");
                }
                else if (tab["backup"]?.GetValue<bool>() == true)
                {
                    // unchanged since the last save: keep the existing backup
                    keep.Add(id + ".txt");
                }
            }
        }
        JsonStore.SaveNode(AppPaths.Session, session);
        foreach (var f in Directory.GetFiles(AppPaths.Backups, "*.txt"))
            if (!keep.Contains(Path.GetFileName(f)))
                try { File.Delete(f); } catch { }
    }

    public static JsonObject? Load()
    {
        if (LoadNodeSafe() is not JsonObject session) return null;
        if (session["tabs"] is JsonArray tabs)
        {
            foreach (var node in tabs)
            {
                if (node is not JsonObject tab) continue;
                var id = tab["id"]?.GetValue<string>();
                if (!IsSafeId(id) || tab["backup"]?.GetValue<bool>() != true) continue;
                var file = Path.Combine(AppPaths.Backups, id + ".txt");
                if (File.Exists(file))
                {
                    try { tab["text"] = File.ReadAllText(file, Encoding.UTF8); }
                    catch (Exception ex) { Log.Warn("Backup read failed: " + ex.Message); tab["backup"] = false; }
                }
                else tab["backup"] = false;
            }
        }
        return session;
    }

    static JsonNode? LoadNodeSafe()
    {
        try { return JsonStore.LoadNode(AppPaths.Session); }
        catch { return null; }
    }
}
