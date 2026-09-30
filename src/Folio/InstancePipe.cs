using System.IO.Pipes;
using System.Text;
using System.Text.Json.Nodes;
using Folio.Core;

namespace Folio;

/// <summary>Single instance: a second Folio.exe hands its command line to the running one through a named pipe.</summary>
internal sealed class InstancePipe : IDisposable
{
    static string Name => "Folio.Instance." + Sanitize(Environment.UserName) + "." + System.Diagnostics.Process.GetCurrentProcess().SessionId;
    public const string MutexName = @"Local\Folio.Instance.v1";

    static string Sanitize(string s) => new(s.Select(c => char.IsLetterOrDigit(c) ? c : '_').ToArray());

    readonly CancellationTokenSource _cts = new();

    public void Start(Action<StartOptions> onMessage, Control ui)
    {
        _ = Task.Run(async () =>
        {
            while (!_cts.IsCancellationRequested)
            {
                try
                {
                    using var server = new NamedPipeServerStream(Name, PipeDirection.In, 4, PipeTransmissionMode.Byte, PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);
                    await server.WaitForConnectionAsync(_cts.Token);
                    using var ms = new MemoryStream();
                    var buf = new byte[8192];
                    using var read = CancellationTokenSource.CreateLinkedTokenSource(_cts.Token);
                    read.CancelAfter(3000);
                    int n;
                    while ((n = await server.ReadAsync(buf, read.Token)) > 0) { ms.Write(buf, 0, n); if (ms.Length > 1 << 20) break; }
                    var json = Encoding.UTF8.GetString(ms.ToArray());
                    if (JsonNode.Parse(json) is JsonObject o)
                    {
                        var opts = StartOptions.FromJson(o);
                        if (!ui.IsDisposed) ui.BeginInvoke(() => onMessage(opts));
                    }
                }
                catch (OperationCanceledException) when (_cts.IsCancellationRequested) { break; }
                catch (Exception ex) { Log.Warn("instance pipe: " + ex.Message); await Task.Delay(300); }
            }
        });
    }

    /// <summary>Sends the command line to the running instance. False when nobody answered.</summary>
    public static bool Send(StartOptions o)
    {
        try
        {
            using var client = new NamedPipeClientStream(".", Name, PipeDirection.Out, PipeOptions.CurrentUserOnly);
            client.Connect(2500);
            try
            {
                if (Native.GetNamedPipeServerProcessId(client.SafePipeHandle.DangerousGetHandle(), out var pid))
                    Native.AllowSetForegroundWindow((int)pid);
            }
            catch { }
            var bytes = Encoding.UTF8.GetBytes(o.ToJson().ToJsonString());
            client.Write(bytes, 0, bytes.Length);
            client.Flush();
            return true;
        }
        catch (Exception ex)
        {
            try { Log.Warn("Could not reach the running Folio: " + ex.Message); } catch { }
            return false;
        }
    }

    public void Dispose() => _cts.Cancel();
}
