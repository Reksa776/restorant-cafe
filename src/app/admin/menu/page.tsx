"use client";

import { useEffect, useState, useCallback, useRef } from "react";
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
import {
  ingredientService,
  type Ingredient as IngredientOption,
} from "@/services/ingredient.service";
import { Plus, Pencil, Trash2, ToggleLeft, ToggleRight, ChevronDown, ChevronUp, MoveUp, MoveDown, Star, Store, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { BranchAvailabilityDialog } from "@/components/admin/branch-availability-dialog";
import { useRealtimeListener } from "@/components/admin/realtime-provider";
import { REALTIME_EVENT_TYPES } from "@/lib/realtime/types";
import {
  ProductImageField,
  productImageValueFromUrl,
  type ProductImageValue,
} from "@/components/admin/product-image-field";
import {
  recommendationService,
  type RecommendationProduct,
} from "@/services/recommendation.service";

// ============================================================
// Helpers
// ============================================================

function formatPrice(n: number): string {
  return `Rp${n.toLocaleString("id-ID")}`;
}

/**
 * Extract the backend's error message from an axios error, falling back to a
 * generic message when none is available. Keeps the real server response
 * (e.g. the 409 "Product with this name already exists in this category")
 * visible instead of hiding it behind a generic toast.
 */
function apiErrorMessage(error: unknown, fallback: string): string {
  const msg = (error as { response?: { data?: { message?: unknown } } })
    ?.response?.data?.message;
  return typeof msg === "string" && msg.trim() ? msg : fallback;
}

/**
 * One editable recipe row in the Komposisi tab of the product dialog.
 * Unit is NOT editable — it always follows the selected ingredient's
 * baseUnit (F.3 rule; no unit conversion).
 */
interface RecipeRow {
  key: string;
  ingredientId: string;
  quantity: string;
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
  // Per-branch availability / price override dialog (multi-cabang)
  const [branchAvailProduct, setBranchAvailProduct] = useState<Product | null>(null);
  // Product image: upload / URL / keep-existing / remove (see ProductImageValue)
  const [productImage, setProductImage] = useState<ProductImageValue>({ kind: "empty" });
  // In-flight guard for the product save. With the async image-upload step the
  // save is no longer instantaneous, so without a guard a second click on
  // Simpan fires a duplicate POST (first 201, second 409 — or a race that
  // persists two identical products). A ref (not just state) is used so even
  // two clicks in the same render cycle are blocked deterministically.
  const productSaveInFlight = useRef(false);
  const [isSavingProduct, setIsSavingProduct] = useState(false);

  // Customization state
  const [customizingProduct, setCustomizingProduct] = useState<ProductWithCustomization | null>(null);
  const [activeTab, setActiveTab] = useState<"general" | "customization">("general");

  // Recipe / BOM state (Komposisi tab inside the product dialog, F.3)
  const [productTab, setProductTab] = useState<"info" | "komposisi">("info");
  const [recipeIngredients, setRecipeIngredients] = useState<IngredientOption[]>([]);
  const [recipeRows, setRecipeRows] = useState<RecipeRow[]>([]);
  const [isRecipeLoading, setIsRecipeLoading] = useState(false);
  const [isRecipeSaving, setIsRecipeSaving] = useState(false);

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
    if (productSaveInFlight.current) return;
    productSaveInFlight.current = true;
    setIsSavingProduct(true);
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
      resetRecipeState();
      loadData();
    } catch (error) {
      console.error("Failed to save product:", error);
      toast.error(apiErrorMessage(error, "Gagal menyimpan produk"));
    } finally {
      productSaveInFlight.current = false;
      setIsSavingProduct(false);
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
  // Recipe / BOM handlers (Komposisi tab, F.3)
  // ============================================================

  const loadRecipeRows = async (productId: string) => {
    setIsRecipeLoading(true);
    try {
      const recipe = await menuService.getRecipe(productId);
      setRecipeRows(
        recipe && recipe.items.length
          ? recipe.items.map((it) => ({
              key: crypto.randomUUID(),
              ingredientId: it.ingredientId,
              quantity: it.quantity,
            }))
          : []
      );
    } catch (error) {
      console.error("Failed to load recipe:", error);
      toast.error("Gagal memuat komposisi");
    } finally {
      setIsRecipeLoading(false);
    }
  };

  const handleProductTabChange = (tab: string) => {
    setProductTab(tab as "info" | "komposisi");
    if (tab === "komposisi" && editingProduct) {
      if (recipeIngredients.length === 0) {
        ingredientService
          .list({ isActive: "true", limit: 100 })
          .then((res) => setRecipeIngredients(res.items))
          .catch(() => toast.error("Gagal memuat bahan baku"));
      }
      loadRecipeRows(editingProduct.id);
    }
  };

  const addRecipeRow = () => {
    if (recipeIngredients.length === 0) {
      toast.error("Belum ada bahan baku. Tambahkan bahan baku terlebih dahulu.");
      return;
    }
    setRecipeRows((rows) => [
      ...rows,
      { key: crypto.randomUUID(), ingredientId: "", quantity: "" },
    ]);
  };

  const updateRecipeRow = (key: string, patch: Partial<RecipeRow>) => {
    setRecipeRows((rows) =>
      rows.map((r) => (r.key === key ? { ...r, ...patch } : r))
    );
  };

  const removeRecipeRow = (key: string) => {
    setRecipeRows((rows) => rows.filter((r) => r.key !== key));
  };

  const resetRecipeState = () => {
    setProductTab("info");
    setRecipeRows([]);
  };

  const handleSaveRecipe = async () => {
    if (!editingProduct) return;
    const filled = recipeRows.filter(
      (r) => r.ingredientId !== "" && r.quantity.trim() !== ""
    );
    if (filled.length === 0) {
      toast.error("Tambahkan minimal 1 bahan baku");
      return;
    }
    if (filled.length !== recipeRows.length) {
      toast.error("Semua baris harus lengkap (bahan + quantity)");
      return;
    }
    const seen = new Set(filled.map((r) => r.ingredientId));
    if (seen.size !== filled.length) {
      toast.error("Bahan baku tidak boleh duplikat");
      return;
    }
    for (const r of filled) {
      if (!(Number(r.quantity) > 0)) {
        toast.error("Quantity harus lebih besar dari 0");
        return;
      }
    }
    setIsRecipeSaving(true);
    try {
      const items = filled.map((r) => {
        const ing = recipeIngredients.find((i) => i.id === r.ingredientId);
        return {
          ingredientId: r.ingredientId,
          quantity: r.quantity.trim(),
          unit: ing?.baseUnit ?? "",
        };
      });
      const recipe = await menuService.saveRecipe(editingProduct.id, items);
      toast.success("Komposisi berhasil disimpan");
      setRecipeRows(
        recipe && recipe.items.length
          ? recipe.items.map((it) => ({
              key: crypto.randomUUID(),
              ingredientId: it.ingredientId,
              quantity: it.quantity,
            }))
          : []
      );
    } catch (error) {
      console.error("Failed to save recipe:", error);
      toast.error(apiErrorMessage(error, "Gagal menyimpan komposisi"));
    } finally {
      setIsRecipeSaving(false);
    }
  };

  const handleDeleteRecipe = async () => {
    if (!editingProduct) return;
    if (!confirm("Hapus komposisi produk ini?")) return;
    try {
      await menuService.deleteRecipe(editingProduct.id);
      setRecipeRows([]);
      toast.success("Komposisi berhasil dihapus");
    } catch (error) {
      console.error("Failed to delete recipe:", error);
      toast.error(apiErrorMessage(error, "Gagal menghapus komposisi"));
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
            <TabsTrigger value="recommendations">Rekomendasi</TabsTrigger>
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
                <Button onClick={() => { setEditingProduct(null); setProductForm({ name: "", description: "", price: "", categoryId: categories[0]?.id || "" }); setProductImage({ kind: "empty" }); resetRecipeState(); setIsProductDialogOpen(true); }}>
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
                          <Button variant="outline" size="sm" title="Ketersediaan per cabang" onClick={() => setBranchAvailProduct(prod)}>
                            <Store className="h-4 w-4" />
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => handleOpenCustomization(prod)}>
                            Kustomisasi
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => { setEditingProduct(prod); setProductForm({ name: prod.name, description: prod.description || "", price: prod.price.toString(), categoryId: prod.category.id }); setProductImage(productImageValueFromUrl(prod.imageUrl)); resetRecipeState(); setIsProductDialogOpen(true); }}>
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

          {/* Recommendations Tab — F3: admin-curated, tenant-scoped */}
          <TabsContent value="recommendations">
            <RecommendationsTab />
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

      {/* Product Dialog — Info + Komposisi (recipe/BOM, F.3) tabs when editing */}
      <Dialog open={isProductDialogOpen} onOpenChange={(open) => { setIsProductDialogOpen(open); if (!open) resetRecipeState(); }}>
        <DialogContent className={editingProduct ? "sm:max-w-2xl" : "sm:max-w-md"}>
          <DialogHeader>
            <DialogTitle>{editingProduct ? "Edit Produk" : "Tambah Produk"}</DialogTitle>
            <DialogDescription>{editingProduct ? "Ubah informasi produk" : "Tambahkan produk baru"}</DialogDescription>
          </DialogHeader>

          {editingProduct ? (
            <Tabs value={productTab} onValueChange={handleProductTabChange}>
              <TabsList>
                <TabsTrigger value="info">Info</TabsTrigger>
                <TabsTrigger value="komposisi">Komposisi</TabsTrigger>
              </TabsList>

              <TabsContent value="info" className="space-y-4">
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
                    <SelectTrigger>
                      <SelectValue>
                        {categories.find((c) => c.id === productForm.categoryId)
                          ?.name ?? "Pilih kategori"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {categories.map((cat) => (<SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>))}
                    </SelectContent>
                  </Select>
                </div>
                {/* Product image — upload from device or external URL */}
                <div>
                  <ProductImageField value={productImage} onChange={setProductImage} />
                </div>
              </TabsContent>

              <TabsContent value="komposisi" className="space-y-4">
                {isRecipeLoading ? (
                  <div className="flex items-center justify-center py-8 text-gray-500">
                    <Loader2 className="h-5 w-5 animate-spin mr-2" /> Memuat komposisi...
                  </div>
                ) : recipeRows.length === 0 ? (
                  <p className="py-4 text-sm text-gray-500">
                    Belum ada komposisi. Tambahkan bahan baku untuk produk ini.
                  </p>
                ) : (
                  <div className="space-y-2">
                    <div className="grid grid-cols-[1fr_100px_100px_36px] gap-2 text-xs font-medium text-gray-500">
                      <span>Ingredient</span>
                      <span>Qty</span>
                      <span>Unit</span>
                      <span />
                    </div>
                    {recipeRows.map((row) => {
                      const usedIds = new Set(
                        recipeRows.filter((r) => r.key !== row.key).map((r) => r.ingredientId)
                      );
                      const selected = recipeIngredients.find((i) => i.id === row.ingredientId);
                      return (
                        <div key={row.key} className="grid grid-cols-[1fr_100px_100px_36px] items-center gap-2">
                          <Select
                            value={row.ingredientId || "__none__"}
                            onValueChange={(v) =>
                              updateRecipeRow(row.key, { ingredientId: v && v !== "__none__" ? v : "" })
                            }
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Pilih bahan" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none__">Pilih bahan...</SelectItem>
                              {recipeIngredients
                                .filter((i) => !usedIds.has(i.id))
                                .map((ing) => (
                                  <SelectItem key={ing.id} value={ing.id}>
                                    {ing.name} ({ing.baseUnit})
                                  </SelectItem>
                                ))}
                            </SelectContent>
                          </Select>
                          <Input
                            type="number"
                            step="any"
                            min="0"
                            inputMode="decimal"
                            value={row.quantity}
                            onChange={(e) => updateRecipeRow(row.key, { quantity: e.target.value })}
                            placeholder="0.150"
                          />
                          <div className="flex h-9 items-center justify-center rounded-md border bg-gray-50 text-sm text-gray-600">
                            {selected?.baseUnit ?? "—"}
                          </div>
                          <Button variant="ghost" size="sm" className="h-9 w-9 p-0" onClick={() => removeRecipeRow(row.key)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className="flex items-center justify-between gap-2">
                  <Button variant="outline" size="sm" onClick={addRecipeRow} disabled={isRecipeLoading || isRecipeSaving}>
                    <Plus className="h-4 w-4 mr-1" /> Tambah Bahan
                  </Button>
                  {recipeRows.length > 0 && (
                    <Button variant="ghost" size="sm" onClick={handleDeleteRecipe} disabled={isRecipeSaving}>
                      <Trash2 className="h-4 w-4 mr-1" /> Hapus Komposisi
                    </Button>
                  )}
                </div>

                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setProductTab("info")}>Batal</Button>
                  <Button onClick={handleSaveRecipe} disabled={isRecipeLoading || isRecipeSaving}>
                    {isRecipeSaving && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
                    Simpan
                  </Button>
                </div>
              </TabsContent>
            </Tabs>
          ) : (
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
                  <SelectTrigger>
                    <SelectValue>
                      {categories.find((c) => c.id === productForm.categoryId)
                        ?.name ?? "Pilih kategori"}
                    </SelectValue>
                  </SelectTrigger>
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
          )}

          {(!editingProduct || productTab === "info") && (
            <DialogFooter>
              <Button variant="outline" disabled={isSavingProduct} onClick={() => { setIsProductDialogOpen(false); resetRecipeState(); }}>Batal</Button>
              <Button onClick={handleSaveProduct} disabled={isSavingProduct}>Simpan</Button>
            </DialogFooter>
          )}
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
                <SelectTrigger>
                  <SelectValue>
                    {groupForm.type === "SINGLE"
                      ? "Single (Pilih 1)"
                      : groupForm.type === "MULTI"
                        ? "Multi (Pilih Banyak)"
                        : "Pilih tipe"}
                  </SelectValue>
                </SelectTrigger>
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

      {/* Per-branch availability / price override dialog */}
      <BranchAvailabilityDialog
        product={
          branchAvailProduct
            ? {
                id: branchAvailProduct.id,
                name: branchAvailProduct.name,
                price: Number(branchAvailProduct.price),
                isAvailable: branchAvailProduct.isAvailable,
              }
            : { id: "", name: "", price: 0, isAvailable: true }
        }
        open={!!branchAvailProduct}
        onOpenChange={(open) => {
          if (!open) setBranchAvailProduct(null);
        }}
        onSaved={() => loadData(true)}
      />
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

// ============================================================
// Recommendations Tab (F3) — admin-curated "product A recommends B,C,D".
// Tenant-scoped server-side (requireAdmin + restaurantId); this UI only
// picks products the server already validated as active + available and
// belonging to THIS restaurant. Reorder / toggle / remove are local edits
// committed atomically by the single Save (PUT replace).
// ============================================================

interface WorkingRecommendation {
  recommendedProductId: string;
  name: string;
  isAvailable: boolean;
  isActive: boolean;
}

function RecommendationsTab() {
  const [products, setProducts] = useState<RecommendationProduct[]>([]);
  const [sourceProductId, setSourceProductId] = useState("");
  const [recs, setRecs] = useState<WorkingRecommendation[]>([]);
  const [addCandidateId, setAddCandidateId] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const loadProducts = useCallback(async () => {
    try {
      const data = await recommendationService.getRecommendations();
      setProducts(data.products || []);
      // Default to the first product so the tab is immediately usable.
      if (data.products.length > 0) {
        setSourceProductId((prev) => prev || data.products[0].id);
      }
    } catch (error) {
      console.error("Failed to load products:", error);
      toast.error("Gagal memuat produk");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    // Deliberate one-shot fetch effect — same pattern the repo already
    // tolerates for load-on-mount (see admin/menu loadData effect).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadProducts();
  }, [loadProducts]);

  const loadRecommendations = useCallback(async (productId: string) => {
    setIsLoading(true);
    try {
      const data = await recommendationService.getRecommendations(productId);
      setRecs(
        (data.recommendations || []).map((r) => ({
          recommendedProductId: r.recommendedProductId,
          name: r.name,
          isAvailable: r.isAvailable && r.recommendedIsActive,
          isActive: r.isActive,
        }))
      );
      setDirty(false);
    } catch (error) {
      console.error("Failed to load recommendations:", error);
      toast.error("Gagal memuat rekomendasi");
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Reload the curated list whenever the source product changes.
  useEffect(() => {
    if (!sourceProductId) return;
    // Deliberate fetch-on-source-change effect (same tolerated pattern).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadRecommendations(sourceProductId);
  }, [sourceProductId, loadRecommendations]);

  const markDirty = (next: WorkingRecommendation[]) => {
    setRecs(next);
    setDirty(true);
  };

  const move = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= recs.length) return;
    const next = [...recs];
    [next[index], next[target]] = [next[target], next[index]];
    markDirty(next);
  };

  const toggle = (index: number) => {
    const next = [...recs];
    next[index] = { ...next[index], isActive: !next[index].isActive };
    markDirty(next);
  };

  const remove = (index: number) => {
    markDirty(recs.filter((_, i) => i !== index));
  };

  const addProduct = () => {
    if (!addCandidateId) return;
    const candidate = products.find((p) => p.id === addCandidateId);
    if (!candidate) return;
    if (recs.some((r) => r.recommendedProductId === candidate.id)) return;
    markDirty([
      ...recs,
      {
        recommendedProductId: candidate.id,
        name: candidate.name,
        isAvailable: true,
        isActive: true,
      },
    ]);
    setAddCandidateId("");
  };

  const handleSave = async () => {
    if (!sourceProductId) return;
    setIsSaving(true);
    try {
      await recommendationService.saveRecommendations(
        sourceProductId,
        recs.map((r) => ({
          recommendedProductId: r.recommendedProductId,
          isActive: r.isActive,
        }))
      );
      toast.success("Rekomendasi berhasil disimpan");
      setDirty(false);
      await loadRecommendations(sourceProductId);
    } catch (error) {
      const msg = apiErrorMessage(error, "Gagal menyimpan rekomendasi");
      toast.error(msg);
    } finally {
      setIsSaving(false);
    }
  };

  // Products that can still be added (not already recommended, not self).
  const addableProducts = products.filter(
    (p) =>
      p.id !== sourceProductId &&
      !recs.some((r) => r.recommendedProductId === p.id)
  );

  return (
    <Card>
      <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle className="text-base">Rekomendasi Produk</CardTitle>
        <Button size="sm" onClick={handleSave} disabled={isSaving || !dirty}>
          {isSaving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
          Simpan
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-gray-500">
          Atur produk mana yang direkomendasikan untuk setiap produk. Produk
          rekomendasi tampil pertama di bagian{" "}
          <span className="font-medium">Rekomendasi</span> pada menu pelanggan.
        </p>

        {/* Source product */}
        <div>
          <Label>Rekomendasikan untuk</Label>
          <Select
            value={sourceProductId}
            onValueChange={(v) => v && setSourceProductId(v)}
          >
            <SelectTrigger className="mt-1">
              <SelectValue>
                {products.find((p) => p.id === sourceProductId)?.name ??
                  "Pilih produk sumber"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {products.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                  {p.category?.name ? ` (${p.category.name})` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
          </div>
        ) : (
          <>
            {/* Curated list */}
            <div className="space-y-2">
              {recs.length === 0 ? (
                <p className="text-center text-sm text-gray-400 py-6">
                  Belum ada produk rekomendasi. Tambahkan di bawah.
                </p>
              ) : (
                recs.map((r, index) => (
                  <div
                    key={r.recommendedProductId}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-200 px-3 py-2"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-xs text-gray-400 tabular-nums">
                        {index + 1}.
                      </span>
                      <span
                        className={`text-sm font-medium ${
                          r.isActive ? "" : "text-gray-400 line-through"
                        }`}
                      >
                        {r.name}
                      </span>
                      {!r.isAvailable && (
                        <Badge variant="destructive" className="text-[10px]">
                          Tidak Tersedia
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7"
                        disabled={index === 0}
                        onClick={() => move(index, -1)}
                        aria-label="Naik"
                      >
                        <MoveUp className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7"
                        disabled={index === recs.length - 1}
                        onClick={() => move(index, 1)}
                        aria-label="Turun"
                      >
                        <MoveDown className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7"
                        onClick={() => toggle(index)}
                        aria-label="Aktif / nonaktif"
                      >
                        {r.isActive ? (
                          <ToggleRight className="h-4 w-4 text-green-600" />
                        ) : (
                          <ToggleLeft className="h-4 w-4" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-red-500 hover:text-red-700"
                        onClick={() => remove(index)}
                        aria-label="Hapus"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Add product */}
            <div className="flex gap-2">
              <Select value={addCandidateId} onValueChange={(v) => v && setAddCandidateId(v)}>
                <SelectTrigger className="flex-1 min-w-0">
                  <SelectValue>
                    {addableProducts.find((p) => p.id === addCandidateId)
                      ?.name ?? "Pilih produk untuk ditambahkan"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {addableProducts.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-gray-400">
                      Semua produk sudah direkomendasikan
                    </p>
                  ) : (
                    addableProducts.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                        {p.category?.name ? ` (${p.category.name})` : ""}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                onClick={addProduct}
                disabled={!addCandidateId}
              >
                <Plus className="h-4 w-4 mr-1" /> Tambah
              </Button>
            </div>

            {dirty && (
              <p className="text-xs text-amber-600 flex items-center gap-1">
                <Star className="h-3 w-3" /> Perubahan belum disimpan — klik
                Simpan.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
