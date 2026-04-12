import { useState, useEffect, useCallback } from "react";
import {
  MapPin, Plus, Edit2, Trash2, ChevronRight, ChevronDown,
  Loader2, RefreshCw, Check, X, ToggleLeft, ToggleRight,
  Navigation, Map,
} from "lucide-react";
import { MapPinPicker } from "@/components/MapPinPicker";
import { useToast } from "@/hooks/use-toast";
import { getToken } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

const errMsg = (e: unknown): string =>
  e instanceof Error ? e.message : String(e);

/* Dedicated fetcher for /api/area-locations — NOT under /api/admin prefix.
   All operations (including /tree GET) require the admin token; this helper
   attaches x-admin-token for every request when a token is present. */
const locFetch = async (endpoint: string, options: RequestInit = {}) => {
  const token = getToken();
  const base = `${window.location.origin}/api/area-locations`;
  const res = await fetch(`${base}${endpoint}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { "x-admin-token": token } : {}),
      ...options.headers,
    },
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || "Request failed");
  return json.data !== undefined ? json.data : json;
};

type Level = "city" | "sub_city" | "area" | "mohalla";
const LEVEL_LABELS: Record<Level, string> = {
  city: "City", sub_city: "Sub-city", area: "Area", mohalla: "Mohalla / Main Point",
};
const LEVEL_ORDER: Level[] = ["city", "sub_city", "area", "mohalla"];
const LEVEL_COLORS: Record<Level, string> = {
  city: "bg-blue-100 text-blue-700 border-blue-200",
  sub_city: "bg-indigo-100 text-indigo-700 border-indigo-200",
  area: "bg-violet-100 text-violet-700 border-violet-200",
  mohalla: "bg-purple-100 text-purple-700 border-purple-200",
};

interface LocationNode {
  id: number;
  name: string;
  level: Level;
  parentId: number | null;
  lat: string | null;
  lng: string | null;
  radiusKm: string | null;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  children?: LocationNode[];
}

interface NodeFormState {
  name: string;
  lat: string;
  lng: string;
  radiusKm: string;
  isActive: boolean;
  sortOrder: string;
}

const emptyForm = (): NodeFormState => ({
  name: "", lat: "", lng: "", radiusKm: "5", isActive: true, sortOrder: "0",
});

function NodeForm({
  form,
  onChange,
  onSave,
  onCancel,
  saving,
  level,
}: {
  form: NodeFormState;
  onChange: (f: NodeFormState) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  level: Level;
}) {
  return (
    <div className="border border-border rounded-xl p-4 bg-muted/20 space-y-3 mt-2">
      <div className="flex items-center gap-2 mb-1">
        <Badge variant="outline" className={`text-xs ${LEVEL_COLORS[level]}`}>{LEVEL_LABELS[level]}</Badge>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Name *</label>
          <Input value={form.name} onChange={e => onChange({ ...form, name: e.target.value })} placeholder={`${LEVEL_LABELS[level]} name`} className="h-9 text-sm" />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Radius (km)</label>
          <Input type="number" min="0.5" step="0.5" value={form.radiusKm} onChange={e => onChange({ ...form, radiusKm: e.target.value })} className="h-9 text-sm" />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Latitude</label>
          <Input type="number" step="any" value={form.lat} onChange={e => onChange({ ...form, lat: e.target.value })} placeholder="e.g. 33.8573" className="h-9 text-sm" />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Longitude</label>
          <Input type="number" step="any" value={form.lng} onChange={e => onChange({ ...form, lng: e.target.value })} placeholder="e.g. 73.7643" className="h-9 text-sm" />
        </div>
      </div>

      <MapPinPicker
        lat={form.lat ? parseFloat(form.lat) : null}
        lng={form.lng ? parseFloat(form.lng) : null}
        radiusKm={form.radiusKm ? parseFloat(form.radiusKm) : 5}
        onChange={(lat, lng) => onChange({ ...form, lat: String(lat.toFixed(6)), lng: String(lng.toFixed(6)) })}
      />

      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
          <button
            type="button"
            onClick={() => onChange({ ...form, isActive: !form.isActive })}
            className={`w-9 h-5 rounded-full transition-colors flex items-center px-0.5 ${form.isActive ? "bg-green-500" : "bg-border"}`}
          >
            <span className={`w-4 h-4 rounded-full bg-white shadow transition-transform ${form.isActive ? "translate-x-4" : "translate-x-0"}`} />
          </button>
          <span className={form.isActive ? "text-green-700 font-medium" : "text-muted-foreground"}>
            {form.isActive ? "Active" : "Inactive"}
          </span>
        </label>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" onClick={onCancel} className="h-8 gap-1.5 text-xs">
            <X className="w-3.5 h-3.5" /> Cancel
          </Button>
          <Button size="sm" onClick={onSave} disabled={saving || !form.name.trim()} className="h-8 gap-1.5 text-xs">
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}

function LocationNodeRow({
  node,
  depth,
  onRefresh,
}: {
  node: LocationNode;
  depth: number;
  onRefresh: () => void;
}) {
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(depth < 1);
  const [addingChild, setAddingChild] = useState(false);
  const [editing, setEditing] = useState(false);
  const [childForm, setChildForm] = useState<NodeFormState>(emptyForm());
  const [editForm, setEditForm] = useState<NodeFormState>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [toggling, setToggling] = useState(false);

  const nextLevel = LEVEL_ORDER[LEVEL_ORDER.indexOf(node.level) + 1] as Level | undefined;
  const hasChildren = (node.children?.length ?? 0) > 0;
  const indent = depth * 20;

  const startEdit = () => {
    setEditForm({
      name: node.name,
      lat: node.lat ?? "",
      lng: node.lng ?? "",
      radiusKm: node.radiusKm ?? "5",
      isActive: node.isActive,
      sortOrder: String(node.sortOrder),
    });
    setEditing(true);
    setAddingChild(false);
  };

  const saveEdit = async () => {
    if (!editForm.name.trim()) { toast({ title: "Name is required", variant: "destructive" }); return; }
    setSaving(true);
    try {
      await locFetch(`/${node.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: editForm.name.trim(),
          lat: editForm.lat ? parseFloat(editForm.lat) : null,
          lng: editForm.lng ? parseFloat(editForm.lng) : null,
          radiusKm: editForm.radiusKm ? parseFloat(editForm.radiusKm) : null,
          isActive: editForm.isActive,
          sortOrder: parseInt(editForm.sortOrder || "0", 10),
        }),
      });
      toast({ title: "Location updated" });
      setEditing(false);
      onRefresh();
    } catch (e: unknown) {
      toast({ title: "Save failed", description: errMsg(e), variant: "destructive" });
    }
    setSaving(false);
  };

  const addChild = async () => {
    if (!nextLevel) return;
    if (!childForm.name.trim()) { toast({ title: "Name is required", variant: "destructive" }); return; }
    setSaving(true);
    try {
      await locFetch("", {
        method: "POST",
        body: JSON.stringify({
          name: childForm.name.trim(),
          level: nextLevel,
          parentId: node.id,
          lat: childForm.lat ? parseFloat(childForm.lat) : null,
          lng: childForm.lng ? parseFloat(childForm.lng) : null,
          radiusKm: childForm.radiusKm ? parseFloat(childForm.radiusKm) : null,
          isActive: childForm.isActive,
          sortOrder: parseInt(childForm.sortOrder || "0", 10),
        }),
      });
      toast({ title: `${LEVEL_LABELS[nextLevel]} added` });
      setAddingChild(false);
      setChildForm(emptyForm());
      setExpanded(true);
      onRefresh();
    } catch (e: unknown) {
      toast({ title: "Failed to add", description: errMsg(e), variant: "destructive" });
    }
    setSaving(false);
  };

  const toggleActive = async () => {
    setToggling(true);
    try {
      await locFetch(`/${node.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: !node.isActive }),
      });
      onRefresh();
    } catch (e: unknown) {
      toast({ title: "Toggle failed", description: errMsg(e), variant: "destructive" });
    }
    setToggling(false);
  };

  const deleteNode = async () => {
    setDeleting(true);
    try {
      await locFetch(`/${node.id}`, { method: "DELETE" });
      toast({ title: "Location deleted" });
      setConfirmDelete(false);
      onRefresh();
    } catch (e: unknown) {
      toast({ title: "Delete failed", description: errMsg(e), variant: "destructive" });
      setConfirmDelete(false);
    }
    setDeleting(false);
  };

  return (
    <div>
      <div
        className={`flex items-center gap-2 py-2 px-3 rounded-xl hover:bg-muted/40 transition-colors group ${!node.isActive ? "opacity-60" : ""}`}
        style={{ paddingLeft: `${indent + 12}px` }}
      >
        {/* Expand/Collapse */}
        <button
          onClick={() => setExpanded(v => !v)}
          className={`w-5 h-5 flex items-center justify-center rounded flex-shrink-0 ${hasChildren || nextLevel ? "hover:bg-border" : "opacity-0 pointer-events-none"}`}
        >
          {hasChildren ? (
            expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />
          ) : (
            nextLevel ? <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/40" /> : null
          )}
        </button>

        {/* Level badge */}
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${LEVEL_COLORS[node.level]} flex-shrink-0`}>
          {LEVEL_LABELS[node.level].split(" ")[0]}
        </span>

        {/* Name */}
        <span className="flex-1 text-sm font-medium text-foreground truncate">{node.name}</span>

        {/* Coords */}
        {node.lat && node.lng && (
          <span className="hidden sm:flex items-center gap-1 text-[10px] text-muted-foreground">
            <Navigation className="w-2.5 h-2.5" />
            {parseFloat(node.lat).toFixed(4)}, {parseFloat(node.lng).toFixed(4)}
          </span>
        )}

        {/* Radius */}
        {node.radiusKm && (
          <span className="hidden md:block text-[10px] text-muted-foreground">{parseFloat(node.radiusKm).toFixed(1)} km</span>
        )}

        {/* Status */}
        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${node.isActive ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600"}`}>
          {node.isActive ? "Active" : "Off"}
        </span>

        {/* Actions */}
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {nextLevel && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => { setAddingChild(v => !v); setEditing(false); setExpanded(true); setChildForm(emptyForm()); }}
              title={`Add ${LEVEL_LABELS[nextLevel]}`}
              className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
            >
              <Plus className="w-3.5 h-3.5" />
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={startEdit}
            title="Edit"
            className="h-7 w-7 p-0 text-muted-foreground hover:text-blue-600"
          >
            <Edit2 className="w-3.5 h-3.5" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={toggleActive}
            disabled={toggling}
            title={node.isActive ? "Deactivate" : "Activate"}
            className="h-7 w-7 p-0 text-muted-foreground hover:text-amber-600"
          >
            {toggling ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : (node.isActive ? <ToggleRight className="w-3.5 h-3.5" /> : <ToggleLeft className="w-3.5 h-3.5" />)}
          </Button>
          {!confirmDelete ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setConfirmDelete(true)}
              title="Delete"
              className="h-7 w-7 p-0 text-muted-foreground hover:text-red-600"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          ) : (
            <div className="flex items-center gap-1 bg-red-50 border border-red-200 rounded-lg px-1.5 py-0.5">
              <span className="text-[10px] text-red-700 font-medium">Delete?</span>
              <button onClick={deleteNode} disabled={deleting} className="text-red-700 hover:text-red-900 text-[10px] font-bold">
                {deleting ? "..." : "Yes"}
              </button>
              <button onClick={() => setConfirmDelete(false)} className="text-muted-foreground hover:text-foreground text-[10px]">No</button>
            </div>
          )}
        </div>
      </div>

      {/* Edit form */}
      {editing && (
        <div style={{ paddingLeft: `${indent + 28}px`, paddingRight: 12 }}>
          <NodeForm
            form={editForm}
            onChange={setEditForm}
            onSave={saveEdit}
            onCancel={() => setEditing(false)}
            saving={saving}
            level={node.level}
          />
        </div>
      )}

      {/* Add child form */}
      {addingChild && nextLevel && (
        <div style={{ paddingLeft: `${indent + 28}px`, paddingRight: 12 }}>
          <NodeForm
            form={childForm}
            onChange={setChildForm}
            onSave={addChild}
            onCancel={() => { setAddingChild(false); setChildForm(emptyForm()); }}
            saving={saving}
            level={nextLevel}
          />
        </div>
      )}

      {/* Children */}
      {expanded && node.children && node.children.map(child => (
        <LocationNodeRow key={child.id} node={child} depth={depth + 1} onRefresh={onRefresh} />
      ))}
    </div>
  );
}

export default function LocationsPage() {
  const { toast } = useToast();
  const [tree, setTree] = useState<LocationNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [addingCity, setAddingCity] = useState(false);
  const [cityForm, setCityForm] = useState<NodeFormState>(emptyForm());
  const [saving, setSaving] = useState(false);

  const loadTree = useCallback(async () => {
    setLoading(true);
    try {
      const data = await locFetch("/tree");
      setTree(Array.isArray(data) ? data : []);
    } catch (e: unknown) {
      toast({ title: "Failed to load locations", description: errMsg(e), variant: "destructive" });
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadTree(); }, [loadTree]);

  const addCity = async () => {
    if (!cityForm.name.trim()) { toast({ title: "Name is required", variant: "destructive" }); return; }
    setSaving(true);
    try {
      await locFetch("", {
        method: "POST",
        body: JSON.stringify({
          name: cityForm.name.trim(),
          level: "city",
          parentId: null,
          lat: cityForm.lat ? parseFloat(cityForm.lat) : null,
          lng: cityForm.lng ? parseFloat(cityForm.lng) : null,
          radiusKm: cityForm.radiusKm ? parseFloat(cityForm.radiusKm) : null,
          isActive: cityForm.isActive,
          sortOrder: parseInt(cityForm.sortOrder || "0", 10),
        }),
      });
      toast({ title: "City added" });
      setAddingCity(false);
      setCityForm(emptyForm());
      loadTree();
    } catch (e: unknown) {
      toast({ title: "Failed to add city", description: errMsg(e), variant: "destructive" });
    }
    setSaving(false);
  };

  const stats = {
    total: 0,
    active: 0,
    cities: 0,
    subCities: 0,
    areas: 0,
    mohallaas: 0,
  };
  const countNodes = (nodes: LocationNode[]) => {
    for (const n of nodes) {
      stats.total++;
      if (n.isActive) stats.active++;
      if (n.level === "city") stats.cities++;
      else if (n.level === "sub_city") stats.subCities++;
      else if (n.level === "area") stats.areas++;
      else if (n.level === "mohalla") stats.mohallaas++;
      if (n.children) countNodes(n.children);
    }
  };
  countNodes(tree);

  return (
    <div className="space-y-4 max-w-5xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center">
            <MapPin className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">Location Hierarchy</h1>
            <p className="text-sm text-muted-foreground">City → Sub-city → Area → Mohalla</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={loadTree} disabled={loading} className="h-9 gap-2 rounded-xl">
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
          <Button size="sm" onClick={() => { setAddingCity(v => !v); setCityForm(emptyForm()); }} className="h-9 gap-2 rounded-xl">
            <Plus className="w-4 h-4" /> Add City
          </Button>
        </div>
      </div>

      {/* Stats */}
      {!loading && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Cities", count: stats.cities, color: "text-blue-700", bg: "bg-blue-50" },
            { label: "Sub-cities", count: stats.subCities, color: "text-indigo-700", bg: "bg-indigo-50" },
            { label: "Areas", count: stats.areas, color: "text-violet-700", bg: "bg-violet-50" },
            { label: "Mohallaas", count: stats.mohallaas, color: "text-purple-700", bg: "bg-purple-50" },
          ].map(({ label, count, color, bg }) => (
            <Card key={label} className={`${bg} border-0 p-3 flex items-center gap-3`}>
              <div>
                <p className={`text-xl font-bold ${color}`}>{count}</p>
                <p className="text-xs text-muted-foreground">{label}</p>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Add city form */}
      {addingCity && (
        <Card className="p-4">
          <h3 className="text-sm font-semibold mb-3">Add New City</h3>
          <NodeForm
            form={cityForm}
            onChange={setCityForm}
            onSave={addCity}
            onCancel={() => { setAddingCity(false); setCityForm(emptyForm()); }}
            saving={saving}
            level="city"
          />
        </Card>
      )}

      {/* Tree */}
      <Card className="p-2">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : tree.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <MapPin className="w-10 h-10 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">No locations yet. Add a city to get started.</p>
          </div>
        ) : (
          <div className="space-y-0.5">
            {tree.map(city => (
              <LocationNodeRow key={city.id} node={city} depth={0} onRefresh={loadTree} />
            ))}
          </div>
        )}
      </Card>

      {/* Legend */}
      <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
        <span className="font-medium">Legend:</span>
        {LEVEL_ORDER.map(l => (
          <span key={l} className={`px-2 py-0.5 rounded border ${LEVEL_COLORS[l]}`}>{LEVEL_LABELS[l]}</span>
        ))}
        <span className="ml-2">— Hover a row to see actions</span>
      </div>
    </div>
  );
}
