using System.Text;

namespace Folio.Core.Text;

public sealed record EncodingGuess(string Encoding, bool Bom, double Confidence, bool LooksBinary, string Reason,
    IReadOnlyList<KeyValuePair<string, double>> Candidates);

/// <summary>
/// Figures out how a text file is encoded: BOM → UTF-16/32 byte patterns → strict UTF-8 →
/// scoring of legacy code pages (Cyrillic letter statistics, CJK common characters, Western accents).
/// </summary>
public static class EncodingDetector
{
    const int Sample = 512 * 1024;
    const int ScoreSample = 96 * 1024;
    static readonly KeyValuePair<string, double>[] None = Array.Empty<KeyValuePair<string, double>>();

    public static EncodingGuess Detect(ReadOnlySpan<byte> data, int fallbackCodePage = 1252)
    {
        TextEncodings.EnsureRegistered();
        if (data.Length >= 3 && data[0] == 0xEF && data[1] == 0xBB && data[2] == 0xBF) return new("utf-8", true, 1, false, "bom", None);
        if (data.Length >= 4 && data[0] == 0xFF && data[1] == 0xFE && data[2] == 0 && data[3] == 0) return new("utf-32le", true, 1, false, "bom", None);
        if (data.Length >= 4 && data[0] == 0 && data[1] == 0 && data[2] == 0xFE && data[3] == 0xFF) return new("utf-32be", true, 1, false, "bom", None);
        if (data.Length >= 2 && data[0] == 0xFF && data[1] == 0xFE) return new("utf-16le", true, 1, false, "bom", None);
        if (data.Length >= 2 && data[0] == 0xFE && data[1] == 0xFF) return new("utf-16be", true, 1, false, "bom", None);
        if (data.Length == 0) return new("utf-8", false, 1, false, "empty", None);

        bool truncated = data.Length > Sample;
        var s = truncated ? data[..Sample] : data;

        var wide = GuessWide(s);
        if (wide != null) return new(wide, false, 0.9, false, "utf16-pattern", None);

        int zeros = 0, ctrl = 0;
        foreach (var b in s)
        {
            if (b == 0) zeros++;
            else if (b < 0x20 && b != 9 && b != 10 && b != 13 && b != 12 && b != 27) ctrl++;
        }
        bool binary = zeros > 0 || ctrl > s.Length / 20;

        var (valid, invalid, high) = ScanUtf8(s, truncated);
        if (high == 0) return new("utf-8", false, 1, binary, "ascii", None);
        if (invalid == 0) return new("utf-8", false, 1, binary, "utf8", None);
        if (valid >= 8 && invalid * 50 <= valid) return new("utf-8", false, 0.75, binary, "mostly-utf8", None);

        var score = s.Length > ScoreSample ? s[..ScoreSample] : s;
        var cands = new List<KeyValuePair<string, double>>
        {
            new("windows-1251", Cyrillic(score, 1251, false) * 1.00),
            new("cp866", Cyrillic(score, 866, true) * 0.97),
            new("koi8-r", Cyrillic(score, 20866, false) * 0.97),
            new("iso-8859-5", Cyrillic(score, 28595, false) * 0.90),
            new("x-mac-cyrillic", Cyrillic(score, 10007, false) * 0.85),
            new("gb18030", Cjk(score, 54936, CjkData.SimplifiedSet, null)),
            new("big5", Cjk(score, 950, CjkData.TraditionalSet, null) * 0.97),
            new("shift_jis", Cjk(score, 932, CjkData.KanjiSet, IsKana) * 0.97),
            new("euc-kr", Cjk(score, 51949, CjkData.HangulSet, null) * 0.95),
            new("windows-1252", Western(score, 1252)),
            new("windows-1250", Western(score, 1250) * 0.9),
        };
        cands.Sort((a, b) => b.Value.CompareTo(a.Value));
        var best = cands[0];
        var second = cands[1].Value;
        if (best.Value < 0.2)
        {
            var fb = TextEncodings.FromCodePage(fallbackCodePage);
            return new(fb, false, 0.3, binary, "fallback", cands);
        }
        double conf = Math.Clamp(best.Value, 0.35, 0.99);
        if (best.Value - second < 0.12) conf = Math.Max(0.35, conf * 0.8);
        return new(best.Key, false, Math.Round(conf, 2), binary, "scored", cands);
    }

    static string? GuessWide(ReadOnlySpan<byte> s)
    {
        if (s.Length < 8) return null;
        int n = Math.Min(s.Length & ~3, 8192);
        int evenZero = 0, oddZero = 0;
        for (int i = 0; i + 1 < n; i += 2)
        {
            if (s[i] == 0) evenZero++;
            if (s[i + 1] == 0) oddZero++;
        }
        int pairs = n / 2;
        // UTF-32: three zero bytes out of four
        int z32le = 0, z32be = 0;
        for (int i = 0; i + 3 < n; i += 4)
        {
            if (s[i + 1] == 0 && s[i + 2] == 0 && s[i + 3] == 0 && s[i] != 0) z32le++;
            if (s[i] == 0 && s[i + 1] == 0 && s[i + 2] == 0 && s[i + 3] != 0) z32be++;
        }
        if (z32le > n / 4 * 0.9) return "utf-32le";
        if (z32be > n / 4 * 0.9) return "utf-32be";
        if (oddZero > pairs * 0.35 && evenZero < pairs * 0.02) return "utf-16le";
        if (evenZero > pairs * 0.35 && oddZero < pairs * 0.02) return "utf-16be";
        return null;
    }

    /// <summary>Returns count of valid multibyte sequences, invalid bytes and bytes ≥ 0x80.</summary>
    public static (int valid, int invalid, int high) ScanUtf8(ReadOnlySpan<byte> s, bool truncated)
    {
        int i = 0, valid = 0, invalid = 0, high = 0;
        while (i < s.Length)
        {
            byte b = s[i];
            if (b < 0x80) { i++; continue; }
            high++;
            int need;
            byte lo = 0x80, hi = 0xBF;
            if (b >= 0xC2 && b <= 0xDF) need = 1;
            else if (b >= 0xE0 && b <= 0xEF) { need = 2; if (b == 0xE0) lo = 0xA0; else if (b == 0xED) hi = 0x9F; }
            else if (b >= 0xF0 && b <= 0xF4) { need = 3; if (b == 0xF0) lo = 0x90; else if (b == 0xF4) hi = 0x8F; }
            else { invalid++; i++; continue; }

            if (i + need >= s.Length)
            {
                // sequence cut by the sample boundary: accept if what we have is consistent
                bool ok = true;
                for (int k = i + 1; k < s.Length; k++)
                {
                    byte c = s[k];
                    if (k == i + 1 ? (c < lo || c > hi) : (c < 0x80 || c > 0xBF)) { ok = false; break; }
                }
                if (!(ok && truncated)) invalid++;
                break;
            }
            bool good = s[i + 1] >= lo && s[i + 1] <= hi;
            for (int k = 2; good && k <= need; k++) good = s[i + k] >= 0x80 && s[i + k] <= 0xBF;
            if (good) { valid++; i += need + 1; }
            else { invalid++; i++; }
        }
        return (valid, invalid, high);
    }

    const string Top10 = "оеаинтсрвл";

    static char CyrLower(char c)
    {
        if (c >= 'А' && c <= 'Я') return (char)(c + 32);
        return c switch { 'Ё' => 'ё', 'І' => 'і', 'Ї' => 'ї', 'Є' => 'є', 'Ґ' => 'ґ', 'Ў' => 'ў', _ => c };
    }

    static bool IsCyr(char c) => (c >= 'А' && c <= 'я') || c == 'Ё' || c == 'ё' || c == 'І' || c == 'і' || c == 'Ї' || c == 'ї' || c == 'Є' || c == 'є' || c == 'Ґ' || c == 'ґ' || c == 'Ў' || c == 'ў';

    static bool IsTypo(char c) => "«»—–…№“”„‘’•·€°§±‰™©®‹›‚\u00A0".IndexOf(c) >= 0;

    static double Cyrillic(ReadOnlySpan<byte> s, int cp, bool dosBoxes)
    {
        string text;
        try { text = Encoding.GetEncoding(cp).GetString(s); } catch { return 0; }
        int hi = 0, good = 0, cyr = 0, lower = 0, top = 0;
        foreach (char ch in text)
        {
            if (ch < 0x80) continue;
            hi++;
            if (IsCyr(ch))
            {
                good++; cyr++;
                char l = CyrLower(ch);
                if (l == ch) lower++;
                if (Top10.IndexOf(l) >= 0) top++;
            }
            else if (IsTypo(ch)) good++;
            else if (dosBoxes && ch >= '\u2500' && ch <= '\u259F') good++;
        }
        if (hi == 0 || cyr == 0) return 0;
        double goodRatio = good / (double)hi;
        double t = Math.Clamp((top / (double)cyr - 0.30) / 0.30, 0, 1);
        double l2 = lower / (double)cyr;
        double shape = 0.55 * t + 0.45 * l2;
        if (cyr < 12) shape *= 0.6 + cyr / 30.0; // very short samples are unreliable
        return goodRatio * shape;
    }

    static bool IsKana(char c) => c >= '\u3040' && c <= '\u30FF';

    static double Cjk(ReadOnlySpan<byte> s, int cp, HashSet<char> common, Func<char, bool>? extra)
    {
        string text;
        try { text = Encoding.GetEncoding(cp).GetString(s); } catch { return 0; }
        int total = 0, good = 0, extraHits = 0;
        double bad = 0;
        foreach (char ch in text)
        {
            if (ch < 0x80) continue;
            total++;
            if (ch == '\uFFFD' || (ch >= '\uE000' && ch <= '\uF8FF')) { bad++; continue; }
            if (ch >= '\uFF61' && ch <= '\uFF9F') { bad += 0.5; continue; } // half-width katakana: typical for misread Cyrillic
            if (extra != null && extra(ch)) { good++; extraHits++; continue; }
            if (common.Contains(ch) || (ch >= '\uFF01' && ch <= '\uFF5E')) good++;
        }
        if (total == 0) return 0;
        double validity = Math.Max(0, 1 - bad / total);
        double score = Math.Clamp(good / (double)total / 0.5, 0, 1) * validity * validity;
        // Japanese text practically always contains kana
        if (extra != null && extraHits < total * 0.08) score *= 0.35;
        // a handful of characters proves little
        if (total < 16) score *= 0.5 + total / 32.0;
        return score;
    }

    static double Western(ReadOnlySpan<byte> s, int cp)
    {
        string text;
        try { text = Encoding.GetEncoding(cp).GetString(s); } catch { return 0; }
        int hi = 0, good = 0;
        for (int i = 0; i < text.Length; i++)
        {
            char ch = text[i];
            if (ch < 0x80) continue;
            hi++;
            if (char.IsLetter(ch))
            {
                bool left = i > 0 && IsAsciiLetter(text[i - 1]);
                bool right = i + 1 < text.Length && IsAsciiLetter(text[i + 1]);
                if (left || right) good++;
            }
            else if (IsTypo(ch)) good++;
        }
        if (hi == 0) return 0;
        return good / (double)hi * 0.95;
    }

    static bool IsAsciiLetter(char c) => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
}
