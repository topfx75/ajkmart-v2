import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Bus, Plus, Pencil, Trash2, RefreshCw, Users, Route, Clock, Calendar,
} from "lucide-react";

/* ── API helpers ── */
const getToken = () => localStorage.getItem("ajkmart_admin_token");
const apiBase = () => `${window.location.origin}/api/van`;

async function vanFetch(path: string, opts: RequestInit = {}) {
  const token = getToken();
  const res = await fetch(`${apiBase()}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { "x-admin-token": token } : {}),
      ...opts.headers,
    },
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || "Request failed");
  return json.data !== undefined ? json.data : json;
}

/* ══════════════════════════════════════════════════════════
   TYPES
══════════════════════════════════════════════════════════ */
interface VanRoute { id: string; name: string; nameUrdu?: string; fromAddress: string; toAddress: string; farePerSeat: string; distanceKm?: string; durationMin?: number; isActive: boolean; sortOrder: number; notes?: string; }
interface VanVehicle { id: string; plateNumber: string; model: string; totalSeats: number; isActive: boolean; driverId?: string; driverName?: string; driverPhone?: string; }
interface VanSchedule { id: string; routeId: string; vehicleId?: string; driverId?: string; departureTime: string; returnTime?: string; daysOfWeek: number[]; isActive: boolean; routeName?: string; vehiclePlate?: string; driverName?: string; }
interface VanBooking { id: string; userId: string; scheduleId: string; seatNumbers: number[]; travelDate: string; status: string; fare: string; paymentMethod: string; passengerName?: string; createdAt: string; routeName?: string; routeFrom?: string; routeTo?: string; departureTime?: string; userName?: string; userPhone?: string; }

const DAY_LABELS = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const STATUS_COLORS: Record<string, string> = {
  confirmed: "bg-blue-100 text-blue-800",
  boarded: "bg-yellow-100 text-yellow-800",
  completed: "bg-green-100 text-green-800",
  cancelled: "bg-red-100 text-red-800",
};

/* ══════════════════════════════════════════════════════════
   ROUTES TAB
══════════════════════════════════════════════════════════ */
function RoutesTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [editRoute, setEditRoute] = useState<VanRoute | null>(null);
  const [newRouteOpen, setNewRouteOpen] = useState(false);
  const [form, setForm] = useState({ name: "", fromAddress: "", toAddress: "", farePerSeat: "", distanceKm: "", durationMin: "", notes: "" });

  const { data: routes = [], isLoading } = useQuery<VanRoute[]>({
    queryKey: ["van-admin-routes"],
    queryFn: () => vanFetch("/admin/routes"),
  });

  const saveMut = useMutation({
    mutationFn: (data: Partial<typeof form> & { id?: string }) => {
      const { id, ...body } = data;
      const payload = {
        name: body.name, fromAddress: body.fromAddress, toAddress: body.toAddress,
        farePerSeat: parseFloat(body.farePerSeat || "0"),
        ...(body.distanceKm ? { distanceKm: parseFloat(body.distanceKm) } : {}),
        ...(body.durationMin ? { durationMin: parseInt(body.durationMin) } : {}),
        ...(body.notes ? { notes: body.notes } : {}),
      };
      return id ? vanFetch(`/admin/routes/${id}`, { method: "PATCH", body: JSON.stringify(payload) })
        : vanFetch("/admin/routes", { method: "POST", body: JSON.stringify(payload) });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["van-admin-routes"] }); setEditRoute(null); setNewRouteOpen(false); toast({ title: "Route saved" }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => vanFetch(`/admin/routes/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["van-admin-routes"] }); toast({ title: "Route deactivated" }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  function openNew() { setForm({ name: "", fromAddress: "", toAddress: "", farePerSeat: "", distanceKm: "", durationMin: "", notes: "" }); setNewRouteOpen(true); }
  function openEdit(r: VanRoute) { setEditRoute(r); setForm({ name: r.name, fromAddress: r.fromAddress, toAddress: r.toAddress, farePerSeat: String(r.farePerSeat), distanceKm: r.distanceKm || "", durationMin: r.durationMin ? String(r.durationMin) : "", notes: r.notes || "" }); }

  const RouteFormDialog = ({ open, onClose, id }: { open: boolean; onClose: () => void; id?: string }) => (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{id ? "Edit Route" : "New Route"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Input placeholder="Route name (e.g. Rawalpindi → Islamabad)" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          <Input placeholder="From address" value={form.fromAddress} onChange={e => setForm(f => ({ ...f, fromAddress: e.target.value }))} />
          <Input placeholder="To address" value={form.toAddress} onChange={e => setForm(f => ({ ...f, toAddress: e.target.value }))} />
          <div className="grid grid-cols-3 gap-2">
            <Input placeholder="Fare/seat (Rs)" type="number" value={form.farePerSeat} onChange={e => setForm(f => ({ ...f, farePerSeat: e.target.value }))} />
            <Input placeholder="Distance km" type="number" value={form.distanceKm} onChange={e => setForm(f => ({ ...f, distanceKm: e.target.value }))} />
            <Input placeholder="Duration min" type="number" value={form.durationMin} onChange={e => setForm(f => ({ ...f, durationMin: e.target.value }))} />
          </div>
          <Input placeholder="Notes (optional)" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => saveMut.mutate({ ...form, ...(id ? { id } : {}) })} disabled={saveMut.isPending}>
            {saveMut.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm text-muted-foreground">{routes.length} route{routes.length !== 1 ? "s" : ""}</span>
        <Button size="sm" onClick={openNew}><Plus className="w-4 h-4 mr-1" />New Route</Button>
      </div>
      {isLoading ? <div className="text-center py-8 text-muted-foreground">Loading…</div> : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Route</TableHead>
              <TableHead>From → To</TableHead>
              <TableHead>Fare/Seat</TableHead>
              <TableHead>Distance</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {routes.map(r => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.name}</TableCell>
                <TableCell className="text-sm">{r.fromAddress} → {r.toAddress}</TableCell>
                <TableCell className="font-semibold text-green-700">Rs {parseFloat(r.farePerSeat).toFixed(0)}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{r.distanceKm ? `${r.distanceKm} km` : "—"}</TableCell>
                <TableCell><Badge variant={r.isActive ? "default" : "secondary"}>{r.isActive ? "Active" : "Inactive"}</Badge></TableCell>
                <TableCell className="text-right space-x-1">
                  <Button size="icon" variant="ghost" onClick={() => openEdit(r)}><Pencil className="w-4 h-4" /></Button>
                  <Button size="icon" variant="ghost" className="text-red-500 hover:text-red-700" onClick={() => { if (confirm("Deactivate this route?")) deleteMut.mutate(r.id); }}><Trash2 className="w-4 h-4" /></Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <RouteFormDialog open={newRouteOpen} onClose={() => setNewRouteOpen(false)} />
      {editRoute && <RouteFormDialog open={!!editRoute} onClose={() => setEditRoute(null)} id={editRoute.id} />}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   VEHICLES TAB
══════════════════════════════════════════════════════════ */
function VehiclesTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [editVehicle, setEditVehicle] = useState<VanVehicle | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [form, setForm] = useState({ plateNumber: "", model: "Suzuki Carry", totalSeats: "12", driverId: "" });

  const { data: vehicles = [], isLoading } = useQuery<VanVehicle[]>({
    queryKey: ["van-admin-vehicles"],
    queryFn: () => vanFetch("/admin/vehicles"),
  });

  const saveMut = useMutation({
    mutationFn: (data: typeof form & { id?: string }) => {
      const { id, ...body } = data;
      const payload = { plateNumber: body.plateNumber, model: body.model, totalSeats: parseInt(body.totalSeats), driverId: body.driverId || null };
      return id ? vanFetch(`/admin/vehicles/${id}`, { method: "PATCH", body: JSON.stringify(payload) })
        : vanFetch("/admin/vehicles", { method: "POST", body: JSON.stringify(payload) });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["van-admin-vehicles"] }); setEditVehicle(null); setNewOpen(false); toast({ title: "Vehicle saved" }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  function openNew() { setForm({ plateNumber: "", model: "Suzuki Carry", totalSeats: "12", driverId: "" }); setNewOpen(true); }
  function openEdit(v: VanVehicle) { setEditVehicle(v); setForm({ plateNumber: v.plateNumber, model: v.model, totalSeats: String(v.totalSeats), driverId: v.driverId || "" }); }

  const VehicleFormDialog = ({ open, onClose, id }: { open: boolean; onClose: () => void; id?: string }) => (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{id ? "Edit Vehicle" : "New Vehicle"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Input placeholder="Plate number (e.g. LHR-1234)" value={form.plateNumber} onChange={e => setForm(f => ({ ...f, plateNumber: e.target.value }))} />
          <Input placeholder="Model (e.g. Suzuki Carry)" value={form.model} onChange={e => setForm(f => ({ ...f, model: e.target.value }))} />
          <Input placeholder="Total seats" type="number" value={form.totalSeats} onChange={e => setForm(f => ({ ...f, totalSeats: e.target.value }))} />
          <Input placeholder="Driver user ID (optional)" value={form.driverId} onChange={e => setForm(f => ({ ...f, driverId: e.target.value }))} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => saveMut.mutate({ ...form, ...(id ? { id } : {}) })} disabled={saveMut.isPending}>
            {saveMut.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm text-muted-foreground">{vehicles.length} vehicle{vehicles.length !== 1 ? "s" : ""}</span>
        <Button size="sm" onClick={openNew}><Plus className="w-4 h-4 mr-1" />New Vehicle</Button>
      </div>
      {isLoading ? <div className="text-center py-8 text-muted-foreground">Loading…</div> : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Plate</TableHead>
              <TableHead>Model</TableHead>
              <TableHead>Seats</TableHead>
              <TableHead>Driver</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {vehicles.map(v => (
              <TableRow key={v.id}>
                <TableCell className="font-mono font-semibold">{v.plateNumber}</TableCell>
                <TableCell>{v.model}</TableCell>
                <TableCell>{v.totalSeats}</TableCell>
                <TableCell className="text-sm">{v.driverName || <span className="text-muted-foreground">Unassigned</span>}</TableCell>
                <TableCell><Badge variant={v.isActive ? "default" : "secondary"}>{v.isActive ? "Active" : "Inactive"}</Badge></TableCell>
                <TableCell className="text-right">
                  <Button size="icon" variant="ghost" onClick={() => openEdit(v)}><Pencil className="w-4 h-4" /></Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <VehicleFormDialog open={newOpen} onClose={() => setNewOpen(false)} />
      {editVehicle && <VehicleFormDialog open={!!editVehicle} onClose={() => setEditVehicle(null)} id={editVehicle.id} />}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   SCHEDULES TAB
══════════════════════════════════════════════════════════ */
function SchedulesTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [newOpen, setNewOpen] = useState(false);
  const [form, setForm] = useState({ routeId: "", vehicleId: "", driverId: "", departureTime: "07:00", returnTime: "", daysOfWeek: [1,2,3,4,5,6] });

  const { data: schedules = [], isLoading } = useQuery<VanSchedule[]>({
    queryKey: ["van-admin-schedules"],
    queryFn: () => vanFetch("/admin/schedules"),
  });
  const { data: routes = [] } = useQuery<VanRoute[]>({
    queryKey: ["van-admin-routes"],
    queryFn: () => vanFetch("/admin/routes"),
  });
  const { data: vehicles = [] } = useQuery<VanVehicle[]>({
    queryKey: ["van-admin-vehicles"],
    queryFn: () => vanFetch("/admin/vehicles"),
  });

  const saveMut = useMutation({
    mutationFn: () => vanFetch("/admin/schedules", {
      method: "POST",
      body: JSON.stringify({
        routeId: form.routeId, vehicleId: form.vehicleId || null, driverId: form.driverId || null,
        departureTime: form.departureTime, returnTime: form.returnTime || null, daysOfWeek: form.daysOfWeek,
      }),
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["van-admin-schedules"] }); setNewOpen(false); toast({ title: "Schedule created" }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => vanFetch(`/admin/schedules/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["van-admin-schedules"] }); toast({ title: "Schedule deactivated" }); },
  });

  const toggleDay = (d: number) => setForm(f => ({ ...f, daysOfWeek: f.daysOfWeek.includes(d) ? f.daysOfWeek.filter(x => x !== d) : [...f.daysOfWeek, d].sort() }));

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm text-muted-foreground">{schedules.length} schedule{schedules.length !== 1 ? "s" : ""}</span>
        <Button size="sm" onClick={() => setNewOpen(true)}><Plus className="w-4 h-4 mr-1" />New Schedule</Button>
      </div>
      {isLoading ? <div className="text-center py-8 text-muted-foreground">Loading…</div> : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Route</TableHead>
              <TableHead>Departure</TableHead>
              <TableHead>Return</TableHead>
              <TableHead>Days</TableHead>
              <TableHead>Vehicle</TableHead>
              <TableHead>Driver</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {schedules.map(s => (
              <TableRow key={s.id}>
                <TableCell className="font-medium text-sm">{s.routeName || s.routeId}</TableCell>
                <TableCell><span className="font-mono">{s.departureTime}</span></TableCell>
                <TableCell><span className="font-mono text-muted-foreground">{s.returnTime || "—"}</span></TableCell>
                <TableCell>
                  <div className="flex gap-0.5 flex-wrap">
                    {(Array.isArray(s.daysOfWeek) ? s.daysOfWeek as number[] : []).map(d => (
                      <span key={d} className="text-[10px] bg-indigo-100 text-indigo-700 rounded px-1 font-bold">{DAY_LABELS[d]}</span>
                    ))}
                  </div>
                </TableCell>
                <TableCell className="text-sm">{s.vehiclePlate || "—"}</TableCell>
                <TableCell className="text-sm">{s.driverName || "—"}</TableCell>
                <TableCell><Badge variant={s.isActive ? "default" : "secondary"}>{s.isActive ? "Active" : "Inactive"}</Badge></TableCell>
                <TableCell className="text-right">
                  <Button size="icon" variant="ghost" className="text-red-500 hover:text-red-700" onClick={() => { if (confirm("Deactivate this schedule?")) deleteMut.mutate(s.id); }}><Trash2 className="w-4 h-4" /></Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>New Schedule</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Select value={form.routeId} onValueChange={v => setForm(f => ({ ...f, routeId: v }))}>
              <SelectTrigger><SelectValue placeholder="Select route" /></SelectTrigger>
              <SelectContent>{routes.filter(r => r.isActive).map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={form.vehicleId} onValueChange={v => setForm(f => ({ ...f, vehicleId: v }))}>
              <SelectTrigger><SelectValue placeholder="Select vehicle (optional)" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="">No vehicle</SelectItem>
                {vehicles.filter(v => v.isActive).map(v => <SelectItem key={v.id} value={v.id}>{v.plateNumber} – {v.model}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input placeholder="Driver user ID (optional)" value={form.driverId} onChange={e => setForm(f => ({ ...f, driverId: e.target.value }))} />
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Departure time</label>
                <Input type="time" value={form.departureTime} onChange={e => setForm(f => ({ ...f, departureTime: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Return time (optional)</label>
                <Input type="time" value={form.returnTime} onChange={e => setForm(f => ({ ...f, returnTime: e.target.value }))} />
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-2 block">Days of operation</label>
              <div className="flex gap-1 flex-wrap">
                {[1,2,3,4,5,6,7].map(d => (
                  <button key={d} type="button"
                    className={`px-2.5 py-1 rounded text-xs font-bold border transition-colors ${form.daysOfWeek.includes(d) ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-gray-600 border-gray-300"}`}
                    onClick={() => toggleDay(d)}>{DAY_LABELS[d]}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewOpen(false)}>Cancel</Button>
            <Button onClick={() => saveMut.mutate()} disabled={!form.routeId || saveMut.isPending}>
              {saveMut.isPending ? "Saving…" : "Create Schedule"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   BOOKINGS TAB
══════════════════════════════════════════════════════════ */
function BookingsTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [dateFilter, setDateFilter] = useState(new Date().toISOString().split("T")[0]!);
  const [statusFilter, setStatusFilter] = useState("all");

  const { data: bookings = [], isLoading, refetch } = useQuery<VanBooking[]>({
    queryKey: ["van-admin-bookings", dateFilter, statusFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (dateFilter) params.set("date", dateFilter);
      if (statusFilter && statusFilter !== "all") params.set("status", statusFilter);
      return vanFetch(`/admin/bookings?${params.toString()}`);
    },
  });

  const statusMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      vanFetch(`/admin/bookings/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["van-admin-bookings"] }); toast({ title: "Status updated" }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const totalRevenue = bookings.filter(b => b.status !== "cancelled").reduce((s, b) => s + parseFloat(b.fare), 0);

  return (
    <div>
      <div className="flex flex-wrap gap-3 items-center mb-4">
        <Input type="date" className="w-40" value={dateFilter} onChange={e => setDateFilter(e.target.value)} />
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="confirmed">Confirmed</SelectItem>
            <SelectItem value="boarded">Boarded</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={() => refetch()}><RefreshCw className="w-4 h-4" /></Button>
        <div className="ml-auto text-sm text-muted-foreground">
          {bookings.length} booking{bookings.length !== 1 ? "s" : ""} · Revenue: <span className="font-semibold text-green-700">Rs {totalRevenue.toFixed(0)}</span>
        </div>
      </div>
      {isLoading ? <div className="text-center py-8 text-muted-foreground">Loading…</div> : bookings.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">No bookings found for selected filters.</div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Passenger</TableHead>
              <TableHead>Route</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Time</TableHead>
              <TableHead>Seats</TableHead>
              <TableHead>Fare</TableHead>
              <TableHead>Payment</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {bookings.map(b => (
              <TableRow key={b.id}>
                <TableCell>
                  <div className="font-medium text-sm">{b.passengerName || b.userName || "—"}</div>
                  <div className="text-xs text-muted-foreground">{b.userPhone || ""}</div>
                </TableCell>
                <TableCell className="text-sm">{b.routeName || "—"}</TableCell>
                <TableCell className="text-sm font-mono">{b.travelDate}</TableCell>
                <TableCell className="text-sm font-mono">{b.departureTime || "—"}</TableCell>
                <TableCell>
                  <div className="flex gap-1 flex-wrap">
                    {(Array.isArray(b.seatNumbers) ? b.seatNumbers as number[] : []).map(s => (
                      <span key={s} className="bg-indigo-100 text-indigo-800 text-xs font-bold rounded px-1.5 py-0.5">{s}</span>
                    ))}
                  </div>
                </TableCell>
                <TableCell className="font-semibold text-green-700">Rs {parseFloat(b.fare).toFixed(0)}</TableCell>
                <TableCell><Badge variant="outline">{b.paymentMethod}</Badge></TableCell>
                <TableCell><span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${STATUS_COLORS[b.status] || "bg-gray-100 text-gray-700"}`}>{b.status}</span></TableCell>
                <TableCell className="text-right">
                  <Select onValueChange={v => statusMut.mutate({ id: b.id, status: v })}>
                    <SelectTrigger className="h-7 w-28 text-xs"><SelectValue placeholder="Set status" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="confirmed">Confirmed</SelectItem>
                      <SelectItem value="boarded">Boarded</SelectItem>
                      <SelectItem value="completed">Completed</SelectItem>
                      <SelectItem value="cancelled">Cancelled</SelectItem>
                    </SelectContent>
                  </Select>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   MAIN PAGE
══════════════════════════════════════════════════════════ */
export default function VanServicePage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center">
          <Bus className="w-5 h-5 text-indigo-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Van Service Management</h1>
          <p className="text-sm text-muted-foreground">Manage commercial van routes, schedules, vehicles and seat bookings</p>
        </div>
      </div>

      <Tabs defaultValue="routes">
        <TabsList className="mb-2">
          <TabsTrigger value="routes"><Route className="w-4 h-4 mr-1.5" />Routes</TabsTrigger>
          <TabsTrigger value="schedules"><Clock className="w-4 h-4 mr-1.5" />Schedules</TabsTrigger>
          <TabsTrigger value="vehicles"><Bus className="w-4 h-4 mr-1.5" />Vehicles</TabsTrigger>
          <TabsTrigger value="bookings"><Calendar className="w-4 h-4 mr-1.5" />Bookings</TabsTrigger>
        </TabsList>
        <TabsContent value="routes"><RoutesTab /></TabsContent>
        <TabsContent value="schedules"><SchedulesTab /></TabsContent>
        <TabsContent value="vehicles"><VehiclesTab /></TabsContent>
        <TabsContent value="bookings"><BookingsTab /></TabsContent>
      </Tabs>
    </div>
  );
}
