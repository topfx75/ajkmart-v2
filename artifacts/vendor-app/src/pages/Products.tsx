import { useState, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { PageHeader } from "../components/PageHeader";
import { fc, CARD, INPUT, SELECT, TEXTAREA, BTN_PRIMARY, BTN_SECONDARY, LABEL } from "../lib/ui";

const EMPTY = { name:"", description:"", price:"", originalPrice:"", category:"", unit:"", stock:"", image:"", type:"mart" };
const EMPTY_ROW = { name:"", price:"", category:"", unit:"", stock:"" };
const CATS  = ["food","grocery","bakery","pharmacy","electronics","clothing","mart","general"];
const TYPES = ["mart","food","pharmacy","parcel"];

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className={LABEL}>{label}</label>{children}</div>;
}

export default function Products() {
  const qc = useQueryClient();
  const [view, setView]           = useState<"list"|"bulk">("list");
  const [search, setSearch]       = useState("");
  const [filterCat, setFilterCat] = useState("all");
  const [showAdd, setShowAdd]     = useState(false);
  const [editProd, setEditProd]   = useState<any|null>(null);
  const [form, setForm]           = useState({ ...EMPTY });
  const [bulkRows, setBulkRows]   = useState([{ ...EMPTY_ROW }, { ...EMPTY_ROW }, { ...EMPTY_ROW }]);
  const [toast, setToast]         = useState("");
  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(""), 3000); };
  const f = (k: string, v: any) => setForm(p => ({ ...p, [k]: v }));

  const { data, isLoading } = useQuery({
    queryKey: ["vendor-products", search, filterCat],
    queryFn: () => api.getProducts(search || undefined, filterCat !== "all" ? filterCat : undefined),
    refetchInterval: 60000,
  });
  const products: any[] = data?.products || [];

  const categories = useMemo(() => {
    const s = new Set<string>();
    products.forEach(p => p.category && s.add(p.category));
    return ["all", ...Array.from(s)];
  }, [products]);

  const lowStock = products.filter(p => p.stock !== null && p.stock !== undefined && p.stock < 10 && p.stock >= 0);

  const createMut = useMutation({
    mutationFn: () => api.createProduct({ ...form, price: Number(form.price), originalPrice: form.originalPrice ? Number(form.originalPrice) : undefined, stock: form.stock ? Number(form.stock) : undefined }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["vendor-products"] }); setShowAdd(false); setForm({ ...EMPTY }); showToast("✅ Product added!"); },
    onError: (e: any) => showToast("❌ " + e.message),
  });

  const updateMut = useMutation({
    mutationFn: () => api.updateProduct(editProd.id, { ...form, price: Number(form.price), originalPrice: form.originalPrice ? Number(form.originalPrice) : null, stock: form.stock !== "" ? Number(form.stock) : null }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["vendor-products"] }); setEditProd(null); setShowAdd(false); showToast("✅ Updated!"); },
    onError: (e: any) => showToast("❌ " + e.message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.deleteProduct(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["vendor-products"] }); showToast("🗑️ Deleted"); },
    onError: (e: any) => showToast("❌ " + e.message),
  });

  const toggleMut = useMutation({
    mutationFn: ({ id, inStock }: { id: string; inStock: boolean }) => api.updateProduct(id, { inStock }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["vendor-products"] }),
    onError: (e: any) => showToast("❌ " + e.message),
  });

  const bulkMut = useMutation({
    mutationFn: () => {
      const valid = bulkRows.filter(r => r.name.trim() && r.price);
      return api.bulkAddProducts(valid.map(r => ({ name: r.name.trim(), price: Number(r.price), category: r.category || "general", unit: r.unit || null, stock: r.stock ? Number(r.stock) : null })));
    },
    onSuccess: (res) => { qc.invalidateQueries({ queryKey: ["vendor-products"] }); setView("list"); setBulkRows([{...EMPTY_ROW},{...EMPTY_ROW},{...EMPTY_ROW}]); showToast(`✅ ${res.inserted} products added!`); },
    onError: (e: any) => showToast("❌ " + e.message),
  });

  const openEdit = (p: any) => {
    setEditProd(p);
    setForm({ name: p.name, description: p.description||"", price: String(p.price), originalPrice: p.originalPrice ? String(p.originalPrice) : "", category: p.category||"", unit: p.unit||"", stock: p.stock != null ? String(p.stock) : "", image: p.image||"", type: p.type||"mart" });
    setShowAdd(true);
  };
  const closeForm = () => { setShowAdd(false); setEditProd(null); setForm({ ...EMPTY }); };

  const Toast = toast ? (
    <div className="fixed top-0 left-0 right-0 z-50 flex justify-center toast-in"
      style={{ paddingTop: "calc(env(safe-area-inset-top,0px) + 8px)", paddingLeft: "16px", paddingRight: "16px" }}>
      <div className="bg-gray-900 text-white text-sm font-semibold px-5 py-3 rounded-2xl shadow-2xl max-w-sm w-full text-center">{toast}</div>
    </div>
  ) : null;

  /* ── Add/Edit Form ── */
  if (showAdd) return (
    <div className="min-h-screen bg-gray-50 md:bg-transparent md:min-h-0">
      <PageHeader
        title={editProd ? "Edit Product" : "Add Product"}
        subtitle="Fill in product details"
        actions={
          <button onClick={closeForm} className="h-10 px-4 bg-white/20 md:bg-gray-100 md:text-gray-700 text-white font-bold rounded-xl text-sm android-press min-h-0">
            ✕ Cancel
          </button>
        }
      />
      <div className="px-4 py-4 md:px-0 md:py-4">
        <div className="md:grid md:grid-cols-2 md:gap-6 space-y-4 md:space-y-0">
          <div className={`${CARD} p-4 space-y-3`}>
            <Field label="Product Name *">
              <input value={form.name} onChange={e => f("name",e.target.value)} placeholder="e.g. Chicken Biryani" className={INPUT}/>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Price (Rs.) *">
                <input type="number" inputMode="numeric" value={form.price} onChange={e => f("price",e.target.value)} placeholder="0" className={INPUT}/>
              </Field>
              <Field label="Original Price">
                <input type="number" inputMode="numeric" value={form.originalPrice} onChange={e => f("originalPrice",e.target.value)} placeholder="Strike-out" className={INPUT}/>
              </Field>
              <Field label="Category">
                <select value={form.category} onChange={e => f("category",e.target.value)} className={SELECT}>
                  <option value="">Select...</option>
                  {CATS.map(c => <option key={c} value={c} className="capitalize">{c}</option>)}
                </select>
              </Field>
              <Field label="Type">
                <select value={form.type} onChange={e => f("type",e.target.value)} className={SELECT}>
                  {TYPES.map(t => <option key={t} value={t} className="capitalize">{t}</option>)}
                </select>
              </Field>
              <Field label="Unit">
                <input value={form.unit} onChange={e => f("unit",e.target.value)} placeholder="kg / pcs / ltr" className={INPUT}/>
              </Field>
              <Field label="Stock Qty">
                <input type="number" inputMode="numeric" value={form.stock} onChange={e => f("stock",e.target.value)} placeholder="Blank = unlimited" className={INPUT}/>
              </Field>
            </div>
            <Field label="Description">
              <textarea value={form.description} onChange={e => f("description",e.target.value)} placeholder="Short description..." rows={2} className={TEXTAREA}/>
            </Field>
          </div>
          <div className="space-y-4">
            <div className={`${CARD} p-4`}>
              <Field label="Image URL">
                <input type="url" value={form.image} onChange={e => f("image",e.target.value)} placeholder="https://..." className={INPUT}/>
              </Field>
              {form.image && (
                <div className="rounded-xl overflow-hidden h-40 bg-gray-100 mt-3">
                  <img src={form.image} alt="preview" className="w-full h-full object-cover" onError={e => (e.currentTarget.style.display="none")}/>
                </div>
              )}
            </div>
            <div className="flex gap-3">
              <button onClick={closeForm} className={BTN_SECONDARY}>Cancel</button>
              <button onClick={() => editProd ? updateMut.mutate() : createMut.mutate()} disabled={!form.name || !form.price || createMut.isPending || updateMut.isPending} className={BTN_PRIMARY}>
                {createMut.isPending || updateMut.isPending ? "Saving..." : editProd ? "✓ Update Product" : "+ Add Product"}
              </button>
            </div>
          </div>
        </div>
      </div>
      {Toast}
    </div>
  );

  /* ── Bulk Add ── */
  if (view === "bulk") return (
    <div className="min-h-screen bg-gray-50 md:bg-transparent md:min-h-0">
      <PageHeader title="Bulk Add Products" subtitle="Add multiple products at once"
        actions={<button onClick={() => setView("list")} className="h-10 px-4 bg-white/20 md:bg-gray-100 md:text-gray-700 text-white font-bold rounded-xl text-sm android-press min-h-0">← Back</button>}
      />
      <div className="px-4 py-4 space-y-4 md:px-0 md:py-4">
        <div className={CARD}>
          <div className="grid grid-cols-12 px-3 py-2.5 bg-gray-50 border-b border-gray-100">
            {["Name *","Price *","Category","Stock",""].map((h,i) => (
              <p key={i} className={`text-[10px] font-extrabold text-gray-400 uppercase tracking-widest ${i===0?"col-span-4":i===1?"col-span-2":i===2?"col-span-3":i===3?"col-span-2":"col-span-1"}`}>{h}</p>
            ))}
          </div>
          {bulkRows.map((row, i) => (
            <div key={i} className="grid grid-cols-12 gap-1 px-2 py-2 border-b border-gray-50 last:border-0">
              <input className="col-span-4 h-10 px-2 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:border-orange-400 text-xs" value={row.name} onChange={e => setBulkRows(r => r.map((x,j) => j===i ? {...x,name:e.target.value} : x))} placeholder="Name"/>
              <input className="col-span-2 h-10 px-2 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:border-orange-400 text-xs" type="number" inputMode="numeric" value={row.price} onChange={e => setBulkRows(r => r.map((x,j) => j===i ? {...x,price:e.target.value} : x))} placeholder="Rs."/>
              <input className="col-span-3 h-10 px-2 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:border-orange-400 text-xs" value={row.category} onChange={e => setBulkRows(r => r.map((x,j) => j===i ? {...x,category:e.target.value} : x))} placeholder="cat"/>
              <input className="col-span-2 h-10 px-2 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:border-orange-400 text-xs" type="number" inputMode="numeric" value={row.stock} onChange={e => setBulkRows(r => r.map((x,j) => j===i ? {...x,stock:e.target.value} : x))} placeholder="qty"/>
              <button onClick={() => setBulkRows(r => r.filter((_,j) => j!==i))} className="col-span-1 text-red-400 font-bold flex items-center justify-center text-lg min-h-0">✕</button>
            </div>
          ))}
        </div>
        <button onClick={() => setBulkRows(r => [...r, {...EMPTY_ROW}])} className="w-full h-12 border-2 border-dashed border-orange-300 text-orange-500 font-bold rounded-2xl text-sm android-press">+ Add Row</button>
        <div className="flex gap-3">
          <button onClick={() => setView("list")} className={BTN_SECONDARY}>Cancel</button>
          <button onClick={() => bulkMut.mutate()} disabled={bulkMut.isPending || bulkRows.filter(r => r.name && r.price).length === 0} className={BTN_PRIMARY}>
            {bulkMut.isPending ? "Adding..." : `Add ${bulkRows.filter(r => r.name && r.price).length} Products`}
          </button>
        </div>
      </div>
      {Toast}
    </div>
  );

  /* ── Product List ── */
  return (
    <div className="min-h-screen bg-gray-50 md:bg-transparent md:min-h-0">
      <PageHeader
        title="Products"
        subtitle={`${products.length} item${products.length !== 1 ? "s" : ""}`}
        actions={
          <div className="flex gap-2">
            <button onClick={() => setView("bulk")} className="h-9 px-3.5 bg-white/20 md:bg-gray-100 md:text-gray-700 text-white text-xs font-bold rounded-xl android-press min-h-0">Bulk Add</button>
            <button onClick={() => setShowAdd(true)} className="h-9 px-3.5 bg-white text-orange-500 md:bg-orange-500 md:text-white text-sm font-bold rounded-xl android-press min-h-0">+ Add</button>
          </div>
        }
        mobileContent={
          <input type="search" placeholder="🔍  Search products..." value={search} onChange={e => setSearch(e.target.value)}
            className="w-full h-11 px-4 bg-white/20 text-white placeholder-orange-200 rounded-2xl focus:outline-none focus:bg-white focus:text-gray-800 focus:placeholder-gray-400 transition-all text-base"/>
        }
      />

      {/* Desktop search */}
      <div className="hidden md:block px-0 py-3">
        <input type="search" placeholder="🔍 Search products..." value={search} onChange={e => setSearch(e.target.value)}
          className="w-full h-11 px-4 bg-white border border-gray-200 rounded-xl focus:outline-none focus:border-orange-400 text-sm"/>
      </div>

      {/* Category Chips */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10 md:static md:border-0 md:bg-transparent md:mt-2">
        <div className="flex gap-2 px-4 py-2.5 md:px-0 overflow-x-auto">
          {categories.map(c => (
            <button key={c} onClick={() => setFilterCat(c)}
              className={`h-8 px-3.5 rounded-full text-xs font-bold whitespace-nowrap capitalize android-press min-h-0 flex-shrink-0 transition-all
                ${filterCat === c ? "bg-orange-500 text-white" : "bg-gray-100 text-gray-600 hover:bg-orange-50"}`}>
              {c}
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 py-4 space-y-3 md:px-0 md:py-4">
        {lowStock.length > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-2xl px-4 py-3 flex items-center gap-3">
            <span className="text-xl">⚠️</span>
            <div>
              <p className="text-sm font-bold text-red-700">{lowStock.length} product{lowStock.length>1?"s":""} low on stock</p>
              <p className="text-xs text-red-500 mt-0.5">Edit products to update stock levels</p>
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="md:grid md:grid-cols-2 lg:grid-cols-3 md:gap-4 space-y-3 md:space-y-0">
            {[1,2,3,4].map(i => <div key={i} className="h-24 skeleton rounded-2xl"/>)}
          </div>
        ) : products.length === 0 ? (
          <div className={`${CARD} px-4 py-16 text-center`}>
            <p className="text-5xl mb-4">🍽️</p>
            <p className="font-bold text-gray-700 text-base">{search ? "No matching products" : "No products yet"}</p>
            <p className="text-sm text-gray-400 mt-1">{search ? "Try a different search" : "Add your first product"}</p>
            {!search && <button onClick={() => setShowAdd(true)} className="mt-5 h-12 px-8 bg-orange-500 text-white font-bold rounded-2xl android-press">+ Add First Product</button>}
          </div>
        ) : (
          <div className="md:grid md:grid-cols-2 lg:grid-cols-3 md:gap-4 space-y-3 md:space-y-0">
            {products.map(p => (
              <div key={p.id} className={`${CARD}${!p.inStock ? " opacity-60" : ""}`}>
                <div className="p-4 flex items-start gap-3">
                  {p.image
                    ? <img src={p.image} alt={p.name} className="w-16 h-16 rounded-xl object-cover flex-shrink-0 bg-gray-100"/>
                    : <div className="w-16 h-16 rounded-xl bg-orange-50 flex items-center justify-center text-2xl flex-shrink-0">🍽️</div>
                  }
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-bold text-gray-800 text-sm leading-snug">{p.name}</p>
                        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                          {p.category && <span className="text-[10px] bg-orange-50 text-orange-600 font-bold px-2 py-0.5 rounded-full capitalize">{p.category}</span>}
                          {p.unit && <span className="text-[10px] text-gray-400">/{p.unit}</span>}
                          {p.stock != null && (
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${p.stock < 10 ? "bg-red-100 text-red-600" : "bg-green-100 text-green-700"}`}>
                              {p.stock < 10 ? `⚠️ ${p.stock} left` : `${p.stock} in stock`}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="font-extrabold text-orange-600 text-base">{fc(p.price)}</p>
                        {p.originalPrice && p.originalPrice > p.price && <p className="text-[10px] text-gray-400 line-through">{fc(p.originalPrice)}</p>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 mt-2.5">
                      <button onClick={() => toggleMut.mutate({ id: p.id, inStock: !p.inStock })}
                        className={`h-8 px-3 text-xs font-bold rounded-xl android-press min-h-0 ${p.inStock ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                        {p.inStock ? "✓ In Stock" : "✗ Out"}
                      </button>
                      <button onClick={() => openEdit(p)} className="h-8 px-3 bg-blue-50 text-blue-600 text-xs font-bold rounded-xl android-press min-h-0">✏️ Edit</button>
                      <button onClick={() => deleteMut.mutate(p.id)} className="h-8 px-3 bg-red-50 text-red-600 text-xs font-bold rounded-xl android-press min-h-0">🗑️</button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {Toast}
    </div>
  );
}
