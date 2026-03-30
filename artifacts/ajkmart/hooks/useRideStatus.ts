import { useCallback, useEffect, useRef, useState } from "react";
import { getRide as getRideApi } from "@workspace/api-client-react";

type RideStatusHookResult = {
  ride: any;
  setRide: React.Dispatch<React.SetStateAction<any>>;
  connectionType: "sse" | "polling" | "connecting";
  reconnect: () => void;
};

const SSE_RETRY_DELAY = 3000;
const POLL_INTERVAL = 5000;

export function useRideStatus(rideId: string): RideStatusHookResult {
  const [ride, setRide] = useState<any>(null);
  const [connectionType, setConnectionType] =
    useState<"sse" | "polling" | "connecting">("connecting");
  const sseRef = useRef<EventSource | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);
  const sseFailCountRef = useRef(0);

  const apiBase = `https://${process.env.EXPO_PUBLIC_DOMAIN}/api`;

  const startPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    setConnectionType("polling");

    const poll = async () => {
      try {
        const d = await getRideApi(rideId);
        if (mountedRef.current) setRide(d as any);
      } catch {}
    };
    poll();
    pollRef.current = setInterval(poll, POLL_INTERVAL);
  }, [rideId]);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const closeSse = useCallback(() => {
    if (sseRef.current) {
      sseRef.current.close();
      sseRef.current = null;
    }
  }, []);

  const connectSse = useCallback(() => {
    if (typeof EventSource === "undefined") {
      startPolling();
      return;
    }

    closeSse();
    setConnectionType("connecting");

    try {
      const es = new EventSource(`${apiBase}/rides/${rideId}/stream`);
      sseRef.current = es;

      es.onopen = () => {
        if (!mountedRef.current) return;
        sseFailCountRef.current = 0;
        stopPolling();
        setConnectionType("sse");
      };

      es.onmessage = (event) => {
        if (!mountedRef.current) return;
        try {
          const data = JSON.parse(event.data);
          setRide(data);
        } catch {}
      };

      es.addEventListener("ride-update", (event: any) => {
        if (!mountedRef.current) return;
        try {
          const data = JSON.parse(event.data);
          setRide(data);
        } catch {}
      });

      es.onerror = () => {
        if (!mountedRef.current) return;
        closeSse();
        sseFailCountRef.current += 1;

        if (sseFailCountRef.current >= 3) {
          startPolling();
        } else {
          setTimeout(() => {
            if (mountedRef.current) connectSse();
          }, SSE_RETRY_DELAY * sseFailCountRef.current);
        }
      };
    } catch {
      startPolling();
    }
  }, [rideId, apiBase, closeSse, startPolling, stopPolling]);

  const reconnect = useCallback(() => {
    sseFailCountRef.current = 0;
    connectSse();
  }, [connectSse]);

  useEffect(() => {
    mountedRef.current = true;
    connectSse();

    return () => {
      mountedRef.current = false;
      closeSse();
      stopPolling();
    };
  }, [rideId]);

  return { ride, setRide, connectionType, reconnect };
}
