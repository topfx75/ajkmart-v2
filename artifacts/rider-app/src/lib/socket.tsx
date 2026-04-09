import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { io, type Socket } from "socket.io-client";
import { api } from "./api";
import { useAuth } from "./auth";

type SocketContextType = {
  socket: Socket | null;
  connected: boolean;
};

const SocketContext = createContext<SocketContextType>({ socket: null, connected: false });

export function useSocket() {
  return useContext(SocketContext);
}

export function SocketProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const token = api.getToken();
    if (!token || !user?.id) return;

    const socketOrigin = import.meta.env.VITE_CAPACITOR === "true" && import.meta.env.VITE_API_BASE_URL
      ? (import.meta.env.VITE_API_BASE_URL as string).replace(/\/+$/, "")
      : window.location.origin;

    const s = io(socketOrigin, {
      path: "/api/socket.io",
      auth: { token },
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionDelay: 2000,
      reconnectionDelayMax: 30000,
      reconnectionAttempts: 20,
    });
    socketRef.current = s;
    setSocket(s);

    s.on("connect", () => setConnected(true));
    s.on("disconnect", () => setConnected(false));
    s.on("connect_error", () => setConnected(false));

    const tokenRefreshInterval = setInterval(() => {
      const freshToken = api.getToken();
      if (freshToken && freshToken !== (s.auth as { token?: string })?.token) {
        (s.auth as { token?: string }).token = freshToken;
        s.disconnect().connect();
      }
    }, 10_000);

    return () => {
      clearInterval(tokenRefreshInterval);
      s.disconnect();
      socketRef.current = null;
      setSocket(null);
      setConnected(false);
    };
  }, [user?.id]);

  useEffect(() => {
    const s = socketRef.current;
    if (!s || !user?.isOnline) return;

    let batteryLevel: number | undefined;
    type BatteryManager = { level: number; addEventListener: (event: string, cb: () => void) => void; removeEventListener: (event: string, cb: () => void) => void };
    let battRef: BatteryManager | null = null;
    let battDisposed = false;
    const onLevelChange = () => { if (battRef) batteryLevel = battRef.level; };
    (navigator as unknown as { getBattery?: () => Promise<BatteryManager> }).getBattery?.()
      .then((batt) => {
        if (battDisposed) return;
        battRef = batt;
        batteryLevel = batt.level;
        batt.addEventListener("levelchange", onLevelChange);
      }).catch(() => {});

    const sendHeartbeat = () => {
      if (s.connected) {
        s.emit("rider:heartbeat", { batteryLevel, isOnline: true, timestamp: new Date().toISOString() });
      }
    };
    s.on("connect", sendHeartbeat);
    sendHeartbeat();
    const heartbeatInterval = setInterval(sendHeartbeat, 30_000);

    return () => {
      battDisposed = true;
      clearInterval(heartbeatInterval);
      s.off("connect", sendHeartbeat);
      if (battRef) battRef.removeEventListener("levelchange", onLevelChange);
    };
  }, [user?.isOnline, socket]);

  return (
    <SocketContext.Provider value={{ socket, connected }}>
      {children}
    </SocketContext.Provider>
  );
}
