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
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const token = api.getToken();
    if (!token || !user?.id) return;

    const socket = io(window.location.origin, {
      path: "/api/socket.io",
      auth: { token },
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionDelay: 2000,
    });
    socketRef.current = socket;

    socket.on("connect", () => setConnected(true));
    socket.on("disconnect", () => setConnected(false));
    socket.on("connect_error", () => setConnected(false));

    let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
    let batteryLevel: number | undefined;
    type BatteryManager = { level: number; addEventListener: (event: string, cb: () => void) => void };
    (navigator as unknown as { getBattery?: () => Promise<BatteryManager> }).getBattery?.()
      .then((batt) => {
        batteryLevel = batt.level;
        batt.addEventListener("levelchange", () => { batteryLevel = batt.level; });
      }).catch(() => {});

    if (user?.isOnline) {
      const sendHeartbeat = () => {
        if (socket.connected) {
          socket.emit("rider:heartbeat", { batteryLevel, isOnline: true, timestamp: new Date().toISOString() });
        }
      };
      socket.on("connect", sendHeartbeat);
      heartbeatInterval = setInterval(sendHeartbeat, 30_000);
    }

    const tokenRefreshInterval = setInterval(() => {
      const freshToken = api.getToken();
      if (freshToken && freshToken !== (socket.auth as { token?: string })?.token) {
        (socket.auth as { token?: string }).token = freshToken;
      }
    }, 10_000);

    return () => {
      clearInterval(tokenRefreshInterval);
      if (heartbeatInterval) clearInterval(heartbeatInterval);
      socket.disconnect();
      socketRef.current = null;
      setConnected(false);
    };
  }, [user?.id, user?.isOnline]);

  return (
    <SocketContext.Provider value={{ socket: socketRef.current, connected }}>
      {children}
    </SocketContext.Provider>
  );
}
