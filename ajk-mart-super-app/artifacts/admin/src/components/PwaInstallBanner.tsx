import type { CSSProperties } from "react";
import { usePwaInstall } from "../hooks/usePwaInstall";

export function PwaInstallBanner() {
  const { isInstallable, isInstalled, isIOS, isStandalone, isDismissed, promptInstall, dismiss } = usePwaInstall();

  if (isInstalled || isStandalone || isDismissed) return null;
  if (!isInstallable && !isIOS) return null;

  return (
    <div style={styles.wrapper}>
      <div style={styles.banner}>
        <div style={styles.left}>
          <div style={styles.iconBox}>
            <span style={{ fontSize: 20 }}>⚙️</span>
          </div>
          <div>
            <div style={styles.title}>Install Admin Panel</div>
            <div style={styles.subtitle}>
              {isIOS
                ? "Tap Share → Add to Home Screen"
                : "Install for quick access & offline use"}
            </div>
          </div>
        </div>
        <div style={styles.actions}>
          {!isIOS && (
            <button style={styles.installBtn} onClick={promptInstall}>
              Install
            </button>
          )}
          <button style={styles.closeBtn} onClick={dismiss} aria-label="Dismiss">
            ✕
          </button>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  wrapper: {
    position: "fixed",
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 9999,
    padding: "12px 16px",
    background: "linear-gradient(135deg, #1e293b 0%, #334155 100%)",
    borderTop: "1px solid rgba(255,255,255,0.08)",
    boxShadow: "0 -4px 20px rgba(0,0,0,0.35)",
  },
  banner: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  left: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    flex: 1,
    minWidth: 0,
  },
  iconBox: {
    width: 44,
    height: 44,
    borderRadius: 12,
    background: "rgba(255,255,255,0.1)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  title: {
    fontFamily: "Inter, sans-serif",
    fontWeight: 700,
    fontSize: 14,
    color: "#f1f5f9",
    marginBottom: 2,
  },
  subtitle: {
    fontFamily: "Inter, sans-serif",
    fontSize: 12,
    color: "rgba(255,255,255,0.55)",
  },
  actions: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexShrink: 0,
  },
  installBtn: {
    background: "#6366f1",
    color: "#fff",
    border: "none",
    borderRadius: 10,
    padding: "8px 18px",
    fontFamily: "Inter, sans-serif",
    fontWeight: 600,
    fontSize: 13,
    cursor: "pointer",
    whiteSpace: "nowrap" as const,
  },
  closeBtn: {
    background: "transparent",
    color: "rgba(255,255,255,0.4)",
    border: "none",
    padding: "6px 8px",
    cursor: "pointer",
    fontSize: 14,
    fontFamily: "Inter, sans-serif",
  },
};
