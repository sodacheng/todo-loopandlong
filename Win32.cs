using System.Runtime.InteropServices;

namespace TodoDailyLoop;

/// <summary>Win32 API 封装：窗口拖动、点击穿透、无边框缩放。</summary>
internal static class Win32
{
    public const int WmNchitTest = 0x84;
    public const int HtClient = 1;
    public const int HtCaption = 2;
    public const int HtLeft = 10;
    public const int HtRight = 11;
    public const int HtTop = 12;
    public const int HtTopLeft = 13;
    public const int HtTopRight = 14;
    public const int HtBottom = 15;
    public const int HtBottomLeft = 16;
    public const int HtBottomRight = 17;

    public const int GwlExStyle = -20;
    public const int WsExTransparent = 0x20;
    public const int WsExLayered = 0x80000;

    public const uint SwpNoMove = 0x2;
    public const uint SwpNoSize = 0x1;
    public const uint SwpNoZOrder = 0x4;
    public const uint SwpFrameChanged = 0x20;

    [DllImport("user32.dll")]
    public static extern bool ReleaseCapture();

    [DllImport("user32.dll")]
    public static extern IntPtr SendMessage(IntPtr hWnd, int msg, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")]
    private static extern IntPtr GetWindowLongPtr64(IntPtr hWnd, int nIndex);

    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW")]
    private static extern IntPtr SetWindowLongPtr64(IntPtr hWnd, int nIndex, IntPtr dwNewLong);

    public static IntPtr GetWindowLongPtr(IntPtr hWnd, int nIndex) => GetWindowLongPtr64(hWnd, nIndex);

    public static IntPtr SetWindowLongPtr(IntPtr hWnd, int nIndex, IntPtr dwNewLong) =>
        SetWindowLongPtr64(hWnd, nIndex, dwNewLong);

    [DllImport("user32.dll")]
    public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter,
        int x, int y, int cx, int cy, uint flags);

    /// <summary>模拟标题栏拖动（JS 在拖拽区 mousedown 时调用）。</summary>
    public static void BeginCaptionDrag(IntPtr hWnd)
    {
        ReleaseCapture();
        SendMessage(hWnd, 0xA1 /* WM_NCLBUTTONDOWN */, (IntPtr)HtCaption, IntPtr.Zero);
    }

    /// <summary>切换点击穿透（WS_EX_TRANSPARENT | WS_EX_LAYERED）。</summary>
    public static void SetClickThrough(IntPtr hWnd, bool enable)
    {
        long style = GetWindowLongPtr(hWnd, GwlExStyle).ToInt64();
        if (enable)
            style |= WsExTransparent | WsExLayered;
        else
            style &= ~(long)(WsExTransparent | WsExLayered);
        SetWindowLongPtr(hWnd, GwlExStyle, (IntPtr)style);
        // 强制刷新窗口样式使其生效
        SetWindowPos(hWnd, IntPtr.Zero, 0, 0, 0, 0, SwpNoMove | SwpNoSize | SwpNoZOrder | SwpFrameChanged);
    }
}
