# Private JSON-lines helper. Input is observed, never consumed or rewritten.
param([ValidateRange(0, 60)][int]$Seconds = 0, [switch]$Probe)
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes
Add-Type -TypeDefinition @'
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class RemarkWheel {
    [StructLayout(LayoutKind.Sequential)] public struct Point { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] struct Mouse {
        public Point Point; public uint Data, Flags, Time; public UIntPtr Extra;
    }
    [StructLayout(LayoutKind.Sequential)] struct Message {
        public IntPtr Window; public uint Id; public UIntPtr WParam; public IntPtr LParam;
        public uint Time; public Point Point; public uint Private;
    }
    public sealed class Wheel {
        public int X, Y, Delta; public uint ProcessId, Time;
        public bool Horizontal, Foreground, Injected; public long Window;
    }
    delegate IntPtr Callback(int code, IntPtr message, IntPtr data);
    [DllImport("user32.dll", SetLastError=true)] static extern IntPtr SetWindowsHookEx(int id, Callback callback, IntPtr module, uint thread);
    [DllImport("user32.dll")] static extern bool UnhookWindowsHookEx(IntPtr hook);
    [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr message, IntPtr data);
    [DllImport("user32.dll")] static extern bool PeekMessage(out Message message, IntPtr window, uint min, uint max, uint remove);
    [DllImport("user32.dll")] static extern bool TranslateMessage(ref Message message);
    [DllImport("user32.dll")] static extern IntPtr DispatchMessage(ref Message message);
    [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(Point point);
    [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr window, uint flag);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
    [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr window, out Rect rect);
    [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr window, ref Point point);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr window, StringBuilder name, int size);
    [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
    [DllImport("kernel32.dll", CharSet=CharSet.Auto)] static extern IntPtr GetModuleHandle(string module);
    static Wheel Latest;
    public static readonly ConcurrentQueue<string> Commands = new ConcurrentQueue<string>();
    public static volatile bool InputClosed;
    static readonly Callback Handler = OnMouse;
    static readonly ManualResetEventSlim Ready = new ManualResetEventSlim();
    static volatile HashSet<uint> Targets;
    static Thread Worker;
    static volatile bool Stopping;
    static int Error;
    public static int TotalWheelEvents;

    static IntPtr OnMouse(int code, IntPtr message, IntPtr data) {
        long kind = message.ToInt64();
        if (code >= 0 && (kind == 0x20a || kind == 0x20e)) {
            Interlocked.Increment(ref TotalWheelEvents);
            Mouse mouse = (Mouse)Marshal.PtrToStructure(data, typeof(Mouse));
            IntPtr window = GetAncestor(WindowFromPoint(mouse.Point), 2);
            uint process; GetWindowThreadProcessId(window, out process);
            if (Targets.Contains(process)) Interlocked.Exchange(ref Latest, new Wheel {
                X=mouse.Point.X, Y=mouse.Point.Y, Delta=(short)(mouse.Data >> 16),
                ProcessId=process, Time=mouse.Time, Window=window.ToInt64(),
                Horizontal=kind == 0x20e, Foreground=window == GetForegroundWindow(),
                Injected=(mouse.Flags & 1) != 0
            });
        }
        return CallNextHookEx(IntPtr.Zero, code, message, data);
    }
    public static void SetTargets(uint[] targets) { Targets = new HashSet<uint>(targets); }
    public static void ReadCommands() {
        var reader = new Thread(() => {
            try { string line; while ((line = Console.ReadLine()) != null) Commands.Enqueue(line); }
            finally { InputClosed = true; }
        });
        reader.IsBackground = true; reader.Start();
    }
    public static bool Current(long window, int x, int y, uint time) {
        var point = new Point { X=x, Y=y };
        return unchecked((uint)Environment.TickCount - time) < 1500 &&
            GetForegroundWindow().ToInt64() == window &&
            GetAncestor(WindowFromPoint(point), 2).ToInt64() == window;
    }
    public static Rect Client(long window) {
        Rect rect; var point = new Point();
        if (!GetClientRect(new IntPtr(window), out rect) || !ClientToScreen(new IntPtr(window), ref point))
            throw new Win32Exception();
        return new Rect { Left=point.X, Top=point.Y, Right=point.X+rect.Right, Bottom=point.Y+rect.Bottom };
    }
    public static string Class(long window) {
        var name = new StringBuilder(256); GetClassName(new IntPtr(window), name, name.Capacity);
        return name.ToString();
    }
    public static void Start(uint[] targets, int seconds) {
        SetProcessDPIAware();
        Targets = new HashSet<uint>(targets);
        Worker = new Thread(() => {
            IntPtr hook = SetWindowsHookEx(14, Handler, GetModuleHandle(null), 0);
            if (hook == IntPtr.Zero) Error = Marshal.GetLastWin32Error();
            Ready.Set();
            if (hook == IntPtr.Zero) return;
            try {
                Stopwatch clock = Stopwatch.StartNew();
                while (!Stopping && !InputClosed && (seconds == 0 || clock.Elapsed.TotalSeconds < seconds)) {
                    Message message;
                    while (PeekMessage(out message, IntPtr.Zero, 0, 0, 1)) {
                        TranslateMessage(ref message); DispatchMessage(ref message);
                    }
                    Thread.Sleep(5);
                }
            } finally { UnhookWindowsHookEx(hook); }
        });
        Worker.IsBackground = true;
        Worker.Start(); Ready.Wait();
        if (Error != 0) throw new Win32Exception(Error);
    }
    public static Wheel Take() { return Interlocked.Exchange(ref Latest, null); }
    public static void Stop() { Stopping = true; if (Worker != null) Worker.Join(); }
}
'@

function Test-Pane($Request) {
    $taskRoot = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr][long]$Request.window)
    $taskCondition = [System.Windows.Automation.PropertyCondition]::new(
        [System.Windows.Automation.AutomationElement]::IsTextPatternAvailableProperty, $true)
    $taskControls = $taskRoot.FindAll([System.Windows.Automation.TreeScope]::Subtree, $taskCondition)
    foreach ($taskControl in $taskControls) {
        if (!$taskControl.Current.BoundingRectangle.Contains([double]$Request.x, [double]$Request.y)) { continue }
        $taskPattern = $taskControl.GetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern)
        $taskRanges = $taskPattern.GetVisibleRanges()
        if (!$taskRanges.Count) { continue }
        $taskRange = $taskRanges[0]
        # UIA omits rectangles for whitespace-only ranges. Measure a visible
        # ASCII cell instead; an emoji/CJK first character may span two cells.
        $taskCharacter = [regex]::Match($taskRange.GetText(-1), '[!-~]')
        if (!$taskCharacter.Success) { continue }
        $taskCell = $taskRange.FindText($taskCharacter.Value, $false, $false)
        if (!$taskCell) { continue }
        $taskCells = $taskCell.GetBoundingRectangles()
        if (!$taskCells.Count -or $taskCells[0].Width -le 0 -or $taskCells[0].Height -le 0) { continue }
        $taskWidth = $taskCells[0].Width
        $taskHeight = $taskCells[0].Height
        $taskOrigins = @{}
        foreach ($taskAnchor in $Request.anchors) {
            $taskFound = $taskRange.FindText($taskAnchor.text, $false, $false)
            if (!$taskFound) { continue }
            $taskRects = $taskFound.GetBoundingRectangles()
            if ($taskRects.Count -ne 1) { continue }
            $taskX = $taskRects[0].X
            $taskY = $taskRects[0].Y - $taskAnchor.row * $taskHeight
            $taskKey = "$taskX,$taskY"
            if (!$taskOrigins.ContainsKey($taskKey)) {
                $taskOrigins[$taskKey] = @{ x=$taskX; y=$taskY; count=0 }
            }
            $taskOrigins[$taskKey].count++
        }
        $taskMatches = @($taskOrigins.Values | Where-Object count -ge 2)
        if ($taskMatches.Count -ne 1) { continue }
        $taskOrigin = $taskMatches[0]
        if ($Request.x -ge $taskOrigin.x -and $Request.x -lt ($taskOrigin.x + $Request.width * $taskWidth) -and
            $Request.y -ge $taskOrigin.y -and $Request.y -lt ($taskOrigin.y + $Request.height * $taskHeight)) {
            return $true
        }
    }
    return $false
}

function Get-TerminalIds {
    @(Get-Process -Name WindowsTerminal,wezterm-gui,conhost,OpenConsole -ErrorAction SilentlyContinue |
        ForEach-Object { [uint32]$_.Id })
}

function Test-HostPane($Request) {
    $taskProcess = Get-Process -Id $Request.process -ErrorAction Stop
    if ($taskProcess.ProcessName -ne 'wezterm-gui') { return Test-Pane $Request }
    # Node validates WezTerm's focused pane and text via its read-only CLI.
    # Recheck the client rectangle so moving/resizing during that read cannot
    # turn stale coordinates into an acknowledgement.
    $taskClient = [RemarkWheel]::Client($Request.window)
    if (!$Request.bounds -or !$Request.client) { return $false }
    foreach ($taskEdge in @('Left','Top','Right','Bottom')) {
        if ($taskClient.$taskEdge -ne $Request.client.$taskEdge) { return $false }
    }
    return $Request.x -ge $Request.bounds.left -and $Request.x -lt $Request.bounds.right -and
        $Request.y -ge $Request.bounds.top -and $Request.y -lt $Request.bounds.bottom
}
$taskCount = 0
try {
    [RemarkWheel]::Start([uint32[]]@(Get-TerminalIds), $Seconds)
    if (!$Probe) { [RemarkWheel]::ReadCommands() }
    [ordered]@{event='hook_ready';read_only=$true} | ConvertTo-Json -Compress
    $taskClock = [System.Diagnostics.Stopwatch]::StartNew()
    $taskRefresh = 0
    while (($Seconds -eq 0 -or $taskClock.Elapsed.TotalSeconds -lt $Seconds) -and ![RemarkWheel]::InputClosed) {
        if ($taskClock.ElapsedMilliseconds -ge $taskRefresh) {
            [RemarkWheel]::SetTargets([uint32[]]@(Get-TerminalIds))
            $taskRefresh = $taskClock.ElapsedMilliseconds + 5000
        }
        $taskCommand = $null
        while ([RemarkWheel]::Commands.TryDequeue([ref]$taskCommand)) {
            $taskRequest = $taskCommand | ConvertFrom-Json
            if ($taskRequest.event -ne 'verify') { continue }
            $taskMatched = $false
            try {
                $taskMatched = [RemarkWheel]::Current($taskRequest.window, $taskRequest.x, $taskRequest.y, $taskRequest.time) -and
                    (Test-HostPane $taskRequest) -and
                    [RemarkWheel]::Current($taskRequest.window, $taskRequest.x, $taskRequest.y, $taskRequest.time)
            } catch { $taskMatched = $false }
            [ordered]@{event='verified';id=$taskRequest.id;matched=[bool]$taskMatched} | ConvertTo-Json -Compress
        }
        $taskWheel = [RemarkWheel]::Take()
        if ($taskWheel -and $taskWheel.Foreground) {
            $taskCount++
            $taskHost = $null
            if (!$Probe) {
                try {
                    $taskProcess = Get-Process -Id $taskWheel.ProcessId -ErrorAction Stop
                    if ($taskProcess.ProcessName -eq 'wezterm-gui') {
                        $taskHost = @{ name='wezterm'; executable=(Join-Path (Split-Path $taskProcess.Path) 'wezterm.exe');
                            class=[RemarkWheel]::Class($taskWheel.Window); client=[RemarkWheel]::Client($taskWheel.Window) }
                    }
                } catch { continue }
            }
            [ordered]@{event='wheel';x=$taskWheel.X;y=$taskWheel.Y;delta=$taskWheel.Delta;
                horizontal=$taskWheel.Horizontal;process=$taskWheel.ProcessId;window=$taskWheel.Window;
                foreground=$taskWheel.Foreground;injected=$taskWheel.Injected;time=$taskWheel.Time;host=$taskHost} | ConvertTo-Json -Depth 4 -Compress
        }
        Start-Sleep -Milliseconds 50
    }
} finally {
    [RemarkWheel]::Stop()
    [ordered]@{event='hook_stopped';wheel_events=$taskCount;
        total_wheel_events=[RemarkWheel]::TotalWheelEvents} | ConvertTo-Json -Compress
}
