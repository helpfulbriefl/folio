using System.Text;

namespace Folio.Core.Text;

public sealed record EncodingItem(string Id, string Name, int CodePage, string Group);

/// <summary>Canonical encoding ids used everywhere in Folio (UI, settings, recent files).</summary>
public static class TextEncodings
{
    static TextEncodings() => Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
    public static void EnsureRegistered() { }

    // id, display name, code page, group
    static readonly EncodingItem[] Known =
    {
        new("utf-8", "UTF-8", 65001, "unicode"),
        new("utf-16le", "UTF-16 LE", 1200, "unicode"),
        new("utf-16be", "UTF-16 BE", 1201, "unicode"),
        new("utf-32le", "UTF-32 LE", 12000, "unicode"),
        new("utf-32be", "UTF-32 BE", 12001, "unicode"),
        new("windows-1251", "Windows-1251", 1251, "cyrillic"),
        new("cp866", "CP866 (DOS)", 866, "cyrillicDos"),
        new("koi8-r", "KOI8-R", 20866, "cyrillicUnix"),
        new("koi8-u", "KOI8-U", 21866, "cyrillicUnix"),
        new("iso-8859-5", "ISO-8859-5", 28595, "cyrillicIso"),
        new("x-mac-cyrillic", "Mac Cyrillic", 10007, "cyrillic"),
        new("windows-1252", "Windows-1252", 1252, "western"),
        new("iso-8859-1", "ISO-8859-1", 28591, "western"),
        new("iso-8859-15", "ISO-8859-15", 28605, "western"),
        new("windows-1250", "Windows-1250", 1250, "central"),
        new("iso-8859-2", "ISO-8859-2", 28592, "central"),
        new("windows-1253", "Windows-1253", 1253, "greek"),
        new("windows-1254", "Windows-1254", 1254, "turkish"),
        new("windows-1255", "Windows-1255", 1255, "hebrew"),
        new("windows-1256", "Windows-1256", 1256, "arabic"),
        new("windows-1257", "Windows-1257", 1257, "baltic"),
        new("windows-1258", "Windows-1258", 1258, "vietnamese"),
        new("windows-874", "Windows-874", 874, "thai"),
        new("gb18030", "GB18030", 54936, "chinese"),
        new("gbk", "GBK", 936, "chinese"),
        new("big5", "Big5", 950, "chineseTrad"),
        new("shift_jis", "Shift-JIS", 932, "japanese"),
        new("euc-jp", "EUC-JP", 51932, "japanese"),
        new("euc-kr", "EUC-KR", 51949, "korean"),
        new("cp437", "CP437 (DOS US)", 437, "dos"),
        new("cp850", "CP850 (DOS Latin)", 850, "dos"),
        new("us-ascii", "ASCII", 20127, "western"),
    };

    static readonly Dictionary<string, EncodingItem> ById = Known.ToDictionary(k => k.Id, StringComparer.OrdinalIgnoreCase);

    static readonly Dictionary<string, string> Aliases = new(StringComparer.OrdinalIgnoreCase)
    {
        ["utf8"] = "utf-8", ["utf-8-bom"] = "utf-8", ["unicode"] = "utf-16le", ["utf-16"] = "utf-16le",
        ["1251"] = "windows-1251", ["cp1251"] = "windows-1251", ["win1251"] = "windows-1251",
        ["866"] = "cp866", ["ibm866"] = "cp866", ["dos"] = "cp866", ["koi8r"] = "koi8-r",
        ["1252"] = "windows-1252", ["cp1252"] = "windows-1252", ["latin1"] = "iso-8859-1",
        ["gb2312"] = "gbk", ["cp936"] = "gbk", ["sjis"] = "shift_jis", ["shift-jis"] = "shift_jis",
        ["mac-cyrillic"] = "x-mac-cyrillic", ["ascii"] = "us-ascii",
    };

    public static string Normalize(string? id)
    {
        EnsureRegistered();
        if (string.IsNullOrWhiteSpace(id)) return "utf-8";
        id = id.Trim();
        if (ById.ContainsKey(id)) return ById[id].Id;
        if (Aliases.TryGetValue(id, out var a)) return a;
        if (id.StartsWith("cp", StringComparison.OrdinalIgnoreCase) && int.TryParse(id[2..], out var cp)) return FromCodePage(cp);
        try { return FromCodePage(Encoding.GetEncoding(id).CodePage); } catch { return "utf-8"; }
    }

    public static string FromCodePage(int cp)
    {
        var k = Known.FirstOrDefault(x => x.CodePage == cp);
        return k?.Id ?? "cp" + cp;
    }

    public static string DisplayName(string id)
    {
        id = Normalize(id);
        if (ById.TryGetValue(id, out var k)) return k.Name;
        try { return Get(id).WebName.ToUpperInvariant(); } catch { return id; }
    }

    public static int CodePage(string id)
    {
        id = Normalize(id);
        if (ById.TryGetValue(id, out var k)) return k.CodePage;
        return id.StartsWith("cp") && int.TryParse(id[2..], out var cp) ? cp : 65001;
    }

    public static bool IsUnicode(string id) => Normalize(id).StartsWith("utf-", StringComparison.Ordinal);

    public static Encoding Get(string id, bool throwOnInvalid = false)
    {
        EnsureRegistered();
        id = Normalize(id);
        switch (id)
        {
            case "utf-8": return new UTF8Encoding(false, throwOnInvalid);
            case "utf-16le": return new UnicodeEncoding(false, false, throwOnInvalid);
            case "utf-16be": return new UnicodeEncoding(true, false, throwOnInvalid);
            case "utf-32le": return new UTF32Encoding(false, false, throwOnInvalid);
            case "utf-32be": return new UTF32Encoding(true, false, throwOnInvalid);
        }
        var cp = CodePage(id);
        return throwOnInvalid
            ? Encoding.GetEncoding(cp, EncoderFallback.ExceptionFallback, DecoderFallback.ExceptionFallback)
            : Encoding.GetEncoding(cp);
    }

    public static Encoding GetWithFallback(string id, EncoderFallback enc, DecoderFallback dec)
    {
        EnsureRegistered();
        id = Normalize(id);
        if (IsUnicode(id)) return Get(id);
        return Encoding.GetEncoding(CodePage(id), enc, dec);
    }

    public static byte[] Preamble(string id) => Normalize(id) switch
    {
        "utf-8" => new byte[] { 0xEF, 0xBB, 0xBF },
        "utf-16le" => new byte[] { 0xFF, 0xFE },
        "utf-16be" => new byte[] { 0xFE, 0xFF },
        "utf-32le" => new byte[] { 0xFF, 0xFE, 0, 0 },
        "utf-32be" => new byte[] { 0, 0, 0xFE, 0xFF },
        _ => Array.Empty<byte>(),
    };

    /// <summary>Everything the runtime can do, for the "All encodings" dialog.</summary>
    public static IReadOnlyList<EncodingItem> All()
    {
        EnsureRegistered();
        var list = new List<EncodingItem>(Known);
        var seen = new HashSet<int>(Known.Select(k => k.CodePage));
        var infos = Encoding.GetEncodings().Concat(CodePagesEncodingProvider.Instance.GetEncodings());
        foreach (var info in infos.OrderBy(i => i.CodePage))
        {
            if (!seen.Add(info.CodePage)) continue;
            string name;
            try { name = info.DisplayName; } catch { name = info.Name; }
            list.Add(new EncodingItem("cp" + info.CodePage, $"{info.Name.ToUpperInvariant()} — {name}", info.CodePage, "other"));
        }
        return list;
    }
}
