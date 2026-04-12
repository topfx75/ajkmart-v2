import { useState, useRef } from "react";
import { PackageSearch, Plus, Search, Edit, Trash2, ToggleLeft, ToggleRight, Download, Filter, CheckCircle, XCircle, Clock, Upload, X, ImageIcon } from "lucide-react";
import { useProducts, useCreateProduct, useUpdateProduct, useDeleteProduct, usePendingProducts, useApproveProduct, useRejectProduct, useCategories } from "@/hooks/use-admin";
import { formatCurrency } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useLanguage } from "@/lib/useLanguage";
import { tDual, type TranslationKey } from "@workspace/i18n";
import { uploadAdminImage } from "@/lib/api";

const EMPTY_FORM = {
  name: "", description: "", price: "", originalPrice: "",
  category: "", type: "mart", unit: "", vendorName: "",
  inStock: true, deliveryTime: "30-45 min", image: ""
};

function RejectModal({ product, onClose }: { product: any; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const { toast } = useToast();
  const reject = useRejectProduct();
  const handleReject = () => {
    if (!reason.trim()) { toast({ title: "Reason required", variant: "destructive" }); return; }
    reject.mutate({ id: product.id, reason: reason.trim() }, {
      onSuccess: () => { toast({ title: "Product rejected" }); onClose(); },
      onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
    });
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="bg-gradient-to-r from-red-600 to-rose-600 p-5">
          <h2 className="text-lg font-extrabold text-white">❌ Reject Product</h2>
          <p className="text-red-200 text-sm mt-0.5">Product reject ho jayega aur vendor ko notify kar diya jayega</p>
        </div>
        <div className="p-5 space-y-4">
          <div className="bg-red-50 rounded-xl p-4 space-y-1">
            <p className="text-sm font-bold text-gray-800">{product.name}</p>
            <p className="text-xs text-gray-500">By: {product.vendorName || "Unknown Vendor"} · {formatCurrency(product.price)}</p>
          </div>
          <div>
            <label className="text-xs font-bold text-gray-500 uppercase tracking-wider block mb-1.5">Rejection Reason *</label>
            <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3}
              placeholder="e.g. Poor image quality · Price too high · Duplicate product"
              className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-red-400 resize-none"/>
          </div>
          <div className="flex gap-3">
            <Button variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
            <Button className="flex-1 bg-red-600 hover:bg-red-700 text-white font-bold" onClick={handleReject} disabled={reject.isPending}>
              {reject.isPending ? "Rejecting..." : "❌ Reject"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Products() {
  const { language } = useLanguage();
  const T = (key: TranslationKey) => tDual(key, language);
  const { data, isLoading } = useProducts();
  const { data: pendingData, isLoading: pendingLoading } = usePendingProducts();
  const { data: categoriesData } = useCategories();
  const createMutation = useCreateProduct();
  const updateMutation = useUpdateProduct();
  const deleteMutation = useDeleteProduct();
  const approveMutation = useApproveProduct();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [tab, setTab] = useState<"all" | "pending">("all");
  const [search, setSearch]         = useState("");
  const [typeFilter, setTypeFilter]   = useState("all");
  const [vendorFilter, setVendorFilter] = useState("");
  const [stockFilter, setStockFilter]   = useState("all");
  const [isFormOpen, setIsFormOpen]   = useState(false);
  const [editingId, setEditingId]     = useState<string | null>(null);
  const [formData, setFormData]       = useState({ ...EMPTY_FORM });
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const [rejectTarget, setRejectTarget] = useState<any>(null);
  const [imagePreview, setImagePreview] = useState<string>("");
  const [imageUploading, setImageUploading] = useState(false);
  const [categorySearch, setCategorySearch] = useState("");
  const [categoryDropOpen, setCategoryDropOpen] = useState(false);

  const categories = categoriesData || [];
  const filteredCategories = categories.filter(c =>
    c.name.toLowerCase().includes(categorySearch.toLowerCase()) ||
    c.id.toLowerCase().includes(categorySearch.toLowerCase())
  );

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!["image/jpeg", "image/jpg", "image/png", "image/webp"].includes(file.type)) {
      toast({ title: "Invalid file type", description: "Only JPEG, PNG, and WebP images are allowed", variant: "destructive" });
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast({ title: "File too large", description: "Image must be under 10MB", variant: "destructive" });
      return;
    }
    setImagePreview(URL.createObjectURL(file));
    setImageUploading(true);
    try {
      const url = await uploadAdminImage(file);
      setFormData(prev => ({ ...prev, image: url }));
      toast({ title: "Image uploaded ✅" });
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
      setImagePreview(formData.image || "");
    } finally {
      setImageUploading(false);
    }
  };

  const openAdd = () => {
    setEditingId(null);
    setFormData({ ...EMPTY_FORM });
    setImagePreview("");
    setCategorySearch("");
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
      inStock: prod.inStock, deliveryTime: prod.deliveryTime || "30-45 min",
      image: prod.image || "",
    });
    setImagePreview(prod.image || "");
    setCategorySearch(prod.category || "");
    setIsFormOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.category.trim()) {
      toast({ title: "Category required", description: "Please search and select a category from the dropdown", variant: "destructive" });
      return;
    }
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

  const handleApprove = (prod: any) => {
    approveMutation.mutate({ id: prod.id }, {
      onSuccess: () => toast({ title: "Product approved ✅", description: `${prod.name} is now live in the store` }),
      onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
    });
  };

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

  const products = data?.products || [];
  const pendingProducts = pendingData?.products || [];
  const vendors = [...new Set(products.filter((p: any) => p.vendorName).map((p: any) => p.vendorName as string))];
  const q = search.toLowerCase();
  const filtered = products.filter((p: any) =>
    (typeFilter === "all" || p.type === typeFilter) &&
    (stockFilter === "all" || (stockFilter === "in" ? p.inStock : !p.inStock)) &&
    (!vendorFilter || (p.vendorName || "").toLowerCase().includes(vendorFilter.toLowerCase())) &&
    (p.name.toLowerCase().includes(q) || (p.category || "").toLowerCase().includes(q))
  );

  const martCount = products.filter((p: any) => p.type === "mart").length;
  const foodCount = products.filter((p: any) => p.type === "food").length;
  const pendingCount = pendingProducts.length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-purple-100 text-purple-600 rounded-xl flex items-center justify-center">
            <PackageSearch className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-3xl font-display font-bold text-foreground">{T("products")}</h1>
            <p className="text-muted-foreground text-sm">{martCount} mart · {foodCount} food · {products.length} {T("total")} {pendingCount > 0 && `· ${pendingCount} pending approval`}</p>
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

      {/* Tab switcher */}
      <div className="flex gap-2 border-b border-border/40 pb-0">
        <button
          onClick={() => setTab("all")}
          className={`px-5 py-2.5 text-sm font-bold rounded-t-xl border-b-2 transition-colors ${
            tab === "all" ? "border-primary text-primary bg-primary/5" : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          All Products ({products.length})
        </button>
        <button
          onClick={() => setTab("pending")}
          className={`px-5 py-2.5 text-sm font-bold rounded-t-xl border-b-2 transition-colors flex items-center gap-2 ${
            tab === "pending" ? "border-amber-500 text-amber-700 bg-amber-50" : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <Clock className="w-4 h-4" />
          Pending Approval
          {pendingCount > 0 && (
            <span className="bg-amber-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">{pendingCount}</span>
          )}
        </button>
      </div>

      {/* Add/Edit Dialog */}
      <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
        <DialogContent className="w-[95vw] max-w-2xl max-h-[90dvh] overflow-y-auto rounded-3xl p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl">{editingId ? T("editProduct") : T("addNewProduct")}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4 mt-4">
            {/* Image Uploader */}
            <div className="space-y-2">
              <label className="text-sm font-semibold">Product Image</label>
              <div
                className="relative border-2 border-dashed border-border rounded-xl overflow-hidden cursor-pointer hover:border-primary/60 transition-colors"
                style={{ height: imagePreview ? 160 : 100 }}
                onClick={() => fileInputRef.current?.click()}
              >
                {imagePreview ? (
                  <>
                    <img src={imagePreview} alt="preview" className="w-full h-full object-cover" />
                    {imageUploading && (
                      <div className="absolute inset-0 bg-black/40 flex flex-col items-center justify-center gap-2">
                        <div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        <span className="text-white text-xs font-semibold">Uploading...</span>
                      </div>
                    )}
                    {!imageUploading && (
                      <button
                        type="button"
                        aria-label="Remove product image"
                        className="absolute top-2 right-2 w-7 h-7 bg-black/60 hover:bg-black/80 rounded-full flex items-center justify-center text-white transition-colors"
                        onClick={e => { e.stopPropagation(); setImagePreview(""); setFormData(prev => ({ ...prev, image: "" })); }}
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </>
                ) : (
                  <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground">
                    <ImageIcon className="w-7 h-7" />
                    <span className="text-xs font-medium">Click to upload image (JPEG/PNG/WebP, max 10MB)</span>
                  </div>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/jpg,image/png,image/webp"
                className="hidden"
                onChange={handleImageSelect}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-semibold">Name *</label>
                <Input required value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="h-11 rounded-xl" placeholder="e.g. Fresh Milk" />
              </div>
              <div className="space-y-2 relative">
                <label className="text-sm font-semibold">Category *</label>
                <div className="relative">
                  <Input
                    value={categorySearch}
                    onChange={e => {
                      setCategorySearch(e.target.value);
                      setCategoryDropOpen(true);
                      if (!e.target.value.trim()) {
                        setFormData(prev => ({ ...prev, category: "" }));
                      }
                    }}
                    onFocus={() => setCategoryDropOpen(true)}
                    onBlur={() => setTimeout(() => {
                      setCategoryDropOpen(false);
                      if (!formData.category) setCategorySearch("");
                    }, 150)}
                    className="h-11 rounded-xl pr-8"
                    placeholder="Search and select a category..."
                  />
                  {formData.category && (
                    <div className="mt-1 text-xs text-muted-foreground px-1">
                      Selected: <span className="font-semibold text-primary">{formData.category}</span>
                    </div>
                  )}
                  {categoryDropOpen && filteredCategories.length > 0 && (
                    <div className="absolute z-50 w-full mt-1 bg-white border border-border rounded-xl shadow-lg max-h-40 overflow-y-auto">
                      {filteredCategories.slice(0, 8).map(cat => (
                        <button
                          key={cat.id}
                          type="button"
                          className="w-full text-left px-3 py-2 text-sm hover:bg-muted/60 flex items-center gap-2"
                          onMouseDown={() => {
                            setCategorySearch(cat.name);
                            setFormData(prev => ({ ...prev, category: cat.id }));
                            setCategoryDropOpen(false);
                          }}
                        >
                          {cat.icon && <span>{cat.icon}</span>}
                          <span className="font-medium">{cat.name}</span>
                          <span className="text-muted-foreground text-xs ml-auto">{cat.id}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
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
              <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending || imageUploading} className="h-11 px-8 rounded-xl">
                {imageUploading ? "Uploading image..." : (createMutation.isPending || updateMutation.isPending) ? "Saving..." : editingId ? 'Save Changes' : 'Create Product'}
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

      {/* Reject Modal */}
      {rejectTarget && <RejectModal product={rejectTarget} onClose={() => setRejectTarget(null)} />}

      {/* PENDING APPROVAL TAB */}
      {tab === "pending" && (
        <div className="space-y-4">
          {pendingCount > 0 && (
            <div className="flex items-center gap-3 bg-amber-50 border-2 border-amber-400 rounded-2xl px-4 py-3">
              <span className="text-2xl">⏳</span>
              <div>
                <p className="text-sm font-bold text-amber-800">{pendingCount} product{pendingCount > 1 ? "s" : ""} waiting for your review</p>
                <p className="text-xs text-amber-600">Vendor-submitted products that need approval before going live</p>
              </div>
            </div>
          )}
          {/* Mobile cards — visible below md */}
          <div className="md:hidden space-y-3">
            {pendingLoading ? (
              [1,2,3].map(i => <div key={i} className="h-28 bg-muted rounded-2xl animate-pulse" />)
            ) : pendingProducts.length === 0 ? (
              <Card className="rounded-2xl border-border/50">
                <CardContent className="p-12 flex flex-col items-center gap-2 text-muted-foreground">
                  <CheckCircle className="w-10 h-10 text-green-400" />
                  <p className="font-semibold">All caught up!</p>
                  <p className="text-sm">No products waiting for approval.</p>
                </CardContent>
              </Card>
            ) : pendingProducts.map((p: any) => (
              <Card key={p.id} className="rounded-2xl border-border/50 shadow-sm">
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-foreground truncate">{p.name}</p>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <Badge variant={p.type === 'food' ? 'default' : 'secondary'} className="text-[10px] uppercase">{p.type}</Badge>
                        <span className="text-xs text-muted-foreground capitalize">{p.category}</span>
                        {p.unit && <span className="text-xs text-muted-foreground">{p.unit}</span>}
                      </div>
                      {p.description && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{p.description}</p>}
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="font-bold text-foreground">{formatCurrency(p.price)}</p>
                      {p.originalPrice && <p className="text-xs line-through text-muted-foreground">{formatCurrency(p.originalPrice)}</p>}
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{p.vendorName || "—"}</span>
                    <span>{p.createdAt ? new Date(p.createdAt).toLocaleDateString("en-PK", { day: "numeric", month: "short" }) : "—"}</span>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => handleApprove(p)}
                      disabled={approveMutation.isPending}
                      className="flex-1 bg-green-600 hover:bg-green-700 text-white h-8 rounded-xl gap-1.5 text-xs font-bold disabled:opacity-60"
                    >
                      <CheckCircle className="w-3.5 h-3.5" />
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setRejectTarget(p)}
                      className="flex-1 border-red-300 text-red-600 hover:bg-red-50 h-8 rounded-xl gap-1.5 text-xs font-bold"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      Reject
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Desktop table — visible from md up */}
          <Card className="hidden md:block rounded-2xl border-border/50 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <Table className="min-w-[640px]">
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Price</TableHead>
                    <TableHead>Vendor</TableHead>
                    <TableHead>Submitted</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pendingLoading ? (
                    <TableRow><TableCell colSpan={6} className="h-32 text-center text-muted-foreground">Loading pending products...</TableCell></TableRow>
                  ) : pendingProducts.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="h-48 text-center">
                        <div className="flex flex-col items-center gap-2 text-muted-foreground">
                          <CheckCircle className="w-10 h-10 text-green-400" />
                          <p className="font-semibold">All caught up!</p>
                          <p className="text-sm">No products waiting for approval.</p>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : (
                    pendingProducts.map((p: any) => (
                      <TableRow key={p.id} className="hover:bg-amber-50/40">
                        <TableCell>
                          <p className="font-semibold text-foreground">{p.name}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <Badge variant={p.type === 'food' ? 'default' : 'secondary'} className="text-[10px] uppercase">
                              {p.type}
                            </Badge>
                            {p.unit && <span className="text-xs text-muted-foreground">{p.unit}</span>}
                          </div>
                          {p.description && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{p.description}</p>}
                        </TableCell>
                        <TableCell className="capitalize font-medium text-sm">{p.category}</TableCell>
                        <TableCell>
                          <p className="font-bold text-foreground">{formatCurrency(p.price)}</p>
                          {p.originalPrice && (
                            <p className="text-xs line-through text-muted-foreground">{formatCurrency(p.originalPrice)}</p>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{p.vendorName || "—"}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {p.createdAt ? new Date(p.createdAt).toLocaleDateString("en-PK", { day: "numeric", month: "short" }) : "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button
                              size="sm"
                              onClick={() => handleApprove(p)}
                              disabled={approveMutation.isPending}
                              className="bg-green-600 hover:bg-green-700 text-white h-8 px-3 rounded-xl gap-1.5 text-xs font-bold disabled:opacity-60"
                            >
                              <CheckCircle className="w-3.5 h-3.5" />
                              Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setRejectTarget(p)}
                              className="border-red-300 text-red-600 hover:bg-red-50 h-8 px-3 rounded-xl gap-1.5 text-xs font-bold"
                            >
                              <XCircle className="w-3.5 h-3.5" />
                              Reject
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
      )}

      {/* ALL PRODUCTS TAB */}
      {tab === "all" && (
        <>
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
              {[{ v: "all", l: T("allStockLabel") }, { v: "in", l: T("inStockFilter") }, { v: "out", l: T("outOfStockFilter") }].map(s => (
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

          {/* Mobile card list */}
          <div className="md:hidden space-y-3">
            {isLoading ? (
              [1,2,3].map(i => <div key={i} className="h-20 bg-muted rounded-2xl animate-pulse" />)
            ) : filtered.length === 0 ? (
              <Card className="rounded-2xl p-12 text-center border-border/50">
                <p className="text-muted-foreground text-sm">No products found.</p>
              </Card>
            ) : filtered.map((p: any) => (
              <Card key={p.id} className="rounded-2xl border-border/50 shadow-sm p-4">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-foreground truncate">{p.name}</p>
                      <Badge variant={p.type === "food" ? "default" : "secondary"} className="text-[10px] uppercase">{p.type}</Badge>
                      {!p.inStock && <Badge variant="outline" className="text-[10px] bg-red-50 text-red-600 border-red-200">{T("outOfStockLabel")}</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 capitalize">{p.category}{p.vendorName ? ` · ${p.vendorName}` : ""}</p>
                    <p className="font-bold text-foreground text-sm mt-1">{formatCurrency(p.price)}</p>
                  </div>
                  <div className="flex flex-col gap-1.5 shrink-0">
                    <button
                      onClick={() => toggleStock(p)}
                      disabled={updateMutation.isPending}
                      aria-label={`${p.inStock ? T("outOfStockLabel") : T("inStockLabel")} — ${p.name}`}
                      className={`flex items-center gap-1 px-2 py-1.5 rounded-lg text-[10px] font-bold border ${p.inStock ? "bg-green-50 text-green-700 border-green-200" : "bg-red-50 text-red-700 border-red-200"}`}
                    >
                      {p.inStock ? <ToggleRight className="w-3.5 h-3.5" /> : <ToggleLeft className="w-3.5 h-3.5" />}
                      {p.inStock ? T("inStockLabel") : T("outOfStockLabel")}
                    </button>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" aria-label={`Edit ${p.name}`} onClick={() => openEdit(p)} className="hover:bg-blue-50 hover:text-blue-600 h-7 w-7">
                        <Edit className="w-3.5 h-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" aria-label={`Delete ${p.name}`} onClick={() => setDeleteTarget(p)} className="hover:bg-red-50 hover:text-red-600 h-7 w-7">
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
              </Card>
            ))}
          </div>

          {/* Desktop table */}
          <Card className="hidden md:block rounded-2xl border-border/50 shadow-sm overflow-hidden">
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
                              ? <><ToggleRight className="w-4 h-4" /> {T("inStockLabel")}</>
                              : <><ToggleLeft  className="w-4 h-4" /> {T("outOfStockLabel")}</>
                            }
                          </button>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button variant="ghost" size="icon" aria-label={`Edit ${p.name}`} onClick={() => openEdit(p)} className="hover:bg-blue-50 hover:text-blue-600 h-8 w-8">
                              <Edit className="w-4 h-4" />
                            </Button>
                            <Button variant="ghost" size="icon" aria-label={`Delete ${p.name}`} onClick={() => setDeleteTarget(p)} className="hover:bg-red-50 hover:text-red-600 h-8 w-8">
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
        </>
      )}
    </div>
  );
}
