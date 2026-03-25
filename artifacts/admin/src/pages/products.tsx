import { useState } from "react";
import { PackageSearch, Plus, Search, Edit, Trash2 } from "lucide-react";
import { useProducts, useCreateProduct, useUpdateProduct, useDeleteProduct } from "@/hooks/use-admin";
import { formatCurrency } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

export default function Products() {
  const { data, isLoading } = useProducts();
  const createMutation = useCreateProduct();
  const updateMutation = useUpdateProduct();
  const deleteMutation = useDeleteProduct();
  const { toast } = useToast();
  
  const [search, setSearch] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: "", description: "", price: "", originalPrice: "", 
    category: "", type: "mart", unit: "", vendorName: "", 
    inStock: true, deliveryTime: "30-45 min"
  });

  const openAdd = () => {
    setEditingId(null);
    setFormData({ name: "", description: "", price: "", originalPrice: "", category: "", type: "mart", unit: "", vendorName: "", inStock: true, deliveryTime: "30-45 min" });
    setIsDialogOpen(true);
  };

  const openEdit = (prod: any) => {
    setEditingId(prod.id);
    setFormData({
      name: prod.name || "", description: prod.description || "", price: String(prod.price || ""),
      originalPrice: prod.originalPrice ? String(prod.originalPrice) : "", category: prod.category || "",
      type: prod.type || "mart", unit: prod.unit || "", vendorName: prod.vendorName || "",
      inStock: prod.inStock, deliveryTime: prod.deliveryTime || ""
    });
    setIsDialogOpen(true);
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
        onSuccess: () => { toast({ title: "Product updated" }); setIsDialogOpen(false); }
      });
    } else {
      createMutation.mutate(payload, {
        onSuccess: () => { toast({ title: "Product created" }); setIsDialogOpen(false); }
      });
    }
  };

  const handleDelete = (id: string) => {
    if (confirm("Delete this product permanently?")) {
      deleteMutation.mutate(id, { onSuccess: () => toast({ title: "Product deleted" }) });
    }
  };

  const products = data?.products || [];
  const filtered = products.filter((p: any) => p.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-purple-100 text-purple-600 rounded-xl flex items-center justify-center">
            <PackageSearch className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-3xl font-display font-bold text-foreground">Products</h1>
            <p className="text-muted-foreground text-sm">Manage inventory for Mart and Food</p>
          </div>
        </div>
        <Button onClick={openAdd} className="h-11 rounded-xl shadow-md">
          <Plus className="w-5 h-5 mr-2" /> Add Product
        </Button>
      </div>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto rounded-3xl p-6">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl">{editingId ? 'Edit Product' : 'Add New Product'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4 mt-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-semibold">Name</label>
                <Input required value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="h-11 rounded-xl" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-semibold">Category</label>
                <Input required value={formData.category} onChange={e => setFormData({...formData, category: e.target.value})} className="h-11 rounded-xl" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-semibold">Type</label>
                <select 
                  className="w-full h-11 rounded-xl border border-input bg-background px-3"
                  value={formData.type} onChange={e => setFormData({...formData, type: e.target.value})}
                >
                  <option value="mart">Mart</option>
                  <option value="food">Food</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-semibold">Unit (e.g. 1 kg)</label>
                <Input value={formData.unit} onChange={e => setFormData({...formData, unit: e.target.value})} className="h-11 rounded-xl" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-semibold">Price (Rs.)</label>
                <Input type="number" required value={formData.price} onChange={e => setFormData({...formData, price: e.target.value})} className="h-11 rounded-xl" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-semibold">Original Price (optional)</label>
                <Input type="number" value={formData.originalPrice} onChange={e => setFormData({...formData, originalPrice: e.target.value})} className="h-11 rounded-xl" />
              </div>
              <div className="space-y-2 col-span-2">
                <label className="text-sm font-semibold">Description</label>
                <Input value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} className="h-11 rounded-xl" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-semibold">Vendor Name</label>
                <Input value={formData.vendorName} onChange={e => setFormData({...formData, vendorName: e.target.value})} className="h-11 rounded-xl" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-semibold">Delivery Time</label>
                <Input value={formData.deliveryTime} onChange={e => setFormData({...formData, deliveryTime: e.target.value})} className="h-11 rounded-xl" />
              </div>
            </div>
            <div className="flex items-center gap-2 mt-4 p-4 bg-muted/50 rounded-xl border border-border/50">
              <input type="checkbox" id="instock" checked={formData.inStock} onChange={e => setFormData({...formData, inStock: e.target.checked})} className="w-5 h-5 rounded" />
              <label htmlFor="instock" className="font-semibold text-sm cursor-pointer">Product is in stock</label>
            </div>
            <div className="flex justify-end pt-4">
              <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending} className="h-11 px-8 rounded-xl">
                {editingId ? 'Save Changes' : 'Create Product'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Card className="p-4 rounded-2xl border-border/50 shadow-sm max-w-md">
        <div className="relative w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search products..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 h-11 rounded-xl" />
        </div>
      </Card>

      <Card className="rounded-2xl border-border/50 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead>Product Info</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Price</TableHead>
                <TableHead>Stock</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={5} className="h-32 text-center text-muted-foreground">Loading products...</TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="h-32 text-center text-muted-foreground">No products found.</TableCell></TableRow>
              ) : (
                filtered.map((p: any) => (
                  <TableRow key={p.id} className="hover:bg-muted/30">
                    <TableCell>
                      <p className="font-semibold text-foreground">{p.name}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <Badge variant={p.type === 'food' ? 'default' : 'secondary'} className="text-[10px] uppercase">
                          {p.type}
                        </Badge>
                        <span className="text-xs text-muted-foreground">{p.unit}</span>
                      </div>
                    </TableCell>
                    <TableCell className="capitalize font-medium">{p.category}</TableCell>
                    <TableCell>
                      <p className="font-bold text-foreground">{formatCurrency(p.price)}</p>
                      {p.originalPrice && <p className="text-xs line-through text-muted-foreground">{formatCurrency(p.originalPrice)}</p>}
                    </TableCell>
                    <TableCell>
                      <Badge variant={p.inStock ? "outline" : "destructive"} className={p.inStock ? "bg-green-50 text-green-700 border-green-200" : ""}>
                        {p.inStock ? "In Stock" : "Out of Stock"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button variant="ghost" size="icon" onClick={() => openEdit(p)} className="hover:bg-blue-50 hover:text-blue-600">
                          <Edit className="w-4 h-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => handleDelete(p.id)} className="hover:bg-red-50 hover:text-red-600">
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
