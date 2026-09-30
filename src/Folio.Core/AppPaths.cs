namespace Folio.Core;

/// <summary>All locations where Folio keeps its data. Portable mode: put an empty file
/// "folio.portable" next to Folio.exe and everything goes to .\FolioData.</summary>
public static class AppPaths
{
    public static string Roaming { get; private set; } = "";
    public static string Local { get; private set; } = "";
    public static bool Portable { get; private set; }

    public static void Init(string? root = null)
    {
        root ??= Environment.GetEnvironmentVariable("FOLIO_DATA");
        var exeDir = AppContext.BaseDirectory;
        if (string.IsNullOrEmpty(root) && File.Exists(Path.Combine(exeDir, "folio.portable")))
        {
            root = Path.Combine(exeDir, "FolioData");
            Portable = true;
        }
        if (!string.IsNullOrEmpty(root))
        {
            Roaming = Path.Combine(root, "Roaming");
            Local = Path.Combine(root, "Local");
        }
        else
        {
            Roaming = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Folio");
            Local = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Folio");
        }
        foreach (var d in new[] { Roaming, Local, Logs, Backups, Versions, Updates })
            Directory.CreateDirectory(d);
    }

    public static string Settings => Path.Combine(Roaming, "settings.json");
    public static string Recent => Path.Combine(Roaming, "recent.json");
    public static string Session => Path.Combine(Roaming, "session.json");
    public static string UiState => Path.Combine(Roaming, "state.json");
    public static string Window => Path.Combine(Roaming, "window.json");
    public static string Secrets => Path.Combine(Roaming, "secrets.dat");
    public static string Dictionary => Path.Combine(Roaming, "dictionary.txt");
    public static string Logs => Path.Combine(Local, "logs");
    public static string Backups => Path.Combine(Local, "backups");
    public static string Versions => Path.Combine(Local, "versions");
    public static string Updates => Path.Combine(Local, "updates");
    public static string WebView => Path.Combine(Local, "WebView2");

    public static string DefaultNotesDir =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "Folio");
}
