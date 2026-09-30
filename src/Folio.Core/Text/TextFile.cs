using System.Text;

namespace Folio.Core.Text;

public sealed class LoadedText
{
    public string Path { get; init; } = "";
    public string Text { get; init; } = "";
    public string Encoding { get; init; } = "utf-8";
    public bool Bom { get; init; }
    public string Eol { get; init; } = "crlf";
    public bool MixedEol { get; init; }
    public double Confidence { get; init; } = 1;
    public string Reason { get; init; } = "";
    public bool Binary { get; init; }
    public int Invalid { get; init; }
    public long Size { get; init; }
    public DateTime MtimeUtc { get; init; }
    public bool ReadOnly { get; init; }
    public IReadOnlyList<KeyValuePair<string, double>> Candidates { get; init; } = Array.Empty<KeyValuePair<string, double>>();
}

public sealed record SaveResult(bool Ok, string? Error, string? Message, long Size, DateTime MtimeUtc, int Replaced, string? VersionId);

public sealed record EncodableReport(int Count, IReadOnlyList<int[]> Positions, string Chars);

public sealed record EncodingPreview(string Id, string Name, string Preview, int Bad, double Score);

public sealed class FolioFileException : Exception
{
    public string Code { get; }
    public FolioFileException(string code, string message, Exception? inner = null) : base(message, inner) => Code = code;
}

/// <summary>Reading and writing text files: detection, EOL handling, atomic save, encoding safety checks.</summary>
public static class TextFile
{
    public const long MaxSize = 64L * 1024 * 1024;

    public static LoadedText Load(string path, string? forceEncoding = null, int fallbackCodePage = 1252)
    {
        var fi = new FileInfo(path);
        if (!fi.Exists) throw new FolioFileException("notFound", "File not found: " + path);
        if (fi.Length > MaxSize) throw new FolioFileException("tooLarge", $"File is too large ({fi.Length / 1048576} MB)");
        byte[] data;
        try
        {
            using var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            data = new byte[fs.Length];
            int read = 0;
            while (read < data.Length)
            {
                int n = fs.Read(data, read, data.Length - read);
                if (n <= 0) break;
                read += n;
            }
            if (read < data.Length) Array.Resize(ref data, read);
        }
        catch (UnauthorizedAccessException ex) { throw new FolioFileException("access", ex.Message, ex); }
        catch (IOException ex) { throw new FolioFileException("io", ex.Message, ex); }

        var r = Decode(data, forceEncoding, fallbackCodePage);
        return new LoadedText
        {
            Path = fi.FullName, Text = r.Text, Encoding = r.Encoding, Bom = r.Bom, Eol = r.Eol, MixedEol = r.MixedEol,
            Confidence = r.Confidence, Reason = r.Reason, Binary = r.Binary, Invalid = r.Invalid, Candidates = r.Candidates,
            Size = data.Length, MtimeUtc = fi.LastWriteTimeUtc, ReadOnly = fi.IsReadOnly,
        };
    }

    public static LoadedText Decode(byte[] data, string? forceEncoding = null, int fallbackCodePage = 1252)
    {
        TextEncodings.EnsureRegistered();
        string enc;
        bool bom;
        double conf;
        string reason;
        bool binary;
        IReadOnlyList<KeyValuePair<string, double>> cands = Array.Empty<KeyValuePair<string, double>>();
        var guess = EncodingDetector.Detect(data, fallbackCodePage);
        if (!string.IsNullOrEmpty(forceEncoding))
        {
            enc = TextEncodings.Normalize(forceEncoding);
            var pre = TextEncodings.Preamble(enc);
            bom = pre.Length > 0 && data.AsSpan().StartsWith(pre);
            conf = 1; reason = "manual"; binary = guess.LooksBinary && !TextEncodings.IsUnicode(enc);
        }
        else
        {
            enc = guess.Encoding; bom = guess.Bom; conf = guess.Confidence; reason = guess.Reason; binary = guess.LooksBinary; cands = guess.Candidates;
        }
        int skip = bom ? TextEncodings.Preamble(enc).Length : 0;
        string text;
        try { text = TextEncodings.Get(enc).GetString(data, skip, data.Length - skip); }
        catch { enc = "utf-8"; text = new UTF8Encoding(false).GetString(data, skip, data.Length - skip); }
        int invalid = 0;
        foreach (var ch in text) if (ch == '\uFFFD') invalid++;
        var (norm, eol, mixed) = NormalizeEol(text);
        // A text full of NUL characters is not something we want to show as is.
        if (binary && norm.IndexOf('\0') >= 0) norm = norm.Replace('\0', '\u2400');
        return new LoadedText
        {
            Text = norm, Encoding = enc, Bom = bom, Eol = eol, MixedEol = mixed, Confidence = conf, Reason = reason,
            Binary = binary, Invalid = invalid, Candidates = cands, Size = data.Length,
        };
    }

    public static (string text, string eol, bool mixed) NormalizeEol(string s)
    {
        int crlf = 0, lf = 0, cr = 0;
        for (int i = 0; i < s.Length; i++)
        {
            char c = s[i];
            if (c == '\r')
            {
                if (i + 1 < s.Length && s[i + 1] == '\n') { crlf++; i++; }
                else cr++;
            }
            else if (c == '\n') lf++;
        }
        string eol = "crlf";
        if (lf > crlf && lf >= cr) eol = "lf";
        else if (cr > crlf && cr > lf) eol = "cr";
        int kinds = (crlf > 0 ? 1 : 0) + (lf > 0 ? 1 : 0) + (cr > 0 ? 1 : 0);
        if (crlf == 0 && cr == 0) return (s, lf > 0 ? "lf" : "crlf", false);
        var sb = new StringBuilder(s.Length);
        for (int i = 0; i < s.Length; i++)
        {
            char c = s[i];
            if (c == '\r')
            {
                sb.Append('\n');
                if (i + 1 < s.Length && s[i + 1] == '\n') i++;
            }
            else sb.Append(c);
        }
        return (sb.ToString(), eol, kinds > 1);
    }

    public static string EolString(string eol) => eol switch { "lf" => "\n", "cr" => "\r", _ => "\r\n" };

    public static byte[] Encode(string text, string encoding, bool bom, string eol, out int replaced)
    {
        TextEncodings.EnsureRegistered();
        encoding = TextEncodings.Normalize(encoding);
        var t = text.Replace("\r\n", "\n").Replace('\r', '\n');
        var e = EolString(eol);
        if (e != "\n") t = t.Replace("\n", e);
        replaced = 0;
        if (!TextEncodings.IsUnicode(encoding))
        {
            var sb = new StringBuilder(t.Length);
            replaced = Scan(t, encoding, 0, sb).Count;
            if (replaced > 0) t = sb.ToString();
        }
        var enc = TextEncodings.GetWithFallback(encoding, new EncoderReplacementFallback("?"), new DecoderReplacementFallback("\uFFFD"));
        var body = enc.GetBytes(t);
        if (!bom || !TextEncodings.IsUnicode(encoding)) return body;
        var pre = TextEncodings.Preamble(encoding);
        var all = new byte[pre.Length + body.Length];
        pre.CopyTo(all, 0);
        body.CopyTo(all, pre.Length);
        return all;
    }

    /// <summary>Atomically writes the text. Keeps a copy of the previous content in the version history.</summary>
    public static SaveResult Save(string path, string text, string encoding, bool bom, string eol, bool keepVersion = true)
    {
        byte[] bytes;
        int replaced;
        try { bytes = Encode(text, encoding, bom, eol, out replaced); }
        catch (Exception ex) { return new SaveResult(false, "encoding", ex.Message, 0, default, 0, null); }
        return WriteBytes(path, bytes, keepVersion, replaced);
    }

    public static SaveResult WriteBytes(string path, byte[] bytes, bool keepVersion, int replaced = 0)
    {
        string? versionId = null;
        try
        {
            path = System.IO.Path.GetFullPath(path);
            var dir = System.IO.Path.GetDirectoryName(path)!;
            Directory.CreateDirectory(dir);
            var fi = new FileInfo(path);
            if (fi.Exists)
            {
                if (fi.IsReadOnly) return new SaveResult(false, "readonly", "The file is read-only", 0, default, 0, null);
                if (keepVersion)
                {
                    try { versionId = FileVersions.Snapshot(path, bytes); }
                    catch (Exception ex) { Log.Warn("Version snapshot failed: " + ex.Message); }
                }
            }
            var tmp = System.IO.Path.Combine(dir, "." + System.IO.Path.GetFileName(path) + "." + Guid.NewGuid().ToString("N")[..8] + ".folio-tmp");
            bool atomic = true;
            try
            {
                using (var fs = new FileStream(tmp, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                {
                    fs.Write(bytes, 0, bytes.Length);
                    fs.Flush(true);
                }
                try { File.SetAttributes(tmp, FileAttributes.Hidden); } catch { }
            }
            catch (UnauthorizedAccessException) { atomic = false; }
            catch (IOException) { atomic = false; }

            if (atomic)
            {
                try
                {
                    if (fi.Exists)
                    {
                        File.Replace(tmp, path, null, true);
                        try
                        {
                            var attrs = File.GetAttributes(path);
                            if ((attrs & FileAttributes.Hidden) != 0 && (fi.Attributes & FileAttributes.Hidden) == 0)
                                File.SetAttributes(path, attrs & ~FileAttributes.Hidden);
                        }
                        catch { }
                    }
                    else
                    {
                        File.Move(tmp, path);
                        File.SetAttributes(path, File.GetAttributes(path) & ~FileAttributes.Hidden);
                    }
                }
                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or PlatformNotSupportedException)
                {
                    Log.Warn("Atomic replace failed, writing in place: " + ex.Message);
                    try { File.Delete(tmp); } catch { }
                    atomic = false;
                }
            }
            if (!atomic)
            {
                using var fs = new FileStream(path, FileMode.Create, FileAccess.Write, FileShare.Read);
                fs.Write(bytes, 0, bytes.Length);
                fs.Flush(true);
            }
            var after = new FileInfo(path);
            return new SaveResult(true, null, null, after.Length, after.LastWriteTimeUtc, replaced, versionId);
        }
        catch (UnauthorizedAccessException ex) { return new SaveResult(false, "access", ex.Message, 0, default, 0, null); }
        catch (IOException ex) { return new SaveResult(false, "io", ex.Message, 0, default, 0, null); }
        catch (Exception ex) { return new SaveResult(false, "unknown", ex.Message, 0, default, 0, null); }
    }

    /// <summary>Finds characters that the target encoding cannot represent. Positions are [line, column] (1-based), up to maxPositions.</summary>
    public static EncodableReport CheckEncodable(string text, string encoding, int maxPositions = 50) => Scan(text, encoding, maxPositions, null);

    /// <summary>Scans the text; when <paramref name="sanitized"/> is given it receives the text with every unencodable character replaced by '?'.</summary>
    static EncodableReport Scan(string text, string encoding, int maxPositions, StringBuilder? sanitized)
    {
        TextEncodings.EnsureRegistered();
        encoding = TextEncodings.Normalize(encoding);
        if (TextEncodings.IsUnicode(encoding)) return new EncodableReport(0, Array.Empty<int[]>(), "");
        var enc = TextEncodings.Get(encoding, true);
        var cache = new Dictionary<int, bool>();
        var positions = new List<int[]>();
        var chars = new StringBuilder();
        var seenChars = new HashSet<int>();
        int count = 0, line = 1, col = 1;
        var buf = new byte[16];
        for (int i = 0; i < text.Length; i++)
        {
            char c = text[i];
            if (c == '\n') { line++; col = 1; sanitized?.Append(c); continue; }
            if (c < 0x80) { col++; sanitized?.Append(c); continue; }
            int cp = c;
            int len = 1;
            if (char.IsHighSurrogate(c) && i + 1 < text.Length && char.IsLowSurrogate(text[i + 1])) { cp = char.ConvertToUtf32(c, text[i + 1]); len = 2; }
            if (!cache.TryGetValue(cp, out var ok))
            {
                try
                {
                    var n = enc.GetBytes(text.ToCharArray(i, len), 0, len, buf, 0);
                    // Some code pages silently map to '?' via best-fit; round-trip to be sure.
                    var back = enc.GetString(buf, 0, n);
                    ok = back == text.Substring(i, len);
                }
                catch { ok = false; }
                cache[cp] = ok;
            }
            if (ok) sanitized?.Append(text, i, len);
            else sanitized?.Append('?');
            if (!ok)
            {
                count++;
                if (positions.Count < maxPositions) positions.Add(new[] { line, col });
                if (seenChars.Add(cp) && seenChars.Count <= 24) chars.Append(char.ConvertFromUtf32(cp));
            }
            col++;
            i += len - 1;
        }
        return new EncodableReport(count, positions, chars.ToString());
    }

    /// <summary>First meaningful line of the file decoded with each of the given encodings.</summary>
    public static IReadOnlyList<EncodingPreview> Previews(byte[] data, IEnumerable<string> ids, IReadOnlyList<KeyValuePair<string, double>>? scores = null)
    {
        TextEncodings.EnsureRegistered();
        var sample = data.Length > 16384 ? data.AsSpan(0, 16384).ToArray() : data;
        var list = new List<EncodingPreview>();
        foreach (var raw in ids)
        {
            var id = TextEncodings.Normalize(raw);
            string text;
            try
            {
                var pre = TextEncodings.Preamble(id);
                int skip = pre.Length > 0 && sample.AsSpan().StartsWith(pre) ? pre.Length : 0;
                text = TextEncodings.Get(id).GetString(sample, skip, sample.Length - skip);
            }
            catch { continue; }
            int bad = text.Count(ch => ch == '\uFFFD' || (ch < 0x20 && ch != '\n' && ch != '\r' && ch != '\t'));
            string line = "";
            string? firstNonAscii = null;
            foreach (var l in text.Split('\n'))
            {
                var t = l.Trim();
                if (t.Length == 0) continue;
                if (line.Length == 0) line = t;
                if (firstNonAscii == null && t.Any(ch => ch >= 0x80)) { firstNonAscii = t; break; }
            }
            var chosen = firstNonAscii ?? line;
            if (chosen.Length > 90) chosen = chosen[..90] + "…";
            double score = scores?.FirstOrDefault(s => s.Key == id).Value ?? 0;
            list.Add(new EncodingPreview(id, TextEncodings.DisplayName(id), chosen, bad, Math.Round(score, 3)));
        }
        return list;
    }
}
