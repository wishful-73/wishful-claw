import { app, globalShortcut, type BrowserWindow } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import * as fs from 'fs'
import { join } from 'path'
import { logWarn } from './lib/logger'

interface ShortcutContext {
  foregroundWindow: string | null
  focusWindow: string | null
}

interface ShortcutRegistration {
  accelerator: string
  callback: (context: ShortcutContext) => void
}

interface BridgeMessage {
  type?: string
  id?: string
  foregroundWindow?: string
  focusWindow?: string
}

const registrations = new Map<string, ShortcutRegistration>()
const fallbackAccelerators = new Map<string, string>()
let bridge: ChildProcessWithoutNullStreams | null = null
let stdoutBuffer = ''
let appQuitting = false
let bridgeScriptPath: string | null = null

app.on('will-quit', () => {
  appQuitting = true
  cleanupBridgeScript()
})

const WINDOWS_BRIDGE_SCRIPT = String.raw`
$source = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class PriorityHotkeyBridge
{
    private const int WH_KEYBOARD_LL = 13;
    private const int WM_KEYDOWN = 0x0100;
    private const int WM_KEYUP = 0x0101;
    private const int WM_SYSKEYDOWN = 0x0104;
    private const int WM_SYSKEYUP = 0x0105;
    private const int WM_QUIT = 0x0012;
    private const uint KEYEVENTF_KEYUP = 0x0002;
    private const uint INPUT_KEYBOARD = 1;
    private const uint LLKHF_INJECTED = 0x00000010;
    private const uint LLKHF_ALTDOWN = 0x00000020;
    private const int SW_RESTORE = 9;
    private const int VK_MENU = 0x12;
    private const int VK_SHIFT = 0x10;
    private const int VK_CONTROL = 0x11;
    private const int SPI_GETFOREGROUNDLOCKTIMEOUT = 0x2000;
    private const int SPI_SETFOREGROUNDLOCKTIMEOUT = 0x2001;

    [StructLayout(LayoutKind.Sequential)]
    private struct GUITHREADINFO
    {
        public uint cbSize;
        public uint flags;
        public IntPtr hwndActive;
        public IntPtr hwndFocus;
        public IntPtr hwndCapture;
        public IntPtr hwndMenuOwner;
        public IntPtr hwndMoveSize;
        public IntPtr hwndCaret;
        public RECT rcCaret;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct RECT { public int left; public int top; public int right; public int bottom; }

    private sealed class HotkeySpec
    {
        public string Id;
        public int KeyCode;
        public bool Ctrl;
        public bool Alt;
        public bool Shift;
        public bool Win;
    }

    private static readonly object Sync = new object();
    private static readonly ManualResetEvent Ready = new ManualResetEvent(false);
    private static readonly HashSet<int> SuppressedKeys = new HashSet<int>();
    private static readonly HashSet<int> ReleasedMods = new HashSet<int>();
    private static readonly LowLevelKeyboardProc HookProc = HookCallback;
    private static HotkeySpec[] _hotkeys = new HotkeySpec[0];
    private static IntPtr _hook = IntPtr.Zero;
    private static uint _hookThreadId;

    public static void Start()
    {
        Thread thread = new Thread(HookThreadMain);
        thread.IsBackground = true;
        thread.Name = "WishfulClaw.PriorityHotkeys";
        thread.Start();
        Ready.WaitOne(5000);
        Console.WriteLine("{\"type\":\"ready\"}");
    }

    public static void Configure(string[] entries)
    {
        List<HotkeySpec> parsed = new List<HotkeySpec>();
        foreach (string entry in entries)
        {
            int separator = entry.IndexOf('|');
            if (separator <= 0 || separator >= entry.Length - 1) continue;
            HotkeySpec spec = Parse(entry.Substring(0, separator), entry.Substring(separator + 1));
            if (spec != null) parsed.Add(spec);
        }
        lock (Sync)
        {
            _hotkeys = parsed.ToArray();
            SuppressedKeys.Clear();
        }
    }

    public static bool Paste(long windowValue, long focusValue, bool clearMenu)
    {
        IntPtr target = new IntPtr(windowValue);
        if (target == IntPtr.Zero || !IsWindow(target))
        {
            Console.Error.WriteLine("paste: invalid target window " + windowValue);
            return false;
        }

        // Release any leftover modifier keys from the hotkey press so the
        // injected paste is a clean Ctrl+V (Ditto does AllKeysUp first).
        AllKeysUp();

        if (!EnsureForeground(target))
        {
            Console.Error.WriteLine("paste: failed to activate target " + windowValue + ", foreground=" + GetForegroundWindow().ToInt64());
            return false;
        }

        // Restore keyboard focus to the control that was focused before the
        // panel opened. For browsers hwndFocus is the render widget so this is
        // a no-op there, but for multi-control apps it prevents focus landing
        // on the wrong control.
        RestoreFocus(target, new IntPtr(focusValue));

        // An Alt-based hotkey leaks the Alt press to the target app; Chrome
        // answers a bare Alt with menu-button focus. A single Escape clears
        // that state and puts focus back on the page.
        if (clearMenu)
        {
            KeySend(0x1B, 0);
            KeySend(0x1B, KEYEVENTF_KEYUP);
        }

        // Let the target app settle (internal focus restore) before typing.
        Thread.Sleep(120);

        // Never inject keystrokes unless the target is really foreground,
        // otherwise Ctrl+V would land in whatever window happens to be active.
        if (GetForegroundWindow() != target) return false;

        INPUT[] inputs = new INPUT[]
        {
            KeyboardInput(0x11, 0),
            KeyboardInput(0x56, 0),
            KeyboardInput(0x56, KEYEVENTF_KEYUP),
            KeyboardInput(0x11, KEYEVENTF_KEYUP)
        };
        return SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT))) == inputs.Length;
    }

    // Reactivate the window that was focused before the panel opened, without
    // injecting any keystrokes. Used when the panel hides so the target app
    // can run its own internal focus restore (Chrome re-focuses the page).
    public static bool ActivateOnly(long windowValue, long focusValue, bool clearMenu)
    {
        IntPtr target = new IntPtr(windowValue);
        if (target == IntPtr.Zero || !IsWindow(target))
        {
            Console.Error.WriteLine("activate: invalid target window " + windowValue);
            return false;
        }
        AllKeysUp();
        bool activated = EnsureForeground(target);
        if (activated)
        {
            RestoreFocus(target, new IntPtr(focusValue));
            if (clearMenu)
            {
                KeySend(0x1B, 0);
                KeySend(0x1B, KEYEVENTF_KEYUP);
            }
        }
        return activated;
    }

    // Force-activate one of our own windows (quick launcher). Windows denies
    // SetForegroundWindow from a background process while another app owns
    // the foreground — the same SPI timeout reset + Alt workaround used by
    // EnsureForeground is required to win the race.
    public static bool ActivateSelf(long windowValue)
    {
        IntPtr target = new IntPtr(windowValue);
        if (target == IntPtr.Zero || !IsWindow(target))
        {
            Console.Error.WriteLine("activate-self: invalid target window " + windowValue);
            return false;
        }
        return EnsureForeground(target);
    }

    private static bool EnsureForeground(IntPtr target)
    {
        // Hiding the panel returns focus to the target app naturally. If that
        // already happened, skip activation entirely — re-activating a window
        // that just regained foreground disturbs the app's internal focus
        // restore (Chrome lands on its toolbar buttons instead of the page).
        bool activated = GetForegroundWindow() == target;

        // Otherwise give the OS a short grace period to hand focus back on its
        // own before forcing activation.
        for (int i = 0; i < 10 && !activated; i++)
        {
            Thread.Sleep(30);
            activated = GetForegroundWindow() == target;
        }

        if (!activated)
        {
            // Disable foreground lock timeout while activating (restore afterwards).
            uint oldTimeout = 0;
            SystemParametersInfo(SPI_GETFOREGROUNDLOCKTIMEOUT, 0, ref oldTimeout, 0);
            SystemParametersInfo(SPI_SETFOREGROUNDLOCKTIMEOUT, 0, IntPtr.Zero, 0);

            activated = Activate(target);
            if (!activated)
            {
                // Last-resort foreground-lock workaround. NOTE: a bare Alt
                // press moves Chrome focus to its menu button, so this path
                // is logged to stderr for diagnosis.
                Console.Error.WriteLine("paste: first activate failed for " + target.ToInt64() + ", using Alt workaround");
                KeySend(VK_MENU, 0);
                KeySend(VK_MENU, KEYEVENTF_KEYUP);
                activated = Activate(target);
            }

            SystemParametersInfo(SPI_SETFOREGROUNDLOCKTIMEOUT, 0, new IntPtr(oldTimeout), 0);
        }

        return activated;
    }

    private static void AllKeysUp()
    {
        int[] modifiers = new int[] { VK_CONTROL, VK_SHIFT, VK_MENU };
        foreach (int vk in modifiers)
        {
            if ((GetAsyncKeyState(vk) & 0x8000) != 0)
            {
                KeySend(vk, KEYEVENTF_KEYUP);
            }
        }
    }

    private static void RestoreFocus(IntPtr active, IntPtr focus)
    {
        uint activeThread = GetWindowThreadProcessId(active, IntPtr.Zero);
        uint currentThread = GetCurrentThreadId();
        if (activeThread == 0 || activeThread == currentThread) return;

        // Browsers expose a single render-widget child for the whole page; the
        // captured hwndFocus is often the top-level frame instead (e.g. after an
        // Alt-based hotkey left the frame focused). Find the render widget so
        // Chrome re-focuses the page (and its DOM input).
        IntPtr target = focus;
        if (target == IntPtr.Zero || !IsWindow(target) || target == active)
        {
            target = FindRenderWidget(active);
        }
        if (target == IntPtr.Zero || !IsWindow(target) || target == active) return;

        if (AttachThreadInput(currentThread, activeThread, true))
        {
            if (GetFocus() != target)
            {
                SetFocus(target);
            }
            AttachThreadInput(currentThread, activeThread, false);
        }
    }

    private static IntPtr FindRenderWidget(IntPtr root)
    {
        IntPtr found = IntPtr.Zero;
        EnumChildWindows(root, (hwnd, lParam) =>
        {
            StringBuilder className = new StringBuilder(256);
            GetClassName(hwnd, className, 256);
            if (className.ToString() == "Chrome_RenderWidgetHostHWND")
            {
                found = hwnd;
                return false;
            }
            return true;
        }, IntPtr.Zero);
        return found;
    }

    private static bool Activate(IntPtr target)
    {
        if (IsIconic(target)) ShowWindow(target, SW_RESTORE);
        IntPtr foreground = GetForegroundWindow();
        uint currentThread = GetCurrentThreadId();
        uint targetThread = GetWindowThreadProcessId(target, IntPtr.Zero);
        uint foregroundThread = foreground == IntPtr.Zero ? 0 : GetWindowThreadProcessId(foreground, IntPtr.Zero);
        bool targetAttached = targetThread != 0 && targetThread != currentThread && AttachThreadInput(currentThread, targetThread, true);
        bool foregroundAttached = foregroundThread != 0 && foregroundThread != currentThread && foregroundThread != targetThread && AttachThreadInput(currentThread, foregroundThread, true);
        try
        {
            BringWindowToTop(target);
            SetForegroundWindow(target);
        }
        finally
        {
            if (foregroundAttached) AttachThreadInput(currentThread, foregroundThread, false);
            if (targetAttached) AttachThreadInput(currentThread, targetThread, false);
        }

        // Wait until activation actually takes effect (up to ~500ms)
        for (int i = 0; i < 25; i++)
        {
            if (GetForegroundWindow() == target) return true;
            Thread.Sleep(20);
        }
        return GetForegroundWindow() == target;
    }

    private static void KeySend(int keyCode, uint flags)
    {
        INPUT[] inputs = new INPUT[] { KeyboardInput((ushort)keyCode, flags) };
        SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT)));
    }

    public static void Stop()
    {
        if (_hookThreadId != 0) PostThreadMessage(_hookThreadId, WM_QUIT, IntPtr.Zero, IntPtr.Zero);
    }

    private static void HookThreadMain()
    {
        _hookThreadId = GetCurrentThreadId();
        _hook = SetWindowsHookEx(WH_KEYBOARD_LL, HookProc, IntPtr.Zero, 0);
        Ready.Set();
        if (_hook == IntPtr.Zero) return;

        MSG message;
        while (GetMessage(out message, IntPtr.Zero, 0, 0) > 0)
        {
            TranslateMessage(ref message);
            DispatchMessage(ref message);
        }
        UnhookWindowsHookEx(_hook);
        _hook = IntPtr.Zero;
    }

    private static IntPtr HookCallback(int code, IntPtr message, IntPtr data)
    {
        if (code < 0) return CallNextHookEx(_hook, code, message, data);
        KBDLLHOOKSTRUCT key = (KBDLLHOOKSTRUCT)Marshal.PtrToStructure(data, typeof(KBDLLHOOKSTRUCT));
        if ((key.flags & LLKHF_INJECTED) != 0) return CallNextHookEx(_hook, code, message, data);

        int eventType = message.ToInt32();
        bool isDown = eventType == WM_KEYDOWN || eventType == WM_SYSKEYDOWN;
        bool isUp = eventType == WM_KEYUP || eventType == WM_SYSKEYUP;
        int keyCode = unchecked((int)key.vkCode);

        lock (Sync)
        {
            if (isUp)
            {
                lock (ReleasedMods)
                {
                    // Real modifier release after we synthesized one: swallow it
                    // so the app never sees a second down/up pair (Chrome would
                    // treat it as another Alt press and focus its menu button).
                    if (ReleasedMods.Remove(keyCode)) return new IntPtr(1);
                }
                if (SuppressedKeys.Remove(keyCode)) return new IntPtr(1);
            }
            if (!isDown) return CallNextHookEx(_hook, code, message, data);
            if (SuppressedKeys.Contains(keyCode)) return new IntPtr(1);

            bool ctrl = IsPressed(0x11);
            bool alt = (key.flags & LLKHF_ALTDOWN) != 0 || IsPressed(0x12);
            bool shift = IsPressed(0x10);
            bool win = IsPressed(0x5B) || IsPressed(0x5C);
            foreach (HotkeySpec spec in _hotkeys)
            {
                if (spec.KeyCode != keyCode || spec.Ctrl != ctrl || spec.Alt != alt || spec.Shift != shift || spec.Win != win) continue;
                SuppressedKeys.Add(keyCode);
                // Modifier presses (Alt down etc.) already passed through to the
                // app before the full combo matched. Synthesize their releases now
                // and swallow the real ups later, so the app sees a clean
                // press+release sequence (a dangling Alt down would leave apps
                // like Chrome in menu-mode).
                lock (ReleasedMods)
                {
                    ReleasedMods.Clear();
                    if (ctrl && IsPressed(VK_CONTROL)) { KeySend(VK_CONTROL, KEYEVENTF_KEYUP); ReleasedMods.Add(VK_CONTROL); }
                    if (shift && IsPressed(VK_SHIFT)) { KeySend(VK_SHIFT, KEYEVENTF_KEYUP); ReleasedMods.Add(VK_SHIFT); }
                    if (alt && IsPressed(VK_MENU)) { KeySend(VK_MENU, KEYEVENTF_KEYUP); ReleasedMods.Add(VK_MENU); }
                }
                long foreground = GetForegroundWindow().ToInt64();
                // Capture the focused control (edit box etc.) inside the foreground
                // window so paste can restore focus to it afterwards (Ditto-style).
                long focus = 0;
                uint fgThread = GetWindowThreadProcessId(GetForegroundWindow(), IntPtr.Zero);
                GUITHREADINFO gui = new GUITHREADINFO();
                gui.cbSize = (uint)Marshal.SizeOf(typeof(GUITHREADINFO));
                if (GetGUIThreadInfo(fgThread, ref gui) && gui.hwndFocus != IntPtr.Zero)
                {
                    focus = gui.hwndFocus.ToInt64();
                }
                Console.WriteLine("{\"type\":\"pressed\",\"id\":\"" + spec.Id + "\",\"foregroundWindow\":\"" + foreground.ToString() + "\",\"focusWindow\":\"" + focus.ToString() + "\"}");
                return new IntPtr(1);
            }
        }
        return CallNextHookEx(_hook, code, message, data);
    }

    private static HotkeySpec Parse(string id, string accelerator)
    {
        string[] parts = accelerator.Split('+');
        HotkeySpec spec = new HotkeySpec();
        spec.Id = id;
        foreach (string rawPart in parts)
        {
            string part = rawPart.Trim();
            string lower = part.ToLowerInvariant();
            if (lower == "ctrl" || lower == "control" || lower == "commandorcontrol") spec.Ctrl = true;
            else if (lower == "alt" || lower == "option") spec.Alt = true;
            else if (lower == "shift") spec.Shift = true;
            else if (lower == "super" || lower == "meta" || lower == "command") spec.Win = true;
            else spec.KeyCode = ResolveKeyCode(part);
        }
        return spec.KeyCode == 0 ? null : spec;
    }

    private static int ResolveKeyCode(string key)
    {
        string upper = key.ToUpperInvariant();
        if (upper.Length == 1)
        {
            short mapped = VkKeyScan(upper[0]);
            return mapped == -1 ? 0 : mapped & 0xff;
        }
        int functionKey;
        if (upper.StartsWith("F") && int.TryParse(upper.Substring(1), out functionKey) && functionKey >= 1 && functionKey <= 24) return 0x6F + functionKey;
        switch (upper)
        {
            case "SPACE": return 0x20;
            case "RETURN": case "ENTER": return 0x0D;
            case "ESCAPE": case "ESC": return 0x1B;
            case "TAB": return 0x09;
            case "BACKSPACE": return 0x08;
            case "DELETE": return 0x2E;
            case "INSERT": return 0x2D;
            case "HOME": return 0x24;
            case "END": return 0x23;
            case "PAGEUP": return 0x21;
            case "PAGEDOWN": return 0x22;
            case "UP": return 0x26;
            case "DOWN": return 0x28;
            case "LEFT": return 0x25;
            case "RIGHT": return 0x27;
            default: return 0;
        }
    }

    private static bool IsPressed(int keyCode)
    {
        return (GetAsyncKeyState(keyCode) & 0x8000) != 0;
    }

    private static INPUT KeyboardInput(ushort keyCode, uint flags)
    {
        INPUT input = new INPUT();
        input.type = INPUT_KEYBOARD;
        input.union.keyboard = new KEYBDINPUT { wVk = keyCode, dwFlags = flags };
        return input;
    }

    private delegate IntPtr LowLevelKeyboardProc(int code, IntPtr message, IntPtr data);

    [StructLayout(LayoutKind.Sequential)]
    private struct KBDLLHOOKSTRUCT { public uint vkCode; public uint scanCode; public uint flags; public uint time; public IntPtr extraInfo; }
    [StructLayout(LayoutKind.Sequential)]
    private struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam; public IntPtr lParam; public uint time; public POINT point; }
    [StructLayout(LayoutKind.Sequential)]
    private struct POINT { public int x; public int y; }
    [StructLayout(LayoutKind.Sequential)]
    private struct INPUT { public uint type; public InputUnion union; }
    [StructLayout(LayoutKind.Explicit)]
    private struct InputUnion
    {
        [FieldOffset(0)] public MOUSEINPUT mouse;
        [FieldOffset(0)] public KEYBDINPUT keyboard;
        [FieldOffset(0)] public HARDWAREINPUT hardware;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr extraInfo; }
    [StructLayout(LayoutKind.Sequential)]
    private struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr extraInfo; }
    [StructLayout(LayoutKind.Sequential)]
    private struct HARDWAREINPUT { public uint message; public ushort parameterLow; public ushort parameterHigh; }

    [DllImport("user32.dll", SetLastError = true)] private static extern IntPtr SetWindowsHookEx(int hookId, LowLevelKeyboardProc callback, IntPtr module, uint threadId);
    [DllImport("user32.dll")] private static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr message, IntPtr data);
    [DllImport("user32.dll", SetLastError = true)] private static extern bool UnhookWindowsHookEx(IntPtr hook);
    [DllImport("user32.dll")] private static extern int GetMessage(out MSG message, IntPtr window, uint minFilter, uint maxFilter);
    [DllImport("user32.dll")] private static extern bool TranslateMessage(ref MSG message);
    [DllImport("user32.dll")] private static extern IntPtr DispatchMessage(ref MSG message);
    [DllImport("user32.dll")] private static extern bool PostThreadMessage(uint threadId, int message, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] private static extern short GetAsyncKeyState(int keyCode);
    [DllImport("user32.dll")] private static extern short VkKeyScan(char character);
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] private static extern bool BringWindowToTop(IntPtr window);
    [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr window, int command);
    private delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr lParam);

    [DllImport("user32.dll")] private static extern bool IsWindow(IntPtr window);
    [DllImport("user32.dll")] private static extern bool EnumChildWindows(IntPtr parent, EnumWindowsProc callback, IntPtr lParam);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr window, StringBuilder builder, int maxCount);
    [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr window);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, IntPtr processId);
    [DllImport("user32.dll")] private static extern bool AttachThreadInput(uint attachThread, uint attachToThread, bool attach);
    [DllImport("user32.dll", SetLastError = true)] private static extern uint SendInput(uint inputCount, INPUT[] inputs, int inputSize);
    [DllImport("user32.dll")] private static extern bool GetGUIThreadInfo(uint threadId, ref GUITHREADINFO info);
    [DllImport("user32.dll")] private static extern IntPtr SetFocus(IntPtr window);
    [DllImport("user32.dll")] private static extern IntPtr GetFocus();
    [DllImport("user32.dll")] private static extern bool SystemParametersInfo(int action, int param, ref uint value, int init);
    [DllImport("user32.dll")] private static extern bool SystemParametersInfo(int action, int param, IntPtr value, int init);
    [DllImport("kernel32.dll")] private static extern uint GetCurrentThreadId();
}
'@

Add-Type -TypeDefinition $source -Language CSharp
[PriorityHotkeyBridge]::Start()
try {
  while (($line = [Console]::In.ReadLine()) -ne $null) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    $message = $line | ConvertFrom-Json
    if ($message.type -eq 'configure') {
      $entries = @($message.shortcuts | ForEach-Object { "$($_.id)|$($_.accelerator)" })
      [PriorityHotkeyBridge]::Configure([string[]]$entries)
    } elseif ($message.type -eq 'activate-self') {
      $activated = [PriorityHotkeyBridge]::ActivateSelf([long]$message.window)
      if (-not $activated) { Write-Error "activate-self failed for window $($message.window)" }
    } elseif ($message.type -eq 'paste') {
      if ($message.inject -eq $false) {
        $restored = [PriorityHotkeyBridge]::ActivateOnly([long]$message.foregroundWindow, [long]$message.focusWindow, [bool]$message.clearMenu)
        if (-not $restored) { Write-Error "focus restore failed for window $($message.foregroundWindow)" }
      } else {
        $pasted = [PriorityHotkeyBridge]::Paste([long]$message.foregroundWindow, [long]$message.focusWindow, [bool]$message.clearMenu)
        if (-not $pasted) { Write-Error "paste failed for window $($message.foregroundWindow)" }
      }
    }
  }
} finally {
  [PriorityHotkeyBridge]::Stop()
}
`

function normalizeAccelerator(accelerator: string): string {
  return accelerator.split('+').map((part) => part.trim().toLowerCase()).sort().join('+')
}

function getWinningRegistrations(): Array<{ id: string; accelerator: string }> {
  const winners = new Map<string, { id: string; accelerator: string }>()
  for (const [id, registration] of registrations) {
    winners.set(normalizeAccelerator(registration.accelerator), { id, accelerator: registration.accelerator })
  }
  return [...winners.values()]
}

function sendToBridge(message: object): boolean {
  if (!bridge?.stdin.writable) return false
  bridge.stdin.write(`${JSON.stringify(message)}\n`)
  return true
}

function syncBridge(): void {
  if (process.platform !== 'win32') return
  sendToBridge({ type: 'configure', shortcuts: getWinningRegistrations() })
}

function handleBridgeOutput(chunk: Buffer): void {
  stdoutBuffer += chunk.toString('utf8')
  let newlineIndex = stdoutBuffer.indexOf('\n')
  while (newlineIndex >= 0) {
    const line = stdoutBuffer.slice(0, newlineIndex).trim()
    stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1)
    if (line) {
      try {
        const message = JSON.parse(line) as BridgeMessage
        if (message.type === 'ready') {
          syncBridge()
        } else if (message.type === 'pressed' && message.id) {
          registrations.get(message.id)?.callback({
            foregroundWindow: message.foregroundWindow ?? null,
            focusWindow: message.focusWindow ?? null
          })
        }
      } catch {
        logWarn('main', `Invalid priority shortcut bridge output: ${line}`)
      }
    }
    newlineIndex = stdoutBuffer.indexOf('\n')
  }
}

function getBridgeScriptPath(): string {
  if (!bridgeScriptPath) {
    bridgeScriptPath = join(app.getPath('temp'), `wishful-claw-priority-shortcuts-${process.pid}.ps1`)
  }
  return bridgeScriptPath
}

function cleanupBridgeScript(): void {
  if (!bridgeScriptPath) return
  try {
    fs.unlinkSync(bridgeScriptPath)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') logWarn('main', `Failed to clean priority shortcut bridge script: ${String(error)}`)
  }
  bridgeScriptPath = null
}

function ensureWindowsBridge(): boolean {
  if (process.platform !== 'win32') return false
  if (bridge) return true
  if (registrations.size === 0) return false

  try {
    const scriptPath = getBridgeScriptPath()
    fs.writeFileSync(scriptPath, WINDOWS_BRIDGE_SCRIPT, 'utf8')
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    })
    bridge = child
    child.stdout.on('data', handleBridgeOutput)
    child.stderr.on('data', (chunk: Buffer) => {
      const message = chunk.toString('utf8').trim()
      if (message) logWarn('main', `Priority shortcut bridge: ${message}`)
    })
    child.on('error', (error) => {
      if (bridge === child) bridge = null
      logWarn('main', `Priority shortcut bridge failed: ${error.message}`)
    })
    child.on('exit', (code) => {
      if (bridge === child) bridge = null
      stdoutBuffer = ''
      if (registrations.size > 0 && !appQuitting) {
        logWarn('main', `Priority shortcut bridge exited: code=${String(code)}`)
        setTimeout(() => {
          ensureWindowsBridge()
        }, 1000)
      }
    })
    return true
  } catch (error) {
    bridge = null
    logWarn('main', `Priority shortcut bridge could not start: ${String(error)}`)
    return false
  }
}

function registerFallback(id: string, registration: ShortcutRegistration): boolean {
  const oldAccelerator = fallbackAccelerators.get(id)
  if (oldAccelerator) globalShortcut.unregister(oldAccelerator)
  const registered = globalShortcut.register(registration.accelerator, () => {
    registration.callback({ foregroundWindow: null, focusWindow: null })
  })
  if (registered) fallbackAccelerators.set(id, registration.accelerator)
  else fallbackAccelerators.delete(id)
  return registered
}

export function registerPriorityShortcut(
  id: string,
  accelerator: string,
  callback: (context: ShortcutContext) => void
): boolean {
  registrations.delete(id)
  const registration = { accelerator, callback }
  registrations.set(id, registration)
  if (process.platform === 'win32') {
    if (ensureWindowsBridge()) {
      syncBridge()
      return true
    }
  }
  return registerFallback(id, registration)
}

export function unregisterPriorityShortcut(id: string): void {
  registrations.delete(id)
  const fallbackAccelerator = fallbackAccelerators.get(id)
  if (fallbackAccelerator) {
    globalShortcut.unregister(fallbackAccelerator)
    fallbackAccelerators.delete(id)
  }
  if (process.platform === 'win32') {
    syncBridge()
    if (registrations.size === 0 && bridge) {
      bridge.stdin.end()
      bridge = null
    }
  }
}

export function pasteToForegroundWindow(foregroundWindow: string | null, focusWindow: string | null = null, injectKeys = true, clearMenu = false): boolean {
  if (process.platform !== 'win32' || !foregroundWindow || foregroundWindow === '0') return false
  ensureWindowsBridge()
  return sendToBridge({ type: 'paste', foregroundWindow, focusWindow: focusWindow ?? '0', inject: injectKeys, clearMenu })
}

/**
 * Force-activate one of our own windows (quick launcher) even when another
 * process owns the Windows foreground. Uses the PowerShell bridge's
 * EnsureForeground chain (foreground-lock timeout reset + Alt workaround) —
 * plain win.show()/win.focus() loses that race once the launched app or an
 * agent window holds the foreground.
 */
export function forceActivateWindow(win: BrowserWindow): boolean {
  if (process.platform !== 'win32') {
    win.show()
    win.focus()
    return true
  }
  const hwnd = win.getNativeWindowHandle().readBigInt64LE()
  if (!ensureWindowsBridge()) return false
  return sendToBridge({ type: 'activate-self', window: hwnd.toString() })
}
