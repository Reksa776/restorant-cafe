"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  menuService,
  type Category,
  type Product,
  type ProductWithCustomization,
  type OptionGroup,
  type ProductOption,
  type ProductAddon,
} from "@/services/menu.service";
import { Plus, Pencil, Trash2, ToggleLeft, ToggleRight, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";
import { useRealtimeListener } from "@/components/admin/realtime-provider";
import { REALTIME_EVENT_TYPES } from "@/lib/realtime/types";
import {
  ProductImageField,
  productImageValueFromUrl,
  type ProductImageValue,
} from "@/components/admin/product-image-field";

// ============================================================
// Helpers
// ============================================================

function formatPrice(n: number): string {
  return `Rp${n.toLocaleString("id-ID")}`;
}

// ============================================================
// Main Page
// ============================================================

export default function MenuPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Category form state
  const [isCategoryDialogOpen, setIsCategoryDialogOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [categoryForm, setCategoryForm] = useState({ name: "", description: "" });

  // Product form state
  const [isProductDialogOpen, setIsProductDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [productForm, setProductForm] = useState({ name: "", description: "", price: "", categoryId: "" });
  // Product image: upload / URL / keep-existing / remove (see ProductImageValue)
  const [productImage, setProductImage] = useState<ProductImageValue>({ kind: "empty" });

  // Customization state
  const [customizingProduct, setCustomizingProduct] = useState<ProductWithCustomization | null>(null);
  const [activeTab, setActiveTab] = useState<"general" | "customization">("general");

  // Option Group dialog
  const [isGroupDialogOpen, setIsGroupDialogOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<OptionGroup | null>(null);
  const [groupForm, setGroupForm] = useState({
    name: "", type: "SINGLE", isRequired: true, minSelect: 1, maxSelect: 1, sortOrder: 0,
  });

  // Option dialog
  const [isOptionDialogOpen, setIsOptionDialogOpen] = useState(false);
  const [editingOption, setEditingOption] = useState<ProductOption | null>(null);
  const [optionGroupId, setOptionGroupId] = useState("");
  const [optionForm, setOptionForm] = useState({ name: "", priceAdjustment: 0, sortOrder: 0 });

  // Addon dialog
  const [isAddonDialogOpen, setIsAddonDialogOpen] = useState(false);
  const [editingAddon, setEditingAddon] = useState<ProductAddon | null>(null);
  const [addonForm, setAddonForm] = useState({ name: "", price: 0, sortOrder: 0 });

  const loadData = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true);
    try {
      const [cats, prods] = await Promise.all([
        menuService.getCategories(),
        menuService.getProducts(),
      ]);
      setCategories(cats);
      setProducts(prods);
    } catch (error) {
      console.error("Failed to load menu data:", error);
      toast.error("Gagal memuat data menu");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Realtime: another admin (or an availability toggle) changed products or
  // categories → refresh the list without reloading the page. The current
  // tab (categories/products) is preserved because loadData() only swaps the
  // underlying arrays, not the view state.
  useRealtimeListener(
    [
      REALTIME_EVENT_TYPES.PRODUCT_CREATED,
      REALTIME_EVENT_TYPES.PRODUCT_UPDATED,
      REALTIME_EVENT_TYPES.PRODUCT_DELETED,
      REALTIME_EVENT_TYPES.CATEGORY_CREATED,
      REALTIME_EVENT_TYPES.CATEGORY_UPDATED,
      REALTIME_EVENT_TYPES.CATEGORY_DELETED,
      REALTIME_EVENT_TYPES.OFFLINE_POLL,
    ],
    () => {
      if (!isLoading) loadData(true);
    }
  );

  // Refresh customization data for the currently editing product
  const refreshCustomization = useCallback(async () => {
    if (!customizingProduct) return;
    try {
      const fresh = await menuService.getProductWithCustomization(customizingProduct.id);
      setCustomizingProduct(fresh);
    } catch {
      // ignore
    }
  }, [customizingProduct]);

  // ============================================================
  // Category handlers
  // ============================================================

  const handleSaveCategory = async () => {
    try {
      if (editingCategory) {
        await menuService.updateCategory(editingCategory.id, categoryForm);
        toast.success("Kategori berhasil diupdate");
      } else {
        await menuService.createCategory(categoryForm);
        toast.success("Kategori berhasil dibuat");
      }
      setIsCategoryDialogOpen(false);
      setEditingCategory(null);
      setCategoryForm({ name: "", description: "" });
      loadData();
    } catch (error) {
      console.error("Failed to save category:", error);
      toast.error("Gagal menyimpan kategori");
    }
  };

  const handleDeleteCategory = async (id: string) => {
    if (!confirm("Hapus kategori ini?")) return;
    try {
      await menuService.deleteCategory(id);
      toast.success("Kategori berhasil dihapus");
      loadData();
    } catch (error) {
      console.error("Failed to delete category:", error);
      toast.error("Gagal menghapus kategori");
    }
  };

  // ============================================================
  // Product handlers
  // ============================================================

  const handleSaveProduct = async () => {
    try {
      const price = parseFloat(productForm.price);
      if (isNaN(price) || price < 0) {
        toast.error("Harga produk tidak valid");
        return;
      }

      // Resolve the image payload from the current image state:
      //  - saved → omit imageUrl  (edit: server keeps the existing image)
      //  - empty → null           (no image / remove existing)
      //  - url   → trimmed URL    (server re-validates)
      //  - file  → upload first, store the returned URL
      const imagePayload: { imageUrl?: string | null } = {};
      switch (productImage.kind) {
        case "saved":
          break;
        case "empty":
          imagePayload.imageUrl = null;
          break;
        case "url": {
          const trimmed = productImage.url.trim();
          if (!trimmed) {
            toast.error("URL gambar tidak valid");
            return;
          }
          imagePayload.imageUrl = trimmed;
          break;
        }
        case "file": {
          try {
            const uploaded = await menuService.uploadProductImage(productImage.file);
            imagePayload.imageUrl = uploaded.url;
          } catch (err) {
            console.error("Image upload failed:", err);
            toast.error("Gagal mengupload gambar. Periksa tipe dan ukuran file.");
            return;
          }
          break;
        }
      }

      const data = {
        categoryId: productForm.categoryId,
        name: productForm.name,
        description: productForm.description || undefined,
        price,
        ...imagePayload,
      };

      if (editingProduct) {
        await menuService.updateProduct(editingProduct.id, data);
        toast.success("Produk berhasil diupdate");
      } else {
        await menuService.createProduct(data);
        toast.success("Produk berhasil dibuat");
      }
      setIsProductDialogOpen(false);
      setEditingProduct(null);
      setProductForm({ name: "", description: "", price: "", categoryId: "" });
      setProductImage({ kind: "empty" });
      loadData();
    } catch (error) {
      console.error("Failed to save product:", error);
      toast.error("Gagal menyimpan produk");
    }
  };

  const handleToggleAvailability = async (id: string) => {
    try {
      await menuService.toggleProductAvailability(id);
      toast.success("Ketersediaan produk berhasil diubah");
      loadData();
    } catch (error) {
      console.error("Failed to toggle availability:", error);
      toast.error("Gagal mengubah ketersediaan produk");
    }
  };

  const handleDeleteProduct = async (id: string) => {
    if (!confirm("Hapus produk ini?")) return;
    try {
      await menuService.deleteProduct(id);
      toast.success("Produk berhasil dihapus");
      loadData();
    } catch (error) {
      console.error("Failed to delete product:", error);
      toast.error("Gagal menghapus produk");
    }
  };

  // Open customization for a product
  const handleOpenCustomization = async (prod: Product) => {
    try {
      const full = await menuService.getProductWithCustomization(prod.id);
      setCustomizingProduct(full);
      setActiveTab("customization");
    } catch (error) {
      console.error("Failed to load product customization:", error);
      toast.error("Gagal memuat data kustomisasi");
    }
  };

  // ============================================================
  // Option Group handlers
  // ============================================================

  const handleSaveGroup = async () => {
    if (!customizingProduct) return;
    try {
      if (editingGroup) {
        await menuService.updateOptionGroup(customizingProduct.id, editingGroup.id, groupForm);
        toast.success("Group berhasil diupdate");
      } else {
        await menuService.createOptionGroup(customizingProduct.id, groupForm);
        toast.success("Group berhasil dibuat");
      }
      setIsGroupDialogOpen(false);
      setEditingGroup(null);
      setGroupForm({ name: "", type: "SINGLE", isRequired: true, minSelect: 1, maxSelect: 1, sortOrder: 0 });
      refreshCustomization();
    } catch (error) {
      console.error("Failed to save group:", error);
      toast.error("Gagal menyimpan group");
    }
  };

  const handleDeleteGroup = async (groupId: string) => {
    if (!customizingProduct) return;
    if (!confirm("Hapus option group ini? Semua option di dalamnya juga akan dihapus.")) return;
    try {
      await menuService.deleteOptionGroup(customizingProduct.id, groupId);
      toast.success("Group berhasil dihapus");
      refreshCustomization();
    } catch (error) {
      console.error("Failed to delete group:", error);
      toast.error("Gagal menghapus group");
    }
  };

  const handleToggleGroup = async (group: OptionGroup) => {
    if (!customizingProduct) return;
    try {
      await menuService.updateOptionGroup(customizingProduct.id, group.id, { isActive: !group.isActive });
      toast.success(group.isActive ? "Group dinonaktifkan" : "Group diaktifkan");
      refreshCustomization();
    } catch (error) {
      console.error("Failed to toggle group:", error);
      toast.error("Gagal mengubah status group");
    }
  };

  // ============================================================
  // Option handlers
  // ============================================================

  const handleSaveOption = async () => {
    if (!customizingProduct) return;
    try {
      if (editingOption) {
        await menuService.updateOption(optionGroupId, editingOption.id, optionForm);
        toast.success("Option berhasil diupdate");
      } else {
        await menuService.createOption(optionGroupId, optionForm);
        toast.success("Option berhasil dibuat");
      }
      setIsOptionDialogOpen(false);
      setEditingOption(null);
      setOptionForm({ name: "", priceAdjustment: 0, sortOrder: 0 });
      refreshCustomization();
    } catch (error) {
      console.error("Failed to save option:", error);
      toast.error("Gagal menyimpan option");
    }
  };

  const handleDeleteOption = async (groupId: string, optionId: string) => {
    if (!confirm("Hapus option ini?")) return;
    try {
      await menuService.deleteOption(groupId, optionId);
      toast.success("Option berhasil dihapus");
      refreshCustomization();
    } catch (error) {
      console.error("Failed to delete option:", error);
      toast.error("Gagal menghapus option");
    }
  };

  const handleToggleOption = async (groupId: string, option: ProductOption) => {
    try {
      await menuService.updateOption(groupId, option.id, { isActive: !option.isActive });
      toast.success(option.isActive ? "Option dinonaktifkan" : "Option diaktifkan");
      refreshCustomization();
    } catch (error) {
      console.error("Failed to toggle option:", error);
      toast.error("Gagal mengubah status option");
    }
  };

  // ============================================================
  // Addon handlers
  // ============================================================

  const handleSaveAddon = async () => {
    if (!customizingProduct) return;
    try {
      if (editingAddon) {
        await menuService.updateAddon(customizingProduct.id, editingAddon.id, addonForm);
        toast.success("Addon berhasil diupdate");
      } else {
        await menuService.createAddon(customizingProduct.id, addonForm);
        toast.success("Addon berhasil dibuat");
      }
      setIsAddonDialogOpen(false);
      setEditingAddon(null);
      setAddonForm({ name: "", price: 0, sortOrder: 0 });
      refreshCustomization();
    } catch (error) {
      console.error("Failed to save addon:", error);
      toast.error("Gagal menyimpan addon");
    }
  };

  const handleDeleteAddon = async (addonId: string) => {
    if (!confirm("Hapus addon ini?")) return;
    if (!customizingProduct) return;
    try {
      await menuService.deleteAddon(customizingProduct.id, addonId);
      toast.success("Addon berhasil dihapus");
      refreshCustomization();
    } catch (error) {
      console.error("Failed to delete addon:", error);
      toast.error("Gagal menghapus addon");
    }
  };

  const handleToggleAddon = async (addon: ProductAddon) => {
    if (!customizingProduct) return;
    try {
      await menuService.updateAddon(customizingProduct.id, addon.id, { isActive: !addon.isActive });
      toast.success(addon.isActive ? "Addon dinonaktifkan" : "Addon diaktifkan");
      refreshCustomization();
    } catch (error) {
      console.error("Failed to toggle addon:", error);
      toast.error("Gagal mengubah status addon");
    }
  };

  // ============================================================
  // Render
  // ============================================================

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Menu</h1>
        <p className="text-gray-500">Kelola menu restoran</p>
      </div>

      {/* If customizing a product, show customization view */}
      {customizingProduct ? (
        <CustomizationView
          product={customizingProduct}
          onBack={() => { setCustomizingProduct(null); loadData(); }}
          onEditGroup={(group) => {
            setEditingGroup(group);
            setGroupForm({
              name: group.name,
              type: group.type,
              isRequired: group.isRequired,
              minSelect: group.minSelect,
              maxSelect: group.maxSelect,
              sortOrder: group.sortOrder,
            });
            setIsGroupDialogOpen(true);
          }}
          onAddGroup={() => {
            setEditingGroup(null);
            setGroupForm({ name: "", type: "SINGLE", isRequired: true, minSelect: 1, maxSelect: 1, sortOrder: 0 });
            setIsGroupDialogOpen(true);
          }}
          onDeleteGroup={handleDeleteGroup}
          onToggleGroup={handleToggleGroup}
          onEditOption={(groupId, option) => {
            setOptionGroupId(groupId);
            setEditingOption(option);
            setOptionForm({ name: option.name, priceAdjustment: option.priceAdjustment, sortOrder: option.sortOrder });
            setIsOptionDialogOpen(true);
          }}
          onAddOption={(groupId) => {
            setOptionGroupId(groupId);
            setEditingOption(null);
            setOptionForm({ name: "", priceAdjustment: 0, sortOrder: 0 });
            setIsOptionDialogOpen(true);
          }}
          onDeleteOption={handleDeleteOption}
          onToggleOption={handleToggleOption}
          onEditAddon={(addon) => {
            setEditingAddon(addon);
            setAddonForm({ name: addon.name, price: addon.price, sortOrder: addon.sortOrder });
            setIsAddonDialogOpen(true);
          }}
          onAddAddon={() => {
            setEditingAddon(null);
            setAddonForm({ name: "", price: 0, sortOrder: 0 });
            setIsAddonDialogOpen(true);
          }}
          onDeleteAddon={handleDeleteAddon}
          onToggleAddon={handleToggleAddon}
        />
      ) : (
        <Tabs defaultValue="categories">
          <TabsList>
            <TabsTrigger value="categories">Kategori</TabsTrigger>
            <TabsTrigger value="products">Produk</TabsTrigger>
          </TabsList>

          {/* Categories Tab */}
          <TabsContent value="categories">
            <Card>
              <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <CardTitle>Kategori</CardTitle>
                <Button onClick={() => { setEditingCategory(null); setCategoryForm({ name: "", description: "" }); setIsCategoryDialogOpen(true); }}>
                  <Plus className="h-4 w-4 mr-2" /> Tambah Kategori
                </Button>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <p className="text-center text-gray-500 py-8">Loading...</p>
                ) : categories.length === 0 ? (
                  <p className="text-center text-gray-500 py-8">Belum ada kategori</p>
                ) : (
                  <div className="space-y-2">
                    {categories.map((cat) => (
                      <div key={cat.id} className="flex flex-col gap-2 border-b pb-2 last:border-0 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="font-medium">{cat.name}</p>
                          <p className="text-sm text-gray-500">{cat.productCount || 0} produk</p>
                        </div>
                        <div className="flex shrink-0 gap-2">
                          <Button variant="outline" size="sm" onClick={() => { setEditingCategory(cat); setCategoryForm({ name: cat.name, description: cat.description || "" }); setIsCategoryDialogOpen(true); }}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button variant="destructive" size="sm" onClick={() => handleDeleteCategory(cat.id)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Products Tab */}
          <TabsContent value="products">
            <Card>
              <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <CardTitle>Produk</CardTitle>
                <Button onClick={() => { setEditingProduct(null); setProductForm({ name: "", description: "", price: "", categoryId: categories[0]?.id || "" }); setProductImage({ kind: "empty" }); setIsProductDialogOpen(true); }}>
                  <Plus className="h-4 w-4 mr-2" /> Tambah Produk
                </Button>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <p className="text-center text-gray-500 py-8">Loading...</p>
                ) : products.length === 0 ? (
                  <p className="text-center text-gray-500 py-8">Belum ada produk</p>
                ) : (
                  <div className="space-y-2">
                    {products.map((prod) => (
                      <div key={prod.id} className="flex flex-col gap-2 border-b pb-2 last:border-0 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <ProductThumb url={prod.imageUrl} name={prod.name} />
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="font-medium">{prod.name}</p>
                                <Badge variant="outline">{prod.category.name}</Badge>
                                {!prod.isAvailable && <Badge variant="destructive">Tidak Tersedia</Badge>}
                              </div>
                              <p className="text-sm text-gray-500">{formatPrice(Number(prod.price))}</p>
                            </div>
                          </div>
                        </div>
                        <div className="flex flex-wrap shrink-0 gap-1.5 sm:gap-2">
                          <Button variant="outline" size="sm" onClick={() => handleToggleAvailability(prod.id)}>
                            {prod.isAvailable ? <ToggleRight className="h-4 w-4" /> : <ToggleLeft className="h-4 w-4" />}
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => handleOpenCustomization(prod)}>
                            Kustomisasi
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => { setEditingProduct(prod); setProductForm({ name: prod.name, description: prod.description || "", price: prod.price.toString(), categoryId: prod.category.id }); setProductImage(productImageValueFromUrl(prod.imageUrl)); setIsProductDialogOpen(true); }}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button variant="destructive" size="sm" onClick={() => handleDeleteProduct(prod.id)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}

      {/* Category Dialog */}
      <Dialog open={isCategoryDialogOpen} onOpenChange={setIsCategoryDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingCategory ? "Edit Kategori" : "Tambah Kategori"}</DialogTitle>
            <DialogDescription>{editingCategory ? "Ubah informasi kategori" : "Tambahkan kategori baru"}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="catName">Nama</Label>
              <Input id="catName" value={categoryForm.name} onChange={(e) => setCategoryForm({ ...categoryForm, name: e.target.value })} placeholder="Nama kategori" />
            </div>
            <div>
              <Label htmlFor="catDesc">Deskripsi</Label>
              <Textarea id="catDesc" value={categoryForm.description} onChange={(e) => setCategoryForm({ ...categoryForm, description: e.target.value })} placeholder="Deskripsi kategori (opsional)" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCategoryDialogOpen(false)}>Batal</Button>
            <Button onClick={handleSaveCategory}>Simpan</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Product Dialog */}
      <Dialog open={isProductDialogOpen} onOpenChange={setIsProductDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingProduct ? "Edit Produk" : "Tambah Produk"}</DialogTitle>
            <DialogDescription>{editingProduct ? "Ubah informasi produk" : "Tambahkan produk baru"}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="prodName">Nama</Label>
              <Input id="prodName" value={productForm.name} onChange={(e) => setProductForm({ ...productForm, name: e.target.value })} placeholder="Nama produk" />
            </div>
            <div>
              <Label htmlFor="prodDesc">Deskripsi</Label>
              <Textarea id="prodDesc" value={productForm.description} onChange={(e) => setProductForm({ ...productForm, description: e.target.value })} placeholder="Deskripsi produk (opsional)" />
            </div>
            <div>
              <Label htmlFor="prodPrice">Harga (Rp)</Label>
              <Input id="prodPrice" type="number" value={productForm.price} onChange={(e) => setProductForm({ ...productForm, price: e.target.value ?? "" })} placeholder="Harga produk" />
            </div>
            <div>
              <Label htmlFor="prodCategory">Kategori</Label>
              <Select value={productForm.categoryId} onValueChange={(value) => setProductForm({ ...productForm, categoryId: value || "" })}>
                <SelectTrigger><SelectValue placeholder="Pilih kategori" /></SelectTrigger>
                <SelectContent>
                  {categories.map((cat) => (<SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            {/* Product image — upload from device or external URL */}
            <div>
              <ProductImageField value={productImage} onChange={setProductImage} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsProductDialogOpen(false)}>Batal</Button>
            <Button onClick={handleSaveProduct}>Simpan</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Option Group Dialog */}
      <Dialog open={isGroupDialogOpen} onOpenChange={setIsGroupDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingGroup ? "Edit Option Group" : "Tambah Option Group"}</DialogTitle>
            <DialogDescription>{editingGroup ? "Ubah konfigurasi group" : "Tambahkan group opsi baru"}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Nama Group</Label>
              <Input value={groupForm.name} onChange={(e) => setGroupForm({ ...groupForm, name: e.target.value })} placeholder="Contoh: Ukuran, Gula, Espresso" />
            </div>
            <div>
              <Label>Tipe Seleksi</Label>
              <Select value={groupForm.type} onValueChange={(v) => {
                if (!v) return;
                const isSingle = v === "SINGLE";
                setGroupForm({
                  ...groupForm,
                  type: v,
                  maxSelect: isSingle ? 1 : groupForm.maxSelect,
                  minSelect: groupForm.isRequired ? (isSingle ? 1 : groupForm.minSelect) : 0,
                });
              }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="SINGLE">Single (Pilih 1)</SelectItem>
                  <SelectItem value="MULTI">Multi (Pilih Banyak)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={groupForm.isRequired}
                  onChange={(e) => setGroupForm({ ...groupForm, isRequired: e.target.checked, minSelect: e.target.checked ? 1 : 0 })}
                  className="rounded border-gray-300"
                />
                Wajib dipilih
              </label>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Min Pilihan</Label>
                <Input type="number" min={0} value={groupForm.minSelect} onChange={(e) => setGroupForm({ ...groupForm, minSelect: parseInt(e.target.value) || 0 })} />
              </div>
              <div>
                <Label>Max Pilihan</Label>
                <Input type="number" min={1} value={groupForm.maxSelect} onChange={(e) => setGroupForm({ ...groupForm, maxSelect: parseInt(e.target.value) || 1 })} />
              </div>
            </div>
            <div>
              <Label>Urutan</Label>
              <Input type="number" value={groupForm.sortOrder} onChange={(e) => setGroupForm({ ...groupForm, sortOrder: parseInt(e.target.value) || 0 })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsGroupDialogOpen(false)}>Batal</Button>
            <Button onClick={handleSaveGroup}>Simpan</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Option Dialog */}
      <Dialog open={isOptionDialogOpen} onOpenChange={setIsOptionDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingOption ? "Edit Option" : "Tambah Option"}</DialogTitle>
            <DialogDescription>{editingOption ? "Ubah opsi" : "Tambahkan opsi baru"}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Nama Option</Label>
              <Input value={optionForm.name} onChange={(e) => setOptionForm({ ...optionForm, name: e.target.value })} placeholder="Contoh: Small, Large, Extra" />
            </div>
            <div>
              <Label>Penyesuaian Harga (Rp)</Label>
              <Input type="number" value={optionForm.priceAdjustment} onChange={(e) => setOptionForm({ ...optionForm, priceAdjustment: parseInt(e.target.value) || 0 })} placeholder="0 = tidak ada tambahan harga" />
              <p className="text-xs text-gray-400 mt-1">Positif = tambah harga, Negatif = kurangi harga</p>
            </div>
            <div>
              <Label>Urutan</Label>
              <Input type="number" value={optionForm.sortOrder} onChange={(e) => setOptionForm({ ...optionForm, sortOrder: parseInt(e.target.value) || 0 })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsOptionDialogOpen(false)}>Batal</Button>
            <Button onClick={handleSaveOption}>Simpan</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Addon Dialog */}
      <Dialog open={isAddonDialogOpen} onOpenChange={setIsAddonDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingAddon ? "Edit Addon" : "Tambah Addon"}</DialogTitle>
            <DialogDescription>{editingAddon ? "Ubah addon" : "Tambahkan addon baru"}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Nama Addon</Label>
              <Input value={addonForm.name} onChange={(e) => setAddonForm({ ...addonForm, name: e.target.value })} placeholder="Contoh: Extra Shot, Cheese Foam" />
            </div>
            <div>
              <Label>Harga (Rp)</Label>
              <Input type="number" value={addonForm.price} onChange={(e) => setAddonForm({ ...addonForm, price: parseInt(e.target.value) || 0 })} />
            </div>
            <div>
              <Label>Urutan</Label>
              <Input type="number" value={addonForm.sortOrder} onChange={(e) => setAddonForm({ ...addonForm, sortOrder: parseInt(e.target.value) || 0 })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddonDialogOpen(false)}>Batal</Button>
            <Button onClick={handleSaveAddon}>Simpan</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ============================================================
// Product Thumbnail (admin product list)
// ============================================================

function ProductThumb({ url, name }: { url?: string; name: string }) {
  const [broken, setBroken] = useState(false);
  if (!url || broken) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={name}
      className="h-9 w-9 shrink-0 rounded object-cover bg-gray-100"
      onError={() => setBroken(true)}
    />
  );
}

// ============================================================
// Customization View Component
// ============================================================

interface CustomizationViewProps {
  product: ProductWithCustomization;
  onBack: () => void;
  onEditGroup: (group: OptionGroup) => void;
  onAddGroup: () => void;
  onDeleteGroup: (groupId: string) => void;
  onToggleGroup: (group: OptionGroup) => void;
  onEditOption: (groupId: string, option: ProductOption) => void;
  onAddOption: (groupId: string) => void;
  onDeleteOption: (groupId: string, optionId: string) => void;
  onToggleOption: (groupId: string, option: ProductOption) => void;
  onEditAddon: (addon: ProductAddon) => void;
  onAddAddon: () => void;
  onDeleteAddon: (addonId: string) => void;
  onToggleAddon: (addon: ProductAddon) => void;
}

function CustomizationView({
  product,
  onBack,
  onEditGroup,
  onAddGroup,
  onDeleteGroup,
  onToggleGroup,
  onEditOption,
  onAddOption,
  onDeleteOption,
  onToggleOption,
  onEditAddon,
  onAddAddon,
  onDeleteAddon,
  onToggleAddon,
}: CustomizationViewProps) {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  const toggleExpand = (groupId: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={onBack}>← Kembali</Button>
        <div>
          <h2 className="text-xl font-bold">{product.name}</h2>
          <p className="text-sm text-gray-500">
            {formatPrice(Number(product.price))} · {product.category.name}
          </p>
        </div>
      </div>

      {/* Option Groups */}
      <Card>
        <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="text-base">Option Groups</CardTitle>
          <Button size="sm" onClick={onAddGroup} className="w-full sm:w-auto">
            <Plus className="h-4 w-4 mr-1" /> Tambah Group
          </Button>
        </CardHeader>
        <CardContent>
          {product.optionGroups.length === 0 ? (
            <p className="text-center text-gray-400 py-6 text-sm">
              Belum ada option group. Tambahkan group untuk mengaktifkan kustomisasi produk.
            </p>
          ) : (
            <div className="space-y-3">
              {product.optionGroups.map((group) => {
                const isExpanded = expandedGroups.has(group.id);
                return (
                  <div key={group.id} className="border rounded-lg overflow-hidden">
                    {/* Group Header */}
                    <div className="flex flex-wrap items-center justify-between gap-2 p-3 bg-gray-50">
                      <div className="flex flex-wrap items-center gap-2 min-w-0">
                        <button onClick={() => toggleExpand(group.id)} className="text-gray-500 hover:text-gray-700" aria-label={isExpanded ? "Ciutkan group" : "Bentangkan group"}>
                          {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </button>
                        <span className="font-medium text-sm">{group.name}</span>
                        <Badge variant={group.isActive ? "default" : "secondary"} className="text-[10px]">
                          {group.isActive ? "Active" : "Inactive"}
                        </Badge>
                        <Badge variant="outline" className="text-[10px]">{group.type}</Badge>
                        {group.isRequired && <Badge variant="outline" className="text-[10px]">Wajib</Badge>}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button variant="ghost" size="sm" onClick={() => onToggleGroup(group)}>
                          {group.isActive ? <ToggleRight className="h-4 w-4" /> : <ToggleLeft className="h-4 w-4" />}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => onEditGroup(group)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => onDeleteGroup(group.id)} className="text-red-500 hover:text-red-700">
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>

                    {/* Options List (expanded) */}
                    {isExpanded && (
                      <div className="p-3 space-y-2">
                        {group.options.length === 0 ? (
                          <p className="text-xs text-gray-400 text-center py-2">Belum ada option</p>
                        ) : (
                          group.options.map((opt) => (
                            <div key={opt.id} className="flex flex-wrap items-center justify-between gap-1.5 py-1.5 px-2 rounded hover:bg-gray-50">
                              <div className="flex flex-wrap items-center gap-2 min-w-0">
                                <span className={`text-sm ${opt.isActive ? "" : "text-gray-400 line-through"}`}>{opt.name}</span>
                                {opt.priceAdjustment !== 0 && (
                                  <span className="text-xs text-gray-500">
                                    {opt.priceAdjustment > 0 ? `+${formatPrice(opt.priceAdjustment)}` : formatPrice(opt.priceAdjustment)}
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-1">
                                <Button variant="ghost" size="sm" className="h-7" onClick={() => onToggleOption(group.id, opt)}>
                                  {opt.isActive ? <ToggleRight className="h-3.5 w-3.5" /> : <ToggleLeft className="h-3.5 w-3.5" />}
                                </Button>
                                <Button variant="ghost" size="sm" className="h-7" onClick={() => onEditOption(group.id, opt)}>
                                  <Pencil className="h-3 w-3" />
                                </Button>
                                <Button variant="ghost" size="sm" className="h-7 text-red-500" onClick={() => onDeleteOption(group.id, opt.id)}>
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              </div>
                            </div>
                          ))
                        )}
                        <Button variant="outline" size="sm" className="w-full mt-2" onClick={() => onAddOption(group.id)}>
                          <Plus className="h-3.5 w-3.5 mr-1" /> Tambah Option
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Addons */}
      <Card>
        <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="text-base">Addons</CardTitle>
          <Button size="sm" onClick={onAddAddon} className="w-full sm:w-auto">
            <Plus className="h-4 w-4 mr-1" /> Tambah Addon
          </Button>
        </CardHeader>
        <CardContent>
          {product.addons.length === 0 ? (
            <p className="text-center text-gray-400 py-6 text-sm">
              Belum ada addon.
            </p>
          ) : (
            <div className="space-y-2">
              {product.addons.map((addon) => (
                <div key={addon.id} className="flex flex-wrap items-center justify-between gap-1.5 py-2 px-3 border rounded-lg">
                  <div className="flex flex-wrap items-center gap-2 min-w-0">
                    <span className={`text-sm font-medium ${addon.isActive ? "" : "text-gray-400 line-through"}`}>{addon.name}</span>
                    <span className="text-sm text-gray-500">{formatPrice(addon.price)}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="sm" onClick={() => onToggleAddon(addon)}>
                      {addon.isActive ? <ToggleRight className="h-4 w-4" /> : <ToggleLeft className="h-4 w-4" />}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => onEditAddon(addon)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => onDeleteAddon(addon.id)} className="text-red-500 hover:text-red-700">
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
