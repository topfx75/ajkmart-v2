import { useState } from "react";
import { PackageSearch, Plus, Search, Edit, Trash2, ToggleLeft, ToggleRight, Download, Filter } from "lucide-react";
import { useProducts, useCreateProduct, useUpdateProduct, useDeleteProduct } from "@/hooks/use-admin";
import { formatCurrency } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useLanguage } from "@/lib/useLanguage";
import { tDual, type TranslationKey } from "@workspace/i18n";

const EMPTY_FORM = {
  name: "", description: "", price: "", originalPrice: "",
  category: "", type: "mart", unit: "", vendorName: "",
  inStock: true, deliveryTime: "30-45 min"
};

export default function Products() {
  const { language } = useLanguage();
  const T = (key: TranslationKey) => tDual(key, language);
  const { data, isLoading } = useProducts();
  const createMutation = useCreateProduct();
  const updateMutation = useUpdateProduct();
  const deleteMutation = useDeleteProduct();
  const { toast } = useToast();

  const [search, setSearch]         = useState("");
  const [typeFilter, setTypeFilter]   = useState("all");
  const [vendorFilter, setVendorFilter] = useState("");
  const [stockFilter, setStockFilter]   = useState("all");
  const [isFormOpen, setIsFormOpen]   = useState(false);
  const [editingId, setEditingId]     = useState<string | null>(null);
  const [formData, setFormData]       = useState({ ...EMPTY_FORM });
  const [deleteTarget, setDeleteTarget] = useState<any>(null);

  const openAdd = () => {
    setEditingId(null);
    setFormData({ ...EMPTY_FORM });
    setIsFormOpen(true);
  };

  const openEdit = (prod: any) => {
    setEditingId(prod.id);
    setFormData({
      name: prod.name || "", description: prod.description || "",
      price: String(prod.price || ""),
      originalPrice: prod.originalPrice ? String(prod.originalPrice) : "",
      category: prod.category || "", type: prod.type || "mart",
      unit: prod.unit || "", vendorName: prod.vendorName || "",
      inStock: prod.inStock, deliveryTime: prod.deliveryTime || "30-45 min"
    });
    setIsFormOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload = {
      ...formData,
      price: Number(formData.price),
      originalPrice: formData.originalPrice ? Number(formData.originalPrice) : null
    };

    if (editingId) {
      updateMutation.mutate({ id: editingId, ...payload }, {
        onSuccess: () => { toast({ title: "Product updated ✅" }); setIsFormOpen(false); },
        onError: err => toast({ title: "Update failed", description: err.message, variant: "destructive" })
      });
    } else {
      createMutation.mutate(payload, {
        onSuccess: () => { toast({ title: "Product created ✅" }); setIsFormOpen(false); },
        onError: err => toast({ title: "Create failed", description: err.message, variant: "destructive" })
      });
    }
  };

  const handleDelete = () => {
    if (!deleteTarget) return;
    deleteMutation.mutate(deleteTarget.id, {
      onSuccess: () => { toast({ title: "Product deleted" }); setDeleteTarget(null); },
      onError: err => toast({ title: "Delete failed", description: err.message, variant: "destructive" })
    });
  };

  const products = data?.products || [];
  const vendors = [...new Set(products.filter((p: any) => p.vendorName).map((p: any) => p.vendorName as string))];
  const q = search.toLowerCase();
  const filtered = products.filter((p: any) =>
    (typeFilter === "all" || p.type === typeFilter) &&
    (stockFilter === "all" || (stockFilter === "in" ? p.inStock : !p.inStock)) &&
    (!vendorFilter || (p.vendorName || "").toLowerCase().includes(vendorFilter.toLowerCase())) &&
    (p.name.toLowerCase().includes(q) || (p.category || "").toLowerCase().includes(q))
  );

  const toggleStock = (prod: any) => {
    updateMutation.mutate({ id: prod.id, inStock: !prod.inStock }, {
      onSuccess: () => toast({ title: prod.inStock ? "Marked out of stock" : "Marked in stock ✅" }),
      onError: err => toast({ title: "Failed", description: err.message, variant: "destructive" }),
    });
  };

  const exportCSV = () => {
    const header = "ID,Name,Category,Type,Price,Vendor,InStock";
    const rows = filtered.map((p: any) =>
      [p.id, p.name, p.category, p.type, p.price, p.vendorName || "", p.inStock ? "yes" : "no"].join(",")
    );
    const blob = new Blob([[header, ...rows].join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `products-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
  };

  const martCount = products.filter((p: any) => p.type === "mart").length;
  const foodCount = products.filter((p: any) => p.type === "food").length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-purple-100 text-purple-600 rounded-xl flex items-center justify-center">
            <PackageSearch className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-3xl font-display font-bold text-foreground">{T("products")}</h1>
            <p className="text-muted-foreground text-sm">{martCount} mart · {foodCount} food · {products.length} {T("total")}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={exportCSV} className="h-11 rounded-xl gap-2">
            <Download className="w-4 h-4" /> CSV
          </Button>
          <Button onClick={openAdd} className="h-11 rounded-xl shadow-md gap-2">
            <Plus className="w-5 h-5" /> Add Product
          </Button>
        </div>
      </div>

      {/* Add/Edit Dialog */}
      <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
        <DialogContent className="w-[95vw] max-w-2xl max-h-[90dvh] overflow-y-auto rounded-3xl p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl">{editingId ? T("editProduct") : T("addNewProduct")}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4 mt-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-semibold">Name *</label>
                <Input required value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="h-11 rounded-xl" placeholder="e.g. Fresh Milk" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-semibold">Category *</label>
                <Input required value={formData.category} onChange={e => setFormData({...formData, category: e.target.value})} className="h-11 rounded-xl" placeholder="e.g. dairy, vegetables" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-semibold">Type *</label>
                <select
                  className="w-full h-11 rounded-xl border border-input bg-background px-3 text-sm"
                  value={formData.type} onChange={e => setFormData({...formData, type: e.target.value})}
                >
                  <option value="mart">🛒 Mart</option>
                  <option value="food">🍔 Food</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-semibold">Unit</label>
                <Input value={formData.unit} onChange={e => setFormData({...formData, unit: e.target.value})} className="h-11 rounded-xl" placeholder="e.g. 1 kg, 500ml" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-semibold">Price (Rs.) *</label>
                <Input type="number" required min="1" value={formData.price} onChange={e => setFormData({...formData, price: e.target.value})} className="h-11 rounded-xl" placeholder="e.g. 250" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-semibold">Original Price (Rs.)</label>
                <Input type="number" min="1" value={formData.originalPrice} onChange={e => setFormData({...formData, originalPrice: e.target.value})} className="h-11 rounded-xl" placeholder="optional (for sale)" />
              </div>
              <div className="space-y-2 col-span-2">
                <label className="text-sm font-semibold">Description</label>
                <Input value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} className="h-11 rounded-xl" placeholder="Short description..." />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-semibold">Vendor / Restaurant</label>
                <Input value={formData.vendorName} onChange={e => setFormData({...formData, vendorName: e.target.value})} className="h-11 rounded-xl" placeholder="e.g. AJK Fresh Foods" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-semibold">Delivery Time</label>
                <Input value={formData.deliveryTime} onChange={e => setFormData({...formData, deliveryTime: e.target.value})} className="h-11 rounded-xl" placeholder="e.g. 30-45 min" />
              </div>
            </div>
            <div className="flex items-center gap-3 p-4 bg-muted/50 rounded-xl border border-border/50">
              <input
                type="checkbox" id="instock"
                checked={formData.inStock}
                onChange={e => setFormData({...formData, inStock: e.target.checked})}
                className="w-5 h-5 rounded accent-primary"
              />
              <label htmlFor="instock" className="font-semibold text-sm cursor-pointer">
                Product is currently in stock
              </label>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <Button type="button" variant="outline" className="h-11 px-6 rounded-xl" onClick={() => setIsFormOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending} className="h-11 px-8 rounded-xl">
                {(createMutation.isPending || updateMutation.isPending) ? "Saving..." : editingId ? 'Save Changes' : 'Create Product'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={open => { if (!open) setDeleteTarget(null); }}>
        <DialogContent className="w-[95vw] max-w-sm rounded-3xl p-6">
          <DialogHeader>
            <DialogTitle className="text-red-600">Delete Product?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground mt-2">
            Are you sure you want to delete <strong>"{deleteTarget?.name}"</strong>? This cannot be undone.
          </p>
          <div className="flex gap-3 mt-6">
            <Button variant="outline" className="flex-1 rounded-xl" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              className="flex-1 rounded-xl"
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Filters */}
      <Card className="p-4 rounded-2xl border-border/50 shadow-sm space-y-3">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search by name or category..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9 h-11 rounded-xl"
            />
          </div>
          <div className="relative sm:w-44">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Filter vendor..."
              value={vendorFilter}
              onChange={e => setVendorFilter(e.target.value)}
              className="pl-9 h-11 rounded-xl"
            />
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          {["all", "mart", "food"].map(t => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={`px-4 py-2 rounded-xl text-sm font-semibold capitalize transition-colors border ${
                typeFilter === t ? "bg-primary text-white border-primary" : "bg-muted/30 border-border/50 hover:border-primary text-muted-foreground"
              }`}
            >
              {t === "mart" ? "🛒 " : t === "food" ? "🍔 " : ""}{t}
            </button>
          ))}
          <div className="w-px bg-border/60 mx-1" />
          {[{ v: "all", l: "All Stock" }, { v: "in", l: "✓ In Stock" }, { v: "out", l: "✗ Out of Stock" }].map(s => (
            <button
              key={s.v}
              onClick={() => setStockFilter(s.v)}
              className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors border ${
                stockFilter === s.v ? "bg-green-600 text-white border-green-600" : "bg-muted/30 border-border/50 hover:border-green-300 text-muted-foreground"
              }`}
            >
              {s.l}
            </button>
          ))}
        </div>
      </Card>

      <Card className="rounded-2xl border-border/50 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <Table className="min-w-[600px]">
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead>{T("product")}</TableHead>
                <TableHead>{T("category")}</TableHead>
                <TableHead>{T("price")}</TableHead>
                <TableHead>{T("vendor")}</TableHead>
                <TableHead>{T("stock")}</TableHead>
                <TableHead className="text-right">{T("actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={6} className="h-32 text-center text-muted-foreground">Loading products...</TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="h-32 text-center text-muted-foreground">No products found.</TableCell></TableRow>
              ) : (
                filtered.map((p: any) => (
                  <TableRow key={p.id} className="hover:bg-muted/30">
                    <TableCell>
                      <p className="font-semibold text-foreground">{p.name}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <Badge variant={p.type === 'food' ? 'default' : 'secondary'} className="text-[10px] uppercase">
                          {p.type}
                        </Badge>
                        {p.unit && <span className="text-xs text-muted-foreground">{p.unit}</span>}
                      </div>
                    </TableCell>
                    <TableCell className="capitalize font-medium text-sm">{p.category}</TableCell>
                    <TableCell>
                      <p className="font-bold text-foreground">{formatCurrency(p.price)}</p>
                      {p.originalPrice && (
                        <p className="text-xs line-through text-muted-foreground">{formatCurrency(p.originalPrice)}</p>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{p.vendorName || "—"}</TableCell>
                    <TableCell>
                      <button
                        onClick={() => toggleStock(p)}
                        disabled={updateMutation.isPending}
                        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-bold border transition-colors ${
                          p.inStock
                            ? "bg-green-50 text-green-700 border-green-200 hover:bg-green-100"
                            : "bg-red-50 text-red-700 border-red-200 hover:bg-red-100"
                        }`}
                      >
                        {p.inStock
                          ? <><ToggleRight className="w-4 h-4" /> In Stock</>
                          : <><ToggleLeft  className="w-4 h-4" /> Out of Stock</>
                        }
                      </button>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button variant="ghost" size="icon" onClick={() => openEdit(p)} className="hover:bg-blue-50 hover:text-blue-600 h-8 w-8">
                          <Edit className="w-4 h-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => setDeleteTarget(p)} className="hover:bg-red-50 hover:text-red-600 h-8 w-8">
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
