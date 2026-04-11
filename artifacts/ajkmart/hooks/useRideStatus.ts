import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { getRide as getRideApi, type Ride } from "@workspace/api-client-react";
import { API_BASE } from "@/utils/api";

type RideStatusHookResult = {
  ride: Ride | null;
  setRide: React.Dispatch<React.SetStateAction<Ride | null>>;
  connectionType: "sse" | "polling" | "connecting";
  reconnect: () => void;
};

/** Base delay (ms) for the first SSE reconnection attempt. */
const SSE_RETRY_BASE_DELAY = 2000;
/**
 * Maximum SSE reconnection delay (ms). Caps exponential growth so we never
 * wait more than 30 s between reconnects before falling back to polling.
 */
const SSE_MAX_RETRY_DELAY = 30_000;
/**
 * On Edge/slow networks the initial SSE connect can time out silently.
 * After this many ms without the connection going live, we abort and retry.
 */
const SSE_CONNECT_TIMEOUT_MS = 8000;
const POLL_INTERVAL_GOOD = 5000;
const POLL_INTERVAL_SLOW  = 12_000;
/**
 * How long (ms) to stay in polling mode before attempting to re-upgrade
 * to SSE.  Gives transient connectivity blips time to recover.
 */
const POLLING_UPGRADE_DELAY = 45_000;

export function useRideStatus(rideId: string): RideStatusHookResult {
  const [ride, setRide] = useState<Ride | null>(null);
  const [connectionType, setConnectionType] =
    useState<"sse" | "polling" | "connecting">("connecting");
  const abortRef = useRef<AbortController | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const upgradeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const sseFailCountRef = useRef(0);

  const clearRetryTimer = useCallback(() => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  const clearUpgradeTimer = useCallback(() => {
    if (upgradeTimerRef.current) {
      clearTimeout(upgradeTimerRef.current);
      upgradeTimerRef.current = null;
    }
  }, []);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    clearUpgradeTimer();
  }, [clearUpgradeTimer]);

  /* Track controllers that were intentionally aborted (via closeSse/reconnect)
     so the catch block in connectSse can distinguish them from timeout aborts. */
  const intentionalAbortSet = useRef<WeakSet<AbortController>>(new WeakSet());

  const closeSse = useCallback(() => {
    if (abortRef.current) {
      intentionalAbortSet.current.add(abortRef.current);
      abortRef.current.abort();
      abortRef.current = null;
    }
  }, []);

  /* Forward declaration — connectSse is referenced by startPolling */
  const connectSseRef = useRef<() => void>(() => {});

  const startPolling = useCallback((slow = false) => {
    if (pollRef.current) clearInterval(pollRef.current);
    clearUpgradeTimer();
    setConnectionType("polling");

    const interval = slow ? POLL_INTERVAL_SLOW : POLL_INTERVAL_GOOD;

    const poll = async () => {
      const t0 = Date.now();
      try {
        const d = await getRideApi(rideId);
        if (mountedRef.current) {
          /* Merge polled data with existing state rather than replacing it
             entirely — this preserves any fields (e.g. tripOtp) that arrived
             via a socket event and might not be re-sent in every poll response,
             and prevents a "jumpy" UI reset when upgrading back to SSE. */
          setRide((prev) => (prev ? { ...prev, ...d } : d));
          const status = d?.status;
          if (status === "completed" || status === "cancelled") {
            stopPolling();
          }
        }
      } catch {}
      /* Adaptive: if the poll itself took longer than POLL_INTERVAL_GOOD,
         the connection is slow — reschedule with POLL_INTERVAL_SLOW. */
      const elapsed = Date.now() - t0;
      if (!slow && elapsed > POLL_INTERVAL_GOOD && mountedRef.current && pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = setInterval(poll, POLL_INTERVAL_SLOW);
      }
    };
    poll();
    pollRef.current = setInterval(poll, interval);

    /* Schedule a re-upgrade attempt to SSE after POLLING_UPGRADE_DELAY.
       If SSE succeeds connectSse will call stopPolling internally. */
    upgradeTimerRef.current = setTimeout(() => {
      if (mountedRef.current && pollRef.current) {
        sseFailCountRef.current = 0;
        connectSseRef.current();
      }
    }, POLLING_UPGRADE_DELAY);
  }, [rideId, clearUpgradeTimer, stopPolling]);

  const connectSse = useCallback(async () => {
    closeSse();
    clearRetryTimer();
    setConnectionType("connecting");

    const controller = new AbortController();
    abortRef.current = controller;

    /* Abort the SSE connect attempt if it takes too long (Edge networks). */
    const connectTimeoutId = setTimeout(() => {
      if (abortRef.current === controller) controller.abort();
    }, SSE_CONNECT_TIMEOUT_MS);

    try {
      let token: string | null = null;
      try {
        const SS = await import("expo-secure-store");
        token = await SS.getItemAsync("ajkmart_token");
      } catch {}
      /* Never fall back to AsyncStorage — tokens must be read from SecureStore only. */
      const sseUrl = `${API_BASE}/rides/${rideId}/stream`;

      const response = await fetch(sseUrl, {
        headers: {
          Accept: "text/event-stream",
          "Cache-Control": "no-cache",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        signal: controller.signal,
      });

      clearTimeout(connectTimeoutId);

      if (!response.ok || !response.body) {
        throw new Error("SSE connection failed");
      }

      if (!mountedRef.current) return;
      sseFailCountRef.current = 0;
      /* SSE is up — discard the polling fallback and its upgrade timer. */
      stopPolling();
      setConnectionType("sse");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      let streamDone = false;
      while (mountedRef.current) {
        const { done, value } = await reader.read();
        if (done) { streamDone = true; break; }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          try {
            const data = JSON.parse(line.slice(5).trim()) as Ride;
            if (!mountedRef.current) return;
            /* Merge SSE payload with previous state so that fields delivered via
               socket events (e.g. tripOtp set by ride:otp) are not lost when
               the next SSE push omits them. */
            setRide((prev) => (prev ? { ...prev, ...data } : data));
            if (data?.status === "completed" || data?.status === "cancelled") {
              /* Terminal state — close SSE cleanly and stop polling. */
              reader.releaseLock();
              abortRef.current?.abort();
              abortRef.current = null;
              stopPolling();
              return;
            }
          } catch {}
        }
      }

      if (streamDone && mountedRef.current) {
        sseFailCountRef.current += 1;
        if (sseFailCountRef.current >= 3) {
          startPolling();
        } else {
          const delay = Math.min(
            SSE_RETRY_BASE_DELAY * Math.pow(2, sseFailCountRef.current - 1),
            SSE_MAX_RETRY_DELAY,
          );
          retryTimerRef.current = setTimeout(() => {
            if (mountedRef.current) connectSse();
          }, delay);
        }
      }
    } catch (err: unknown) {
      clearTimeout(connectTimeoutId);
      const isAbort = (err as { name?: string })?.name === "AbortError";
      if (isAbort) {
        /* Distinguish intentional aborts (closeSse / reconnect / unmount)
           from timeout aborts triggered by SSE_CONNECT_TIMEOUT_MS. */
        const wasIntentional = intentionalAbortSet.current.has(controller);
        if (wasIntentional) return;
        /* Connection timed out on Edge/slow network — fall through to retry. */
        if (!mountedRef.current) return;
        sseFailCountRef.current += 1;
        if (sseFailCountRef.current >= 3) {
          startPolling(true);
        } else {
          const delay = Math.min(
            SSE_RETRY_BASE_DELAY * Math.pow(2, sseFailCountRef.current - 1),
            SSE_MAX_RETRY_DELAY,
          );
          retryTimerRef.current = setTimeout(() => {
            if (mountedRef.current) connectSse();
          }, delay);
        }
        return;
      }
      if (!mountedRef.current) return;

      sseFailCountRef.current += 1;

      if (sseFailCountRef.current >= 3) {
        /* Three consecutive failures — fall back to HTTP polling.
           startPolling will schedule a re-upgrade attempt automatically. */
        startPolling();
      } else {
        /* Exponential back-off capped at SSE_MAX_RETRY_DELAY. */
        const delay = Math.min(
          SSE_RETRY_BASE_DELAY * Math.pow(2, sseFailCountRef.current - 1),
          SSE_MAX_RETRY_DELAY,
        );
        retryTimerRef.current = setTimeout(() => {
          if (mountedRef.current) connectSse();
        }, delay);
      }
    }
  }, [rideId, closeSse, clearRetryTimer, startPolling, stopPolling]);

  /* Keep the ref in sync so startPolling can call connectSse without a
     circular dependency in the callback dependency arrays. */
  useEffect(() => {
    connectSseRef.current = connectSse;
  }, [connectSse]);

  const reconnect = useCallback(() => {
    sseFailCountRef.current = 0;
    stopPolling();
    closeSse();
    connectSse();
  }, [connectSse, stopPolling, closeSse]);

  useEffect(() => {
    mountedRef.current = true;
    connectSse();

    const appStateSub = AppState.addEventListener("change", (state) => {
      if (state === "active" && mountedRef.current) {
        reconnect();
      }
    });

    return () => {
      mountedRef.current = false;
      clearRetryTimer();
      clearUpgradeTimer();
      closeSse();
      stopPolling();
      appStateSub.remove();
    };
  }, [rideId]);

  return { ride, setRide, connectionType, reconnect };
}
