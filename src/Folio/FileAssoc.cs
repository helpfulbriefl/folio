using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.Json.Nodes;
using Folio.Core;
using Microsoft.Win32;

namespace Folio;

/// <summary>
/// "Open with Folio" for text file types (settings → General → File types). Per-user only (HKCU, no admin rights):
/// registers the Folio.Document ProgID and adds it to each extension's OpenWithProgids. Since Windows 10 an app cannot
/// silently make itself the default, so the UI also offers to open Windows "Default apps".
/// </summary>
internal static class FileAssoc
{
    public const string ProgId = "Folio.Document";
    public static readonly string[] Known = { "txt", "md", "markdown", "log", "json", "jsonc", "xml", "yaml", "yml", "ini", "cfg", "conf", "csv", "tsv", "toml", "nfo", "srt", "js", "ts", "css", "html", "py", "cs", "sql", "ps1", "bat", "sh" };

    [DllImport("shell32.dll")] static extern void SHChangeNotify(int wEventId, uint uFlags, IntPtr dwItem1, IntPtr dwItem2);
    const int SHCNE_ASSOCCHANGED = 0x08000000;

    static string Norm(string e) => e.Trim().TrimStart('.').ToLowerInvariant();
    static bool Valid(string e) => e.Length is > 0 and <= 16 && e.All(c => char.IsLetterOrDigit(c) || c is '-' or '_');

    public static JsonObject State()
    {
        var reg = new JsonObject();
        var def = new JsonObject();
        foreach (var e in Known)
        {
            reg[e] = IsRegistered(e);
            def[e] = IsDefault(e);
        }
        return new JsonObject { ["known"] = new JsonArray(Known.Select(x => (JsonNode)x).ToArray()), ["registered"] = reg, ["isDefault"] = def };
    }

    static bool IsRegistered(string e)
    {
        try
        {
            using var k = Registry.CurrentUser.OpenSubKey($@"Software\Classes\.{e}\OpenWithProgids");
            return k?.GetValueNames().Contains(ProgId, StringComparer.OrdinalIgnoreCase) == true;
        }
        catch { return false; }
    }

    static bool IsDefault(string e)
    {
        try
        {
            using var k = Registry.CurrentUser.OpenSubKey($@"Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.{e}\UserChoice");
            var pid = k?.GetValue("ProgId") as string ?? "";
            return pid.Equals(ProgId, StringComparison.OrdinalIgnoreCase) || pid.EndsWith("Folio.exe", StringComparison.OrdinalIgnoreCase);
        }
        catch { return false; }
    }

    /// <summary>Makes exactly these extensions offer Folio ("Open with"); the others are cleaned up.</summary>
    public static JsonObject Set(IEnumerable<string> wanted)
    {
        var exe = Environment.ProcessPath ?? "";
        var on = wanted.Select(Norm).Where(Valid).ToHashSet();
        var failed = new List<string>();
        try
        {
            using (var p = Registry.CurrentUser.CreateSubKey($@"Software\Classes\{ProgId}"))
            {
                p.SetValue("", "Folio document");
                p.SetValue("FriendlyTypeName", "Folio document");
                using (var ic = p.CreateSubKey("DefaultIcon")) ic.SetValue("", $"\"{exe}\",0");
                using (var cmd = p.CreateSubKey(@"shell\open\command")) cmd.SetValue("", $"\"{exe}\" \"%1\"");
            }
            using (var app = Registry.CurrentUser.CreateSubKey(@"Software\Classes\Applications\Folio.exe"))
            {
                app.SetValue("FriendlyAppName", "Folio");
                using (var cmd = app.CreateSubKey(@"shell\open\command")) cmd.SetValue("", $"\"{exe}\" \"%1\"");
                using var types = app.CreateSubKey("SupportedTypes");
                foreach (var n in types.GetValueNames()) if (!on.Contains(Norm(n))) types.DeleteValue(n, false);
                foreach (var e in on) types.SetValue("." + e, "");
            }
        }
        catch (Exception ex) { Log.Warn("File types: ProgID: " + ex.Message); return new JsonObject { ["ok"] = false, ["message"] = ex.Message }; }

        foreach (var e in Known.Concat(on).Distinct())
        {
            try
            {
                using var k = Registry.CurrentUser.CreateSubKey($@"Software\Classes\.{e}\OpenWithProgids");
                if (on.Contains(e)) k.SetValue(ProgId, Array.Empty<byte>(), RegistryValueKind.None);
                else if (k.GetValue(ProgId) != null) k.DeleteValue(ProgId, false);
            }
            catch (Exception ex) { failed.Add(e); Log.Warn($"File types: .{e}: {ex.Message}"); }
        }
        try { SHChangeNotify(SHCNE_ASSOCCHANGED, 0, IntPtr.Zero, IntPtr.Zero); } catch { }
        Log.Info("File types for Folio: " + (on.Count == 0 ? "none" : string.Join(", ", on.Order())));
        var r = State();
        r["ok"] = failed.Count == 0;
        r["failed"] = new JsonArray(failed.Select(x => (JsonNode)x).ToArray());
        return r;
    }

    /// <summary>Windows Settings → Default apps (the user confirms the default there).</summary>
    public static void OpenDefaultApps()
    {
        try { Process.Start(new ProcessStartInfo("ms-settings:defaultapps") { UseShellExecute = true })?.Dispose(); }
        catch (Exception ex) { Log.Warn("Default apps: " + ex.Message); }
    }
}
