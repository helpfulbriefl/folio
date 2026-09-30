using System.Net;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Folio.Core;

public sealed record ReleaseInfo(string Version, string Tag, string Name, string Notes, DateTime Published, bool Prerelease,
    string HtmlUrl, string ExeUrl, long ExeSize, string SumsUrl);

/// <summary>Checks GitHub releases of helpfulbriefl/folio and downloads verified builds.</summary>
public static partial class UpdateChecker
{
    public const string Owner = "helpfulbriefl";
    public const string Repo = "folio";
    public const string AssetName = "Folio.exe";
    public const string SumsName = "SHA256SUMS.txt";
    public static string RepoUrl => $"https://github.com/{Owner}/{Repo}";
    public static string CurrentVersion { get; set; } = "1.0.0";
    public static string? ApiBaseOverride { get; set; }

    static HttpClient? _http;
    public static HttpClient Http
    {
        get
        {
            if (_http != null) return _http;
            var h = new HttpClient(new SocketsHttpHandler { AutomaticDecompression = DecompressionMethods.All, PooledConnectionLifetime = TimeSpan.FromMinutes(5) })
            { Timeout = Timeout.InfiniteTimeSpan };
            h.DefaultRequestHeaders.UserAgent.Add(new ProductInfoHeaderValue("Folio", CurrentVersion));
            return _http = h;
        }
    }

    [GeneratedRegex(@"^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$")]
    private static partial Regex SemVer();

    public static bool IsVersionTag(string tag) => SemVer().IsMatch(tag.Trim());

    /// <summary>Semantic version comparison: 1.2.0 &gt; 1.2.0-beta.2 &gt; 1.2.0-beta.1 &gt; 1.1.9.</summary>
    public static int Compare(string a, string b)
    {
        var ma = SemVer().Match(a.Trim());
        var mb = SemVer().Match(b.Trim());
        if (!ma.Success || !mb.Success) return string.CompareOrdinal(a, b);
        for (int i = 1; i <= 3; i++)
        {
            int x = int.Parse(ma.Groups[i].Value), y = int.Parse(mb.Groups[i].Value);
            if (x != y) return x.CompareTo(y);
        }
        var pa = ma.Groups[4].Success ? ma.Groups[4].Value : null;
        var pb = mb.Groups[4].Success ? mb.Groups[4].Value : null;
        if (pa == null && pb == null) return 0;
        if (pa == null) return 1;
        if (pb == null) return -1;
        var sa = pa.Split('.');
        var sb = pb.Split('.');
        for (int i = 0; i < Math.Max(sa.Length, sb.Length); i++)
        {
            if (i >= sa.Length) return -1;
            if (i >= sb.Length) return 1;
            bool na = int.TryParse(sa[i], out var ia), nb = int.TryParse(sb[i], out var ib);
            int c = na && nb ? ia.CompareTo(ib) : na ? -1 : nb ? 1 : string.CompareOrdinal(sa[i], sb[i]);
            if (c != 0) return c;
        }
        return 0;
    }

    public static string Clean(string tag) => tag.Trim().TrimStart('v', 'V');

    /// <summary>Newest release suitable for this user (stable only unless beta is on).</summary>
    public static async Task<ReleaseInfo?> LatestAsync(bool beta, CancellationToken ct)
    {
        var api = ApiBaseOverride ?? "https://api.github.com";
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        cts.CancelAfter(TimeSpan.FromSeconds(25));
        try
        {
            using var req = new HttpRequestMessage(HttpMethod.Get, $"{api}/repos/{Owner}/{Repo}/releases?per_page=30");
            req.Headers.Accept.ParseAdd("application/vnd.github+json");
            using var resp = await Http.SendAsync(req, cts.Token);
            if (resp.StatusCode is HttpStatusCode.Forbidden or HttpStatusCode.TooManyRequests)
                return await LatestViaRedirectAsync(cts.Token);
            resp.EnsureSuccessStatusCode();
            using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync(cts.Token));
            ReleaseInfo? best = null;
            foreach (var r in doc.RootElement.EnumerateArray())
            {
                if (r.TryGetProperty("draft", out var d) && d.GetBoolean()) continue;
                var tag = r.GetProperty("tag_name").GetString() ?? "";
                if (!IsVersionTag(tag)) continue;
                bool pre = r.TryGetProperty("prerelease", out var p) && p.GetBoolean();
                if (pre && !beta) continue;
                string exe = $"{RepoUrl}/releases/download/{tag}/{AssetName}", sums = $"{RepoUrl}/releases/download/{tag}/{SumsName}";
                long size = 0;
                bool hasExe = false;
                if (r.TryGetProperty("assets", out var assets))
                    foreach (var a in assets.EnumerateArray())
                    {
                        var name = a.GetProperty("name").GetString();
                        if (name == AssetName) { exe = a.GetProperty("browser_download_url").GetString() ?? exe; size = a.GetProperty("size").GetInt64(); hasExe = true; }
                        else if (name == SumsName) sums = a.GetProperty("browser_download_url").GetString() ?? sums;
                    }
                if (!hasExe) continue;
                var info = new ReleaseInfo(Clean(tag), tag, r.GetProperty("name").GetString() ?? tag,
                    r.TryGetProperty("body", out var b) ? b.GetString() ?? "" : "",
                    r.TryGetProperty("published_at", out var pa) && pa.ValueKind == JsonValueKind.String ? pa.GetDateTime() : DateTime.MinValue,
                    pre, r.GetProperty("html_url").GetString() ?? RepoUrl, exe, size, sums);
                if (best == null || Compare(info.Version, best.Version) > 0) best = info;
            }
            return best;
        }
        catch (HttpRequestException) when (!ct.IsCancellationRequested)
        {
            return await LatestViaRedirectAsync(ct);
        }
    }

    static async Task<ReleaseInfo?> LatestViaRedirectAsync(CancellationToken ct)
    {
        using var handler = new SocketsHttpHandler { AllowAutoRedirect = false };
        using var h = new HttpClient(handler) { Timeout = TimeSpan.FromSeconds(20) };
        h.DefaultRequestHeaders.UserAgent.Add(new ProductInfoHeaderValue("Folio", CurrentVersion));
        using var resp = await h.GetAsync($"{RepoUrl}/releases/latest", ct);
        var loc = resp.Headers.Location?.ToString() ?? "";
        var i = loc.LastIndexOf("/tag/", StringComparison.Ordinal);
        if (i < 0) return null;
        var tag = Uri.UnescapeDataString(loc[(i + 5)..]);
        if (!IsVersionTag(tag)) return null;
        return new ReleaseInfo(Clean(tag), tag, "Folio " + Clean(tag), "", DateTime.MinValue, false, $"{RepoUrl}/releases/tag/{tag}",
            $"{RepoUrl}/releases/download/{tag}/{AssetName}", 0, $"{RepoUrl}/releases/download/{tag}/{SumsName}");
    }

    public static bool IsNewer(ReleaseInfo? r) => r != null && Compare(r.Version, CurrentVersion) > 0;

    /// <summary>Downloads the exe into %LocalAppData%\Folio\updates and verifies its SHA-256 against SHA256SUMS.txt.</summary>
    public static async Task<string> DownloadAsync(ReleaseInfo r, Action<long, long>? progress, CancellationToken ct)
    {
        Directory.CreateDirectory(AppPaths.Updates);
        var target = Path.Combine(AppPaths.Updates, $"Folio-{r.Version}.exe");
        var part = target + ".part";
        string expected;
        using (var cts = CancellationTokenSource.CreateLinkedTokenSource(ct))
        {
            cts.CancelAfter(TimeSpan.FromSeconds(30));
            var sums = await Http.GetStringAsync(r.SumsUrl, cts.Token);
            expected = ParseSums(sums, AssetName) ?? throw new InvalidDataException("SHA256SUMS.txt has no entry for " + AssetName);
        }
        using (var resp = await Http.GetAsync(r.ExeUrl, HttpCompletionOption.ResponseHeadersRead, ct))
        {
            resp.EnsureSuccessStatusCode();
            long total = resp.Content.Headers.ContentLength ?? r.ExeSize;
            await using var src = await resp.Content.ReadAsStreamAsync(ct);
            await using var dst = new FileStream(part, FileMode.Create, FileAccess.Write, FileShare.None);
            using var sha = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
            var buf = new byte[81920];
            long done = 0;
            var last = DateTime.MinValue;
            while (true)
            {
                using var idle = CancellationTokenSource.CreateLinkedTokenSource(ct);
                idle.CancelAfter(TimeSpan.FromSeconds(60));
                int n = await src.ReadAsync(buf, idle.Token);
                if (n <= 0) break;
                await dst.WriteAsync(buf.AsMemory(0, n), ct);
                sha.AppendData(buf, 0, n);
                done += n;
                if ((DateTime.UtcNow - last).TotalMilliseconds > 120) { last = DateTime.UtcNow; progress?.Invoke(done, total); }
            }
            progress?.Invoke(done, total);
            var actual = Convert.ToHexString(sha.GetHashAndReset());
            if (!actual.Equals(expected, StringComparison.OrdinalIgnoreCase))
            {
                dst.Close();
                try { File.Delete(part); } catch { }
                throw new InvalidDataException("Checksum mismatch");
            }
        }
        if (File.Exists(target)) File.Delete(target);
        File.Move(part, target);
        return target;
    }

    public static string? ParseSums(string sums, string name)
    {
        foreach (var raw in sums.Split('\n'))
        {
            var line = raw.Trim();
            if (line.Length < 66) continue;
            var parts = line.Split(new[] { ' ', '\t' }, 2, StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length < 2) continue;
            var file = parts[1].Trim().TrimStart('*');
            if (file.Equals(name, StringComparison.OrdinalIgnoreCase) && parts[0].Length == 64) return parts[0];
        }
        return null;
    }
}
