import { useState, useEffect, useRef, useCallback } from "react";
import { Link } from "wouter";
import { useAuth } from "../lib/auth";
import { api } from "../lib/api";
import { usePlatformConfig } from "../lib/useConfig";
import { useLanguage } from "../lib/useLanguage";
import { useSocket } from "../lib/socket";
import { tDual } from "@workspace/i18n";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  playRequestSound,
  unlockAudio,
  isAudioLocked,
  isSilenced,
  getSilenceRemaining,
  getSilenceMode,
  setSilenceMode,
  unsilence,
  syncSilenceModeToServer,
} from "../lib/notificationSound";
import { logRideEvent } from "../lib/rideUtils";
import {
  enqueue,
  addDismissed,
  removeDismissed,
  sweepAndLoadDismissed,
  clearAllDismissed,
} from "../lib/gpsQueue";
import { haversineMeters } from "../components/dashboard/helpers";
import {
  Bike,
  Wifi,
  Eye,
  Zap,
  Clock,
  ChevronRight,
  CheckCircle,
  AlertTriangle,
} from "lucide-react";

import {
  LiveClock,
  SkeletonHome,
  StatsGrid,
  OnlineToggleCard,
  SilenceControls,
  FixedBanners,
  InlineWarnings,
  OrderRequestCard,
  RideRequestCard,
  OfflineConfirmDialog,
  ActiveTaskBanner,
  RequestListHeader,
  formatCurrency,
} from "../components/dashboard";

export default function Home() {
  const { user, refreshUser, loading: authLoading } = useAuth();
  const { config } = usePlatformConfig();
  const { language } = useLanguage();
  const T = (key: Parameters<typeof tDual>[0]) => tDual(key, language);
  const currency = config.platform.currencySymbol ?? "Rs.";
  const qc = useQueryClient();
  const [toggling, setToggling] = useState(false);
  const [tabVisible, setTabVisible] = useState(!document.hidden);
  const [toastMsg, setToastMsg] = useState("");
  const [toastType, setToastType] = useState<"success" | "error">("success");
  const [newFlash, setNewFlash] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set<string>());


  const [audioLocked, setAudioLocked] = useState(false);

  useEffect(() => {
    sweepAndLoadDismissed().then((ids) => {
      if (ids.size > 0) setDismissed(ids);
    });
    /* Check audio lock state on mount */
    setAudioLocked(isAudioLocked());
  }, []);

  const [silenceOn, setSilenceOn] = useState(getSilenceMode());
  const prevIdsRef = useRef<Set<string>>(new Set());
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const soundIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hasUnseenRequestsRef = useRef(false);
  const [silenced, setSilenced] = useState(isSilenced());
  const [silenceRemaining, setSilenceRemaining] = useState(getSilenceRemaining());
  const [showSilenceMenu, setShowSilenceMenu] = useState(false);

  useEffect(() => {

    const handler = () => {
      unlockAudio();
      setAudioLocked(false);
    };
    document.addEventListener("click", handler, { once: true });
    document.addEventListener("touchstart", handler, { once: true });
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      if (soundIntervalRef.current) clearInterval(soundIntervalRef.current);
      document.removeEventListener("click", handler);
      document.removeEventListener("touchstart", handler);
    };
  }, []);

  const { socket: sharedSocket, connected: socketConnected } = useSocket();

  useEffect(() => {
    if (!silenced) return;
    const t = setInterval(() => {
      const rem = getSilenceRemaining();
      setSilenceRemaining(rem);
      if (rem <= 0) {
        setSilenced(false);
        setShowSilenceMenu(false);
        /* Sync expiry to server so admin "active silence mode" view stays accurate */
        syncSilenceModeToServer(false);
      }
    }, 1000);
    return () => clearInterval(t);
  }, [silenced]);

  const showToast = useCallback(
    (msg: string, type: "success" | "error" = "success") => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      setToastMsg(msg);
      setToastType(type);
      toastTimerRef.current = setTimeout(() => setToastMsg(""), 3000);
    },
    [],
  );

  const [wakeLockWarning, setWakeLockWarning] = useState(false);
  const [optimisticOnline, setOptimisticOnline] = useState<boolean | null>(null);
  const effectiveOnline = optimisticOnline !== null ? optimisticOnline : !!user?.isOnline;

  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const TOGGLE_DEBOUNCE_MS = 1000;
  const lastToggleRef = useRef<number>(0);

  const [showOfflineConfirm, setShowOfflineConfirm] = useState(false);
  const [zoneWarning, setZoneWarning] = useState<string | null>(null);

  const doActualToggle = async () => {
    const now = Date.now();
    lastToggleRef.current = now;
    setToggling(true);
    const newStatus = !effectiveOnline;
    setOptimisticOnline(newStatus);
    let succeeded = false;
    try {
      const result = await api.setOnline(newStatus);
      if (!isMountedRef.current) return;
      if (result?.serviceZoneWarning) {
        setZoneWarning(result.serviceZoneWarning);
      } else {
        setZoneWarning(null);
      }
      await refreshUser().catch(() => {});
      if (!isMountedRef.current) return;
      succeeded = true;
      showToast(newStatus ? T("youAreNowOnline") : T("youAreNowOffline"), "success");
    } catch (e: unknown) {
      if (!isMountedRef.current) return;
      setOptimisticOnline(!newStatus);
      showToast(e instanceof Error ? e.message : T("somethingWentWrong"), "error");
    } finally {
      if (isMountedRef.current) {
        if (succeeded) setOptimisticOnline(null);
        setToggling(false);
      }
    }
  };

  const toggleOnline = async () => {
    const now = Date.now();
    if (toggling || now - lastToggleRef.current < TOGGLE_DEBOUNCE_MS) return;
    lastToggleRef.current = now;

    if (effectiveOnline && totalRequests > 0) {
      setShowOfflineConfirm(true);
      return;
    }

    await doActualToggle();
  };

  const { data: earningsData } = useQuery({
    queryKey: ["rider-earnings"],
    queryFn: () => api.getEarnings(),
    refetchInterval: tabVisible ? 60000 : false,
    enabled: effectiveOnline && tabVisible,
  });

  const { data: activeData } = useQuery({
    queryKey: ["rider-active"],
    queryFn: () => api.getActive(),
    refetchInterval: tabVisible ? 8000 : false,
    enabled: effectiveOnline && tabVisible,
  });
  const hasActiveTask = !!(activeData?.order || activeData?.ride);

  const { data: requestsData, isLoading: requestsLoading, isError: requestsError } = useQuery({
    queryKey: ["rider-requests"],
    queryFn: () => api.getRequests(),
    refetchInterval: tabVisible ? (user?.isOnline ? 12000 : 60000) : false,
    enabled: effectiveOnline && tabVisible,
  });

  const { data: cancelStatsData } = useQuery({
    queryKey: ["rider-cancel-stats"],
    queryFn: () => api.getCancelStats(),
    refetchInterval: tabVisible ? 120000 : false,
    staleTime: 60000,
  });

  const { data: ignoreStatsData } = useQuery({
    queryKey: ["rider-ignore-stats"],
    queryFn: () => api.getIgnoreStats(),
    refetchInterval: tabVisible ? 120000 : false,
    staleTime: 60000,
  });

  const allOrders: any[] = requestsData?.orders || [];
  const allRides: any[] = requestsData?.rides || [];
  /* Server time from the API envelope — used to offset AcceptCountdown for clock drift */
  const requestsServerTime: string | null = requestsData?._serverTime ?? null;

  /* Sync dismissed set with server: drop dismissed IDs no longer on server */
  useEffect(() => {
    if (!requestsData) return;
    const serverIds = new Set<string>([
      ...allOrders.map((o: any) => o.id),
      ...allRides.map((r: any) => r.id),
    ]);
    setDismissed((prev) => {
      /* Keep only IDs that still exist on the server */
      const next = new Set([...prev].filter((id) => serverIds.has(id)));
      if (next.size === prev.size) return prev;
      [...prev].filter((id) => !serverIds.has(id)).forEach((id) => removeDismissed(id));
      return next;
    });
  }, [requestsData]);

  /* New-request flash — pulse the header text; ring around the card container */
  const currentIdsSig = [...allOrders.map((o: any) => o.id), ...allRides.map((r: any) => r.id)]
    .sort()
    .join(",");
  useEffect(() => {
    const currentIds = new Set<string>(currentIdsSig.split(",").filter(Boolean));
    const prevIds = prevIdsRef.current;
    let hasNew = false;
    currentIds.forEach((id) => {
      if (!prevIds.has(id)) hasNew = true;
    });

    if (hasNew && currentIds.size > 0) {
      setNewFlash(true);
      setTimeout(() => setNewFlash(false), 2500);
      /* Recheck audio lock before playing — policy may have changed since mount */
      const locked = isAudioLocked();
      setAudioLocked(locked);
      if (!locked) playRequestSound();
      hasUnseenRequestsRef.current = true;
    }

    if (currentIds.size === 0) {
      hasUnseenRequestsRef.current = false;
      if (soundIntervalRef.current) {
        clearInterval(soundIntervalRef.current);
        soundIntervalRef.current = null;
      }
    } else if (hasUnseenRequestsRef.current && !soundIntervalRef.current) {
      soundIntervalRef.current = setInterval(() => {
        if (
          hasUnseenRequestsRef.current &&
          !getSilenceMode() &&
          !isSilenced() &&
          !document.hidden &&
          !isAudioLocked()
        )
          playRequestSound();
      }, 8000);
    }

    prevIdsRef.current = currentIds;
  }, [currentIdsSig]);

  /* On tab re-focus: purge expired dismissed entries, then refetch */
  useEffect(() => {
    const handler = () => {
      const visible = !document.hidden;
      setTabVisible(visible);
      if (visible) {
        /* Recheck audio lock — browser may re-suspend AudioContext while hidden */
        setAudioLocked(isAudioLocked());
        /* Sweep expired dismissed entries before triggering the refetch */
        sweepAndLoadDismissed().then((freshIds) => {
          setDismissed(freshIds);
          qc.invalidateQueries({ queryKey: ["rider-requests"] });
          qc.invalidateQueries({ queryKey: ["rider-active"] });
        });
      }
    };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, [qc]);

  useEffect(() => {
    if (!effectiveOnline || !tabVisible) return;
    if (!("wakeLock" in navigator)) {
      setWakeLockWarning(true);
      return;
    }

    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;

    const acquire = async () => {
      try {
        if (cancelled || document.hidden) return;
        sentinel = await (
          navigator as Navigator & {
            wakeLock: { request(type: string): Promise<WakeLockSentinel> };
          }
        ).wakeLock.request("screen");
        setWakeLockWarning(false);
      } catch {
        setWakeLockWarning(true);
      }
    };

    acquire();

    return () => {
      cancelled = true;
      sentinel?.release().catch(() => {});
    };
  }, [effectiveOnline, tabVisible]);

  useEffect(() => {
    const handleLogout = () => {
      setDismissed(new Set());
      clearAllDismissed();
    };
    window.addEventListener("ajkmart:logout", handleLogout);
    return () => window.removeEventListener("ajkmart:logout", handleLogout);
  }, []);

  const [gpsWarning, setGpsWarning] = useState<string | null>(null);
  const gpsWarningRef = useRef<string | null>(null);

  const setGpsWarningWithRef = (val: string | null) => {
    gpsWarningRef.current = val;
    setGpsWarning(val);
  };

  const batteryRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (typeof navigator !== "undefined" && "getBattery" in navigator) {
      type BatteryManager = { level: number; addEventListener: (event: string, cb: () => void) => void; removeEventListener: (event: string, cb: () => void) => void };
      let battRef: BatteryManager | null = null;
      let battDisposed = false;
      const onLevelChange = () => {
        if (battRef) batteryRef.current = Math.round(battRef.level * 100);
      };
      (navigator as unknown as { getBattery: () => Promise<BatteryManager> })
        .getBattery()
        .then((batt) => {
          if (battDisposed) return;
          battRef = batt;
          batteryRef.current = Math.round(batt.level * 100);
          batt.addEventListener("levelchange", onLevelChange);
        })
        .catch(() => {});
      return () => {
        battDisposed = true;
        if (battRef) battRef.removeEventListener("levelchange", onLevelChange);
      };
    }
  }, []);

  /* Socket event listeners — invalidate queries on new or changed requests */
  useEffect(() => {
    if (!sharedSocket) return;
    const handleNewRequest = () => {
      qc.invalidateQueries({ queryKey: ["rider-requests"] });
    };
    /* Also listen for admin/customer-driven state changes */
    const handleStateChange = () => {
      qc.invalidateQueries({ queryKey: ["rider-requests"] });
      qc.invalidateQueries({ queryKey: ["rider-active"] });
    };
    const handleForceSilenceOff = () => {
      unsilence();
      setSilenceMode(false);
      setSilenceOn(false);
      setToastMsg("Admin has disabled your silence mode.");
      setToastType("error");
    };
    sharedSocket.on("rider:new-request", handleNewRequest);
    sharedSocket.on("new:request", handleNewRequest);
    sharedSocket.on("rider:request-cancelled", handleStateChange);
    sharedSocket.on("rider:ride-updated", handleStateChange);
    sharedSocket.on("rider:order-updated", handleStateChange);
    sharedSocket.on("admin:force-silence-off", handleForceSilenceOff);
    return () => {
      sharedSocket.off("rider:new-request", handleNewRequest);
      sharedSocket.off("new:request", handleNewRequest);
      sharedSocket.off("rider:request-cancelled", handleStateChange);
      sharedSocket.off("rider:ride-updated", handleStateChange);
      sharedSocket.off("rider:order-updated", handleStateChange);
      sharedSocket.off("admin:force-silence-off", handleForceSilenceOff);
    };
  }, [sharedSocket, qc]);

  /* GPS watch — idle Home screen, no active task.
     The socket heartbeat (socket.tsx) is the sole liveness signal.
     REST pings here only update the stored coordinate when position changes
     meaningfully; they are not keepalive traffic. Memoized haversineMeters
     from helpers.ts is used so no redundant trig runs per position event. */
  useEffect(() => {
    if (!user?.isOnline || hasActiveTask || !user?.id) return;
    if (!navigator?.geolocation) return;

    let lastSentTime = 0;
    let lastLat: number | null = null;
    let lastLng: number | null = null;
    /* Only send REST location updates on meaningful movement. No time-based
       periodic fallback — the socket heartbeat is the sole liveness signal. */
    const MIN_DISTANCE_METERS = 25;
    /* Minimum interval to debounce burst callbacks from the OS */
    const DEBOUNCE_MS = 1000;

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const now = Date.now();
        const { latitude, longitude, accuracy, speed, heading } = pos.coords;

        const isMockGps = accuracy !== null && accuracy === 0;
        if (isMockGps) {
          setGpsWarningWithRef(
            "Suspicious GPS accuracy detected. Please disable mock location apps.",
          );
          return;
        }

        if (now - lastSentTime < DEBOUNCE_MS) return;

        /* memoized haversine — skip if position hasn't changed meaningfully */
        if (lastLat !== null && lastLng !== null) {
          const dist = haversineMeters(lastLat, lastLng, latitude, longitude);
          if (dist < MIN_DISTANCE_METERS) return;
        }
        /* No previous position — record it but don't send a keepalive ping;
           the socket heartbeat already signals liveness to the server. */
        if (lastLat === null) {
          lastLat = latitude;
          lastLng = longitude;
          lastSentTime = now;
          return;
        }

        lastSentTime = now;
        lastLat = latitude;
        lastLng = longitude;
        const locationData = {
          latitude,
          longitude,
          accuracy: accuracy ?? undefined,
          speed: speed ?? undefined,
          heading: heading ?? undefined,
          batteryLevel: batteryRef.current,
        };
        const queuedPing = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          timestamp: new Date().toISOString(),
          ...locationData,
        };

        if (!navigator.onLine) {
          enqueue(queuedPing).catch(() => {});
          return;
        }

        api
          .updateLocation(locationData)
          .then(() => {
            if (gpsWarningRef.current) setGpsWarningWithRef(null);
          })
          .catch((err: Error) => {
            const msg = err.message || "";
            const isSpoofError =
              msg.toLowerCase().includes("spoof") || msg.toLowerCase().includes("mock");
            if (isSpoofError) {
              setGpsWarningWithRef(`GPS Spoof Detected: ${msg}`);
            } else {
              enqueue(queuedPing).catch(() => {});
              setGpsWarningWithRef(T("gpsLocationError"));
            }
          });
      },
      () => {
        setGpsWarningWithRef(T("gpsNotAvailable"));
      },
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 30_000 },
    );

    return () => {
      navigator.geolocation.clearWatch(watchId);
    };
  }, [user?.isOnline, hasActiveTask, user?.id]);

  const orders = allOrders.filter((o: any) => !dismissed.has(o.id));
  const rides = allRides.filter((r: any) => !dismissed.has(r.id));
  const totalRequests = orders.length + rides.length;

  const dismiss = useCallback(
    (id: string) => {
      addDismissed(id);
      setDismissed((prev) => {
        const next = new Set([...prev, id]);
        const serverIds = new Set<string>([
          ...allOrders.map((o: any) => o.id),
          ...allRides.map((r: any) => r.id),
        ]);
        const remainingVisible = [...serverIds].filter((sid) => !next.has(sid));
        if (remainingVisible.length === 0) {
          hasUnseenRequestsRef.current = false;
          if (soundIntervalRef.current) {
            clearInterval(soundIntervalRef.current);
            soundIntervalRef.current = null;
          }
        }
        return next;
      });
    },
    [allOrders, allRides],
  );

  const stopRequestSoundIfEmpty = () => {
    const remainingCount = allOrders.length + allRides.length;
    if (remainingCount <= 1) {
      hasUnseenRequestsRef.current = false;
      if (soundIntervalRef.current) {
        clearInterval(soundIntervalRef.current);
        soundIntervalRef.current = null;
      }
    }
  };

  /* Mutations — invalidate rider-requests on both success and error to prevent ghost cards */
  const acceptOrderMut = useMutation({
    mutationFn: (id: string) => api.acceptOrder(id),
    onSuccess: () => {
      stopRequestSoundIfEmpty();
      qc.invalidateQueries({ queryKey: ["rider-requests"] });
      qc.invalidateQueries({ queryKey: ["rider-active"] });
      showToast("Order accepted! Check Active tab.", "success");
    },
    onError: (e: any, id) => {
      qc.invalidateQueries({ queryKey: ["rider-requests"] });
      if (e?.status === 409 || /already taken|already accepted/i.test(e?.message || "")) {
        dismiss(id);
        showToast("This order was already accepted by another rider.", "error");
      } else {
        showToast(e.message || "Could not accept order. Please try again.", "error");
      }
    },
  });

  const rejectOrderMut = useMutation({
    mutationFn: (id: string) => api.rejectOrder(id),
    onSuccess: (_: any, id: string) => {
      dismiss(id);
      qc.invalidateQueries({ queryKey: ["rider-requests"] });
      showToast("Order rejected.", "success");
    },
    onError: (e: any) => {
      qc.invalidateQueries({ queryKey: ["rider-requests"] });
      showToast(e.message || "Could not reject order", "error");
    },
  });

  const acceptRideMut = useMutation({
    mutationFn: (id: string) => api.acceptRide(id),
    onSuccess: (_: any, id: string) => {
      stopRequestSoundIfEmpty();
      qc.invalidateQueries({ queryKey: ["rider-requests"] });
      qc.invalidateQueries({ queryKey: ["rider-active"] });
      logRideEvent(id, "accepted", (msg, isErr) =>
        showToast(msg, isErr ? "error" : "success"),
      );
      showToast("Ride accepted! Check Active tab.", "success");
    },
    onError: (e: any, id) => {
      qc.invalidateQueries({ queryKey: ["rider-requests"] });
      if (e?.status === 409 || /already taken|already accepted/i.test(e?.message || "")) {
        dismiss(id);
        showToast("This ride was already accepted by another rider.", "error");
      } else {
        showToast(e.message || "Could not accept ride. Please try again.", "error");
      }
    },
  });

  const counterRideMut = useMutation({
    mutationFn: ({ id, counterFare }: { id: string; counterFare: number }) =>
      api.counterRide(id, { counterFare }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rider-requests"] });
      showToast("Counter offer submitted!", "success");
    },
    onError: (e: any) => {
      qc.invalidateQueries({ queryKey: ["rider-requests"] });
      showToast(e.message || "Counter offer failed", "error");
    },
  });

  const rejectOfferMut = useMutation({
    mutationFn: (id: string) => api.rejectOffer(id),
    onSuccess: (_: any, id: string) => {
      dismiss(id);
      qc.invalidateQueries({ queryKey: ["rider-requests"] });
      showToast("Ride skipped.", "success");
    },
    onError: (e: any) => {
      qc.invalidateQueries({ queryKey: ["rider-requests"] });
      showToast(e.message, "error");
    },
  });

  const ignoreRideMut = useMutation({
    mutationFn: (id: string) => api.ignoreRide(id),
    onSuccess: (data: any, id: string) => {
      dismiss(id);
      qc.invalidateQueries({ queryKey: ["rider-requests"] });
      const p = data?.ignorePenalty ?? data;
      if (p?.penaltyApplied > 0) {
        showToast(
          `Ignored — ${currency} ${p.penaltyApplied} penalty deducted!${p.restricted ? " Account restricted." : ""}`,
          "error",
        );
      } else {
        showToast(`Ride ignored (${p?.dailyIgnores || "?"} today).`, "success");
      }
    },
    onError: (e: any) => {
      qc.invalidateQueries({ queryKey: ["rider-requests"] });
      showToast(e.message || "Ignore failed", "error");
    },
  });

  const toggleSilence = () => {
    const next = !getSilenceMode();
    setSilenceMode(next);
    setSilenceOn(next);
    showToast(
      next ? "Silence mode ON — no alert sounds" : "Silence mode OFF — sounds enabled",
      "success",
    );
  };

  const getDeliveryEarn = (type: string) => {
    const df = config.deliveryFee;
    let fee: number;
    if (typeof df === "number") {
      fee = df;
    } else if (df && typeof df === "object") {
      const raw =
        (df as Record<string, unknown>)[type] ?? (df as Record<string, unknown>).mart ?? 0;
      fee = typeof raw === "number" ? raw : parseFloat(String(raw)) || 0;
    } else {
      fee = parseFloat(String(df)) || 0;
    }
    return fee * (config.finance.riderEarningPct / 100);
  };

  if (authLoading) return <SkeletonHome />;

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return T("goodMorning");
    if (h < 17) return T("goodAfternoon");
    return T("goodEvening");
  })();

  /* ── Request list content — loading / error / empty / data states ─────── */
  const renderRequestList = () => {
    if (requestsLoading) {
      return (
        <div className="bg-white p-10 text-center">
          <div className="w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-gray-400 text-xs font-medium">Loading requests…</p>
        </div>
      );
    }
    if (requestsError) {
      return (
        <div className="bg-white p-8 text-center">
          <AlertTriangle size={28} className="text-red-300 mx-auto mb-3" />
          <p className="text-gray-600 font-bold text-sm">Could not load requests</p>
          <p className="text-gray-400 text-xs mt-1">Check your connection and try again.</p>
          <button
            onClick={() => qc.invalidateQueries({ queryKey: ["rider-requests"] })}
            className="mt-3 text-xs text-indigo-600 font-bold underline"
          >
            Retry
          </button>
        </div>
      );
    }
    if (totalRequests === 0) {
      return (
        <div className="bg-white p-8 sm:p-10 text-center">
          <div className="w-14 h-14 sm:w-16 sm:h-16 bg-gray-50 rounded-3xl flex items-center justify-center mx-auto mb-4">
            <Bike size={28} className="text-gray-300" />
          </div>
          <p className="text-gray-600 font-bold text-sm sm:text-base">{T("noRequestsNow")}</p>
          <p className="text-gray-400 text-xs mt-1.5">{T("autoRefreshes")}</p>
          {dismissed.size > 0 && (
            <button
              onClick={() => {
                setDismissed(new Set());
                clearAllDismissed();
              }}
              className="mt-4 text-xs text-gray-900 font-bold bg-gray-100 border border-gray-200 px-4 py-2 rounded-full inline-flex items-center gap-1.5 hover:bg-gray-200 transition-colors"
              aria-label={`Show ${dismissed.size} hidden requests`}
            >
              <Eye size={12} /> Show {dismissed.size} hidden request
              {dismissed.size > 1 ? "s" : ""}
            </button>
          )}
        </div>
      );
    }
    return (
      <div className="bg-white divide-y divide-gray-100">
        {orders.map((o: any) => (
          <OrderRequestCard
            key={o.id}
            order={o}
            earnings={getDeliveryEarn(o.type)}
            currency={currency}
            onAccept={(id) => acceptOrderMut.mutate(id)}
            onReject={(id) => rejectOrderMut.mutate(id)}
            onDismiss={dismiss}
            acceptPending={acceptOrderMut.isPending}
            rejectPending={rejectOrderMut.isPending}
            anyAcceptPending={acceptRideMut.isPending}
            serverTime={requestsServerTime}
            T={T}
          />
        ))}
        {rides.map((r: any) => (
          <RideRequestCard
            key={r.id}
            ride={r}
            userId={user?.id || ""}
            isRestricted={!!user?.isRestricted}
            config={config}
            currency={currency}
            onAccept={(id) => acceptRideMut.mutate(id)}
            onCounter={(id, fare) => counterRideMut.mutate({ id, counterFare: fare })}
            onRejectOffer={(id) => rejectOfferMut.mutate(id)}
            onIgnore={(id) => ignoreRideMut.mutate(id)}
            onDismiss={dismiss}
            acceptPending={acceptRideMut.isPending}
            counterPending={counterRideMut.isPending}
            rejectOfferPending={rejectOfferMut.isPending}
            ignorePending={ignoreRideMut.isPending}
            anyAcceptPending={acceptOrderMut.isPending}
            serverTime={requestsServerTime}
            T={T}
          />
        ))}
      </div>
    );
  };

  /* Count how many top-fixed banners are currently active (28 px each).
     This must mirror the logic in FixedBanners so the header always sits
     below the last visible banner regardless of how many are showing. */
  const BANNER_H_PX = 28;
  const topBannerCount =
    (!socketConnected && effectiveOnline ? 1 : 0) +
    (!!zoneWarning && effectiveOnline ? 1 : 0) +
    (audioLocked && effectiveOnline ? 1 : 0);
  const topBannerOffsetPx = topBannerCount * BANNER_H_PX;

  return (
    <div className="flex flex-col min-h-screen bg-[#F5F6F8] animate-[fadeIn_0.3s_ease-out]">
      <FixedBanners
        socketConnected={socketConnected}
        effectiveOnline={effectiveOnline}
        zoneWarning={zoneWarning}
        onDismissZone={() => setZoneWarning(null)}
        wakeLockWarning={wakeLockWarning}
        onDismissWakeLock={() => setWakeLockWarning(false)}
        audioLocked={audioLocked}
        onUnlockAudio={() => {
          unlockAudio();
          setAudioLocked(false);
        }}
        T={T}
      />

      <header
        className="bg-gradient-to-br from-gray-900 via-gray-900 to-gray-800 text-white px-4 sm:px-6 pb-6 sm:pb-8 rounded-b-[2rem] relative overflow-hidden"
        style={{
          paddingTop: `calc(env(safe-area-inset-top, 0px) + 3.5rem + ${topBannerOffsetPx}px)`,
        }}
      >
        <div className="absolute -top-20 -right-20 w-72 h-72 rounded-full bg-green-500/[0.04]" />
        <div className="absolute bottom-10 -left-16 w-56 h-56 rounded-full bg-white/[0.02]" />
        <div className="absolute top-1/2 right-1/4 w-32 h-32 rounded-full bg-white/[0.015]" />

        <div className="relative max-w-2xl mx-auto">
          <div className="flex items-start justify-between mb-5">
            <div>
              <p className="text-white/40 text-[11px] font-semibold tracking-widest uppercase flex items-center gap-1.5 mb-1">
                <Clock size={11} /> <LiveClock /> · AJKMart Rider
              </p>
              <h1 className={`text-[20px] sm:text-[22px] font-extrabold tracking-tight leading-tight transition-colors ${newFlash ? "text-green-300" : "text-white"}`}>
                {greeting}, {user?.name?.split(" ")[0] || "Rider"} 👋
              </h1>
              {newFlash && (
                <p className="text-green-400 text-[11px] font-bold mt-0.5 animate-pulse flex items-center gap-1">
                  <span className="w-1.5 h-1.5 bg-green-400 rounded-full" />
                  New request available!
                </p>
              )}
            </div>
            <Link href="/wallet" className="flex flex-col items-end flex-shrink-0" aria-label="View wallet balance">
              <div className="bg-white/[0.06] backdrop-blur-sm border border-white/[0.06] rounded-2xl px-3 sm:px-3.5 py-2 text-right">
                <p className="text-white/40 text-[9px] font-bold uppercase tracking-wider">
                  {T("wallet")}
                </p>
                <p className="font-extrabold text-base sm:text-lg leading-tight">
                  {formatCurrency(Number(user?.walletBalance) || 0, currency)}
                </p>
              </div>
            </Link>
          </div>

          <OnlineToggleCard
            effectiveOnline={effectiveOnline}
            toggling={toggling}
            silenceOn={silenceOn}
            onToggleOnline={toggleOnline}
            onToggleSilence={toggleSilence}
            T={T}
          />

          <SilenceControls
            silenced={silenced}
            silenceRemaining={silenceRemaining}
            showSilenceMenu={showSilenceMenu}
            onSetShowSilenceMenu={setShowSilenceMenu}
            onSetSilenced={setSilenced}
            onSetSilenceRemaining={setSilenceRemaining}
            showToast={showToast}
          />

          <StatsGrid
            deliveriesToday={user?.stats?.deliveriesToday || 0}
            earningsToday={user?.stats?.earningsToday || 0}
            weekEarnings={earningsData?.week?.earnings || 0}
            totalDeliveries={user?.stats?.totalDeliveries || 0}
            currency={currency}
          />
        </div>
      </header>

      <main className="px-3 sm:px-4 pt-4 space-y-3 relative z-10 w-full max-w-2xl mx-auto pb-6">
        <InlineWarnings
          gpsWarning={gpsWarning}
          onDismissGps={() => setGpsWarning(null)}
          isRestricted={!!user?.isRestricted}
          riderNotice={config.content.riderNotice}
          riderNoticeDismissed={dismissed.has("rider-notice")}
          onDismissRiderNotice={() => {
            addDismissed("rider-notice");
            setDismissed((prev) => {
              const next = new Set(prev);
              next.add("rider-notice");
              return next;
            });
          }}
          cancelStatsData={cancelStatsData}
          ignoreStatsData={ignoreStatsData}
          currency={currency}
          minBalance={config.rider?.minBalance ?? 0}
          walletBalance={Number(user?.walletBalance) || 0}
        />

        {config.content.trackerBannerEnabled &&
          hasActiveTask &&
          config.content.trackerBannerPosition === "top" && (
            <ActiveTaskBanner activeData={activeData} variant="green" />
          )}

        {user?.isOnline ? (
          <>
            {hasActiveTask && !config.content.trackerBannerEnabled && (
              <ActiveTaskBanner activeData={activeData} variant="amber" />
            )}

            <div
              className={`rounded-3xl shadow-sm overflow-hidden transition-all duration-300 ${newFlash ? "ring-4 ring-green-400 ring-offset-2 ring-offset-[#F5F6F8]" : ""}`}
            >
              <RequestListHeader totalRequests={totalRequests} T={T} />
              {renderRequestList()}
            </div>
          </>
        ) : (
          <div className="bg-white rounded-3xl shadow-sm p-8 sm:p-10 text-center border border-gray-100 animate-[slideUp_0.3s_ease-out]">
            <div className="w-16 h-16 sm:w-20 sm:h-20 bg-gray-50 rounded-3xl flex items-center justify-center mx-auto mb-4">
              <Wifi size={32} className="text-gray-300" />
            </div>
            <p className="text-gray-700 font-extrabold text-base sm:text-lg tracking-tight">You are Offline</p>
            <p className="text-gray-400 text-sm mt-1.5">
              Toggle the switch above to start accepting orders
            </p>
            <button
              onClick={toggleOnline}
              disabled={toggling}
              className="mt-5 bg-gray-900 text-white font-bold text-sm px-6 py-3 rounded-xl shadow-sm hover:bg-gray-800 transition-all active:scale-[0.98] disabled:opacity-60 inline-flex items-center gap-2"
              aria-label="Go online to start accepting orders"
            >
              <Zap size={16} /> Go Online
            </button>
          </div>
        )}

        {config.content.trackerBannerEnabled &&
          hasActiveTask &&
          config.content.trackerBannerPosition === "bottom" && (
            <div className="mt-3">
              <ActiveTaskBanner activeData={activeData} variant="green" />
            </div>
          )}
      </main>

      {toastMsg && (
        <div className="fixed top-6 left-4 right-4 z-[1100] pointer-events-none animate-[slideDown_0.3s_ease-out]">
          <div
            className={`${toastType === "success" ? "bg-green-600" : "bg-red-600"} text-white text-sm font-semibold px-5 py-3.5 rounded-2xl shadow-2xl flex items-center justify-center gap-2 max-w-md mx-auto`}
          >
            {toastType === "success" ? <CheckCircle size={16} /> : <AlertTriangle size={16} />}
            {toastMsg}
          </div>
        </div>
      )}

      {hasActiveTask && !config.content.trackerBannerEnabled && (
        <Link
          href="/active"
          className="fixed bottom-[calc(env(safe-area-inset-bottom,0px)+72px)] left-4 right-4 z-30 block bg-gradient-to-r from-green-500 to-emerald-600 rounded-2xl px-4 py-3 shadow-lg shadow-green-300/40 active:scale-[0.98] transition-transform animate-[slideUp_0.3s_ease-out]"
          aria-label="Go to active task"
        >
          <div className="flex items-center gap-2.5 max-w-md mx-auto">
            <div className="w-2.5 h-2.5 bg-white rounded-full animate-pulse flex-shrink-0" />
            <p className="text-sm font-extrabold text-white flex-1 truncate">
              {T("youHaveActiveTask")}
            </p>
            <ChevronRight size={14} className="text-white/80 flex-shrink-0" />
          </div>
        </Link>
      )}

      {showOfflineConfirm && (
        <OfflineConfirmDialog
          totalRequests={totalRequests}
          onStayOnline={() => setShowOfflineConfirm(false)}
          onGoOffline={async () => {
            setShowOfflineConfirm(false);
            await doActualToggle();
          }}
        />
      )}
    </div>
  );
}
