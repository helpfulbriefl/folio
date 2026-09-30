using Folio.Core.Text;

namespace Folio.Core;

/// <summary>Appends quick notes (Ctrl+Alt+N) to a markdown file grouped by day.</summary>
public static class QuickNotes
{
    public static string Heading(DateTime t) => "## " + t.ToString("dd.MM.yyyy");

    public static string Append(string file, string note, DateTime now, string title = "Быстрые заметки")
    {
        note = note.Replace("\r\n", "\n").Replace('\r', '\n').Trim('\n', ' ');
        if (note.Length == 0) return file;
        var lines = note.Split('\n');
        var bullet = "- " + now.ToString("HH:mm") + " " + lines[0] + string.Concat(lines.Skip(1).Select(l => "\n  " + l));

        string text = "", enc = "utf-8", eol = Environment.NewLine == "\n" ? "lf" : "crlf";
        bool bom = false;
        if (File.Exists(file))
        {
            var lt = TextFile.Load(file);
            text = lt.Text; enc = lt.Encoding; bom = lt.Bom; eol = lt.Eol;
        }
        var heading = Heading(now);
        string? lastHeading = null;
        foreach (var l in text.Split('\n'))
            if (l.StartsWith("## ", StringComparison.Ordinal)) lastHeading = l.TrimEnd();

        var sb = new System.Text.StringBuilder(text);
        if (text.Length == 0) sb.Append("# ").Append(title).Append("\n\n");
        else if (!text.EndsWith('\n')) sb.Append('\n');
        if (lastHeading != heading)
        {
            if (sb.Length > 0 && !sb.ToString().EndsWith("\n\n", StringComparison.Ordinal) && text.Length > 0) sb.Append('\n');
            sb.Append(heading).Append("\n\n");
        }
        sb.Append(bullet).Append('\n');
        var r = TextFile.Save(file, sb.ToString(), enc, bom, eol, keepVersion: false);
        if (!r.Ok) throw new FolioFileException(r.Error ?? "io", r.Message ?? "save failed");
        return file;
    }
}
