# Read-only Windows experiment. Not loaded by the plugin; writes no files or metadata.
param([ValidateRange(1, 60)][int]$Seconds = 30)
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes
Add-Type -TypeDefinition @'
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;

public static class RemarkWheelProbe {
    [StructLayout(LayoutKind.Sequential)] public struct Point { public int X, Y; }
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
    [DllImport("kernel32.dll", CharSet=CharSet.Auto)] static extern IntPtr GetModuleHandle(string module);
    static readonly ConcurrentQueue<Wheel> Events = new ConcurrentQueue<Wheel>();
    static readonly Callback Handler = OnMouse;
    static readonly ManualResetEventSlim Ready = new ManualResetEventSlim();
    static HashSet<uint> Targets;
    static Thread Worker;
    static volatile bool Stopping;
    static int Error;

    static IntPtr OnMouse(int code, IntPtr message, IntPtr data) {
        long kind = message.ToInt64();
        if (code >= 0 && (kind == 0x20a || kind == 0x20e)) {
            Mouse mouse = (Mouse)Marshal.PtrToStructure(data, typeof(Mouse));
            IntPtr window = GetAncestor(WindowFromPoint(mouse.Point), 2);
            uint process; GetWindowThreadProcessId(window, out process);
            if (Targets.Contains(process)) Events.Enqueue(new Wheel {
                X=mouse.Point.X, Y=mouse.Point.Y, Delta=(short)(mouse.Data >> 16),
                ProcessId=process, Time=mouse.Time, Window=window.ToInt64(),
                Horizontal=kind == 0x20e, Foreground=window == GetForegroundWindow(),
                Injected=(mouse.Flags & 1) != 0
            });
        }
        return CallNextHookEx(IntPtr.Zero, code, message, data);
    }
    public static void Start(uint[] targets, int seconds) {
        Targets = new HashSet<uint>(targets);
        Worker = new Thread(() => {
            IntPtr hook = SetWindowsHookEx(14, Handler, GetModuleHandle(null), 0);
            if (hook == IntPtr.Zero) Error = Marshal.GetLastWin32Error();
            Ready.Set();
            if (hook == IntPtr.Zero) return;
            try {
                Stopwatch clock = Stopwatch.StartNew();
                while (!Stopping && clock.Elapsed.TotalSeconds < seconds) {
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
    public static Wheel[] Drain() {
        var result = new List<Wheel>(); Wheel value;
        while (Events.TryDequeue(out value)) result.Add(value);
        return result.ToArray();
    }
    public static void Stop() { Stopping = true; if (Worker != null) Worker.Join(); }
}
'@

function Write-ProbeGeometry($TaskWindow) {
    # Windows Terminal's accessibility provider exposes cell geometry without
    # reading conversation text. Other terminal providers need separate evidence.
    $taskRoot = [System.Windows.Automation.AutomationElement]::FromHandle($TaskWindow.MainWindowHandle)
    $taskCondition = [System.Windows.Automation.PropertyCondition]::new(
        [System.Windows.Automation.AutomationElement]::ClassNameProperty, 'TermControl')
    $taskControls = $taskRoot.FindAll([System.Windows.Automation.TreeScope]::Descendants, $taskCondition)
    foreach ($taskControl in $taskControls) {
        $taskPattern = $taskControl.GetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern)
        $taskRanges = $taskPattern.GetVisibleRanges()
        if (!$taskRanges.Count) { continue }
        $taskRects = $taskRanges[0].GetBoundingRectangles()
        $taskCell = $taskRanges[0].Clone()
        $taskCell.MoveEndpointByRange([System.Windows.Automation.Text.TextPatternRangeEndpoint]::End,
            $taskCell, [System.Windows.Automation.Text.TextPatternRangeEndpoint]::Start)
        $null = $taskCell.MoveEndpointByUnit([System.Windows.Automation.Text.TextPatternRangeEndpoint]::End,
            [System.Windows.Automation.Text.TextUnit]::Character, 1)
        $taskCellRects = $taskCell.GetBoundingRectangles()
        if (!$taskRects.Count -or !$taskCellRects.Count) { continue }
        [ordered]@{event='terminal_geometry';process=$TaskWindow.Id;
            x=$taskRects[0].X;y=$taskRects[0].Y;line_width=$taskRects[0].Width;
            cell_width=$taskCellRects[0].Width;cell_height=$taskCellRects[0].Height;
            visible_lines=$taskRects.Count;pane_mapping='unverified'} | ConvertTo-Json -Compress
    }
}

$taskWindows = @(Get-Process -Name WindowsTerminal -ErrorAction SilentlyContinue |
    Where-Object MainWindowHandle -ne 0)
if (!$taskWindows.Count) { throw 'No visible Windows Terminal window; this probe currently targets Windows Terminal only.' }
foreach ($taskWindow in $taskWindows) { Write-ProbeGeometry $taskWindow }
$taskHerdr = if ($env:HERDR_BIN_PATH) { $env:HERDR_BIN_PATH } else { 'herdr' }
$taskLayout = (& $taskHerdr pane layout --current | ConvertFrom-Json).result.layout
if ($LASTEXITCODE -ne 0 -or !$taskLayout) { throw 'Could not read the existing Herdr pane layout.' }
[ordered]@{event='herdr_layout';area=$taskLayout.area;panes=$taskLayout.panes;
    note='Terminal pixels and Herdr pane cells have no verified shared origin or session binding.'} |
    ConvertTo-Json -Compress -Depth 6
$taskCount = 0
try {
    [RemarkWheelProbe]::Start([uint32[]]@($taskWindows.Id), $Seconds)
    [ordered]@{event='hook_ready';seconds=$Seconds;read_only=$true} | ConvertTo-Json -Compress
    $taskClock = [System.Diagnostics.Stopwatch]::StartNew()
    while ($taskClock.Elapsed.TotalSeconds -lt $Seconds) {
        foreach ($taskWheel in [RemarkWheelProbe]::Drain()) {
            $taskCount++
            [ordered]@{event='wheel';x=$taskWheel.X;y=$taskWheel.Y;delta=$taskWheel.Delta;
                horizontal=$taskWheel.Horizontal;process=$taskWheel.ProcessId;window=$taskWheel.Window;
                foreground=$taskWheel.Foreground;injected=$taskWheel.Injected;time=$taskWheel.Time;
                pane_mapping='unverified'} | ConvertTo-Json -Compress
        }
        Start-Sleep -Milliseconds 50
    }
} finally {
    [RemarkWheelProbe]::Stop()
    [ordered]@{event='hook_stopped';wheel_events=$taskCount} | ConvertTo-Json -Compress
}
