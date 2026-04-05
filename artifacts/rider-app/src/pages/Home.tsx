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
  isSilenced,
  getSilenceRemaining,
  getSilenceMode,
  setSilenceMode,
} from "../lib/notificationSound";
import { logRideEvent } from "../lib/rideUtils";
import {
  enqueue,
  addDismissed,
  removeDismissed,
  loadDismissed,
  clearAllDismissed,
} from "../lib/gpsQueue";
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

  useEffect(() => {
    loadDismissed().then((ids) => {
      if (ids.size > 0) setDismissed(ids);
    });
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
    const handler = () => unlockAudio();
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

  const { data: requestsData } = useQuery({
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

  useEffect(() => {
    if (!requestsData) return;
    const serverIds = new Set<string>([
      ...allOrders.map((o: any) => o.id),
      ...allRides.map((r: any) => r.id),
    ]);
    setDismissed((prev) => {
      const next = new Set([...prev].filter((id) => serverIds.has(id)));
      if (next.size === prev.size) return prev;
      [...prev].filter((id) => !serverIds.has(id)).forEach((id) => removeDismissed(id));
      return next;
    });
  }, [requestsData]);

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
      playRequestSound();
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
          !document.hidden
        )
          playRequestSound();
      }, 8000);
    }

    prevIdsRef.current = currentIds;
  }, [currentIdsSig]);

  useEffect(() => {
    const handler = () => setTabVisible(!document.hidden);
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, []);

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

  useEffect(() => {
    if (tabVisible) {
      qc.invalidateQueries({ queryKey: ["rider-requests"] });
      qc.invalidateQueries({ queryKey: ["rider-active"] });
    }
  }, [tabVisible]);

  const [gpsWarning, setGpsWarning] = useState<string | null>(null);
  const gpsWarningRef = useRef<string | null>(null);

  const setGpsWarningWithRef = (val: string | null) => {
    gpsWarningRef.current = val;
    setGpsWarning(val);
  };

  const batteryRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (typeof navigator !== "undefined" && "getBattery" in navigator) {
      (navigator as any)
        .getBattery()
        .then((batt: any) => {
          batteryRef.current = Math.round(batt.level * 100);
          batt.addEventListener("levelchange", () => {
            batteryRef.current = Math.round(batt.level * 100);
          });
        })
        .catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (!sharedSocket) return;
    const handleNewRequest = () => {
      qc.invalidateQueries({ queryKey: ["rider-requests"] });
    };
    sharedSocket.on("rider:new-request", handleNewRequest);
    sharedSocket.on("new:request", handleNewRequest);
    return () => {
      sharedSocket.off("rider:new-request", handleNewRequest);
      sharedSocket.off("new:request", handleNewRequest);
    };
  }, [sharedSocket]);

  useEffect(() => {
    if (!user?.isOnline || hasActiveTask || !user?.id) return;
    if (!navigator?.geolocation) return;

    let lastSentTime = 0;
    let lastLat: number | null = null;
    let lastLng: number | null = null;
    const IDLE_INTERVAL_MS = 5 * 1000;
    const MIN_DISTANCE_METERS = 25;

    function haversineMeters(
      lat1: number,
      lon1: number,
      lat2: number,
      lon2: number,
    ): number {
      const R = 6371000;
      const dLat = ((lat2 - lat1) * Math.PI) / 180;
      const dLon = ((lon2 - lon1) * Math.PI) / 180;
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos((lat1 * Math.PI) / 180) *
          Math.cos((lat2 * Math.PI) / 180) *
          Math.sin(dLon / 2) ** 2;
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

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

        const timeSinceLast = now - lastSentTime;
        if (timeSinceLast < 1000) return;
        if (lastLat !== null && lastLng !== null) {
          const dist = haversineMeters(lastLat, lastLng, latitude, longitude);
          if (dist < MIN_DISTANCE_METERS && timeSinceLast < IDLE_INTERVAL_MS) return;
        } else {
          if (timeSinceLast < IDLE_INTERVAL_MS) return;
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
    onError: (e: any) => showToast(e.message || "Counter offer failed", "error"),
  });

  const rejectOfferMut = useMutation({
    mutationFn: (id: string) => api.rejectOffer(id),
    onSuccess: (_: any, id: string) => {
      dismiss(id);
      showToast("Ride skipped.", "success");
    },
    onError: (e: any) => showToast(e.message, "error"),
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
    onError: (e: any) => showToast(e.message || "Ignore failed", "error"),
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

  return (
    <div className="flex flex-col min-h-screen bg-[#F5F6F8] animate-[fadeIn_0.3s_ease-out]">
      {newFlash && (
        <div className="fixed inset-0 z-[1100] pointer-events-none">
          <div className="absolute inset-0 border-[6px] border-green-400 rounded-none animate-ping opacity-50" />
          <div className="absolute top-20 left-1/2 -translate-x-1/2 bg-gray-900 text-white font-extrabold text-sm px-5 py-3 rounded-2xl shadow-2xl flex items-center gap-2.5 animate-bounce">
            <span className="w-2.5 h-2.5 bg-green-400 rounded-full animate-pulse" />
            New Request Available!
          </div>
        </div>
      )}

      <FixedBanners
        socketConnected={socketConnected}
        effectiveOnline={effectiveOnline}
        zoneWarning={zoneWarning}
        onDismissZone={() => setZoneWarning(null)}
        wakeLockWarning={wakeLockWarning}
        onDismissWakeLock={() => setWakeLockWarning(false)}
        T={T}
      />

      <header
        className="bg-gradient-to-br from-gray-900 via-gray-900 to-gray-800 text-white px-5 pb-8 rounded-b-[2rem] relative overflow-hidden"
        style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 3.5rem)" }}
      >
        <div className="absolute -top-20 -right-20 w-72 h-72 rounded-full bg-green-500/[0.04]" />
        <div className="absolute bottom-10 -left-16 w-56 h-56 rounded-full bg-white/[0.02]" />
        <div className="absolute top-1/2 right-1/4 w-32 h-32 rounded-full bg-white/[0.015]" />

        <div className="relative">
          <div className="flex items-start justify-between mb-5">
            <div>
              <p className="text-white/40 text-[11px] font-semibold tracking-widest uppercase flex items-center gap-1.5 mb-1">
                <Clock size={11} /> <LiveClock /> · AJKMart Rider
              </p>
              <h1 className="text-[22px] font-extrabold tracking-tight leading-tight">
                {greeting}, {user?.name?.split(" ")[0] || "Rider"} 👋
              </h1>
            </div>
            <Link href="/wallet" className="flex flex-col items-end" aria-label="View wallet balance">
              <div className="bg-white/[0.06] backdrop-blur-sm border border-white/[0.06] rounded-2xl px-3.5 py-2 text-right">
                <p className="text-white/40 text-[9px] font-bold uppercase tracking-wider">
                  {T("wallet")}
                </p>
                <p className="font-extrabold text-lg leading-tight">
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

      <main className="px-4 pt-4 space-y-3 relative z-10">
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
              className={`rounded-3xl shadow-sm overflow-hidden transition-all ${newFlash ? "ring-4 ring-green-400 ring-offset-2" : ""}`}
            >
              <RequestListHeader totalRequests={totalRequests} T={T} />

              {totalRequests === 0 ? (
                <div className="bg-white p-10 text-center">
                  <div className="w-16 h-16 bg-gray-50 rounded-3xl flex items-center justify-center mx-auto mb-4">
                    <Bike size={32} className="text-gray-300" />
                  </div>
                  <p className="text-gray-600 font-bold text-base">{T("noRequestsNow")}</p>
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
              ) : (
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
                      T={T}
                    />
                  ))}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="bg-white rounded-3xl shadow-sm p-10 text-center border border-gray-100 animate-[slideUp_0.3s_ease-out]">
            <div className="w-20 h-20 bg-gray-50 rounded-3xl flex items-center justify-center mx-auto mb-4">
              <Wifi size={36} className="text-gray-300" />
            </div>
            <p className="text-gray-700 font-extrabold text-lg tracking-tight">You are Offline</p>
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
