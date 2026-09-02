"use client";

import { useEffect, useState } from "react";
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
} from "@/services/menu.service";
import { Plus, Pencil, Trash2, ToggleLeft, ToggleRight } from "lucide-react";
import { toast } from "sonner";

export default function MenuPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Category form state
  const [isCategoryDialogOpen, setIsCategoryDialogOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [categoryForm, setCategoryForm] = useState({
    name: "",
    description: "",
  });

  // Product form state
  const [isProductDialogOpen, setIsProductDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [productForm, setProductForm] = useState({
    name: "",
    description: "",
    price: "",
    categoryId: "",
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setIsLoading(true);
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
  };

  // Category handlers
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

  // Product handlers
  const handleSaveProduct = async () => {
    try {
      const data = {
        ...productForm,
        price: parseFloat(productForm.price),
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Menu</h1>
        <p className="text-gray-500">Kelola menu restoran</p>
      </div>

      <Tabs defaultValue="categories">
        <TabsList>
          <TabsTrigger value="categories">Kategori</TabsTrigger>
          <TabsTrigger value="products">Produk</TabsTrigger>
        </TabsList>

        {/* Categories Tab */}
        <TabsContent value="categories">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Kategori</CardTitle>
              <Button
                onClick={() => {
                  setEditingCategory(null);
                  setCategoryForm({ name: "", description: "" });
                  setIsCategoryDialogOpen(true);
                }}
              >
                <Plus className="h-4 w-4 mr-2" />
                Tambah Kategori
              </Button>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <p className="text-center text-gray-500 py-8">Loading...</p>
              ) : categories.length === 0 ? (
                <p className="text-center text-gray-500 py-8">
                  Belum ada kategori
                </p>
              ) : (
                <div className="space-y-2">
                  {categories.map((cat) => (
                    <div
                      key={cat.id}
                      className="flex items-center justify-between border-b pb-2 last:border-0"
                    >
                      <div>
                        <p className="font-medium">{cat.name}</p>
                        <p className="text-sm text-gray-500">
                          {cat.productCount || 0} produk
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setEditingCategory(cat);
                            setCategoryForm({
                              name: cat.name,
                              description: cat.description || "",
                            });
                            setIsCategoryDialogOpen(true);
                          }}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => handleDeleteCategory(cat.id)}
                        >
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
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Produk</CardTitle>
              <Button
                onClick={() => {
                  setEditingProduct(null);
                  setProductForm({
                    name: "",
                    description: "",
                    price: "",
                    categoryId: categories[0]?.id || "",
                  });
                  setIsProductDialogOpen(true);
                }}
              >
                <Plus className="h-4 w-4 mr-2" />
                Tambah Produk
              </Button>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <p className="text-center text-gray-500 py-8">Loading...</p>
              ) : products.length === 0 ? (
                <p className="text-center text-gray-500 py-8">
                  Belum ada produk
                </p>
              ) : (
                <div className="space-y-2">
                  {products.map((prod) => (
                    <div
                      key={prod.id}
                      className="flex items-center justify-between border-b pb-2 last:border-0"
                    >
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <p className="font-medium">{prod.name}</p>
                          <Badge variant="outline">{prod.category.name}</Badge>
                          {!prod.isAvailable && (
                            <Badge variant="destructive">Tidak Tersedia</Badge>
                          )}
                        </div>
                        <p className="text-sm text-gray-500">
                          Rp{Number(prod.price).toLocaleString("id-ID")}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleToggleAvailability(prod.id)}
                        >
                          {prod.isAvailable ? (
                            <ToggleRight className="h-4 w-4" />
                          ) : (
                            <ToggleLeft className="h-4 w-4" />
                          )}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setEditingProduct(prod);
                            setProductForm({
                              name: prod.name,
                              description: prod.description || "",
                              price: prod.price.toString(),
                              categoryId: prod.category.id,
                            });
                            setIsProductDialogOpen(true);
                          }}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => handleDeleteProduct(prod.id)}
                        >
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

      {/* Category Dialog */}
      <Dialog
        open={isCategoryDialogOpen}
        onOpenChange={setIsCategoryDialogOpen}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingCategory ? "Edit Kategori" : "Tambah Kategori"}
            </DialogTitle>
            <DialogDescription>
              {editingCategory
                ? "Ubah informasi kategori"
                : "Tambahkan kategori baru"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="catName">Nama</Label>
              <Input
                id="catName"
                value={categoryForm.name}
                onChange={(e) =>
                  setCategoryForm({ ...categoryForm, name: e.target.value })
                }
                placeholder="Nama kategori"
              />
            </div>
            <div>
              <Label htmlFor="catDesc">Deskripsi</Label>
              <Textarea
                id="catDesc"
                value={categoryForm.description}
                onChange={(e) =>
                  setCategoryForm({
                    ...categoryForm,
                    description: e.target.value,
                  })
                }
                placeholder="Deskripsi kategori (opsional)"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsCategoryDialogOpen(false)}
            >
              Batal
            </Button>
            <Button onClick={handleSaveCategory}>Simpan</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Product Dialog */}
      <Dialog
        open={isProductDialogOpen}
        onOpenChange={setIsProductDialogOpen}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingProduct ? "Edit Produk" : "Tambah Produk"}
            </DialogTitle>
            <DialogDescription>
              {editingProduct
                ? "Ubah informasi produk"
                : "Tambahkan produk baru"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="prodName">Nama</Label>
              <Input
                id="prodName"
                value={productForm.name}
                onChange={(e) =>
                  setProductForm({ ...productForm, name: e.target.value })
                }
                placeholder="Nama produk"
              />
            </div>
            <div>
              <Label htmlFor="prodDesc">Deskripsi</Label>
              <Textarea
                id="prodDesc"
                value={productForm.description}
                onChange={(e) =>
                  setProductForm({
                    ...productForm,
                    description: e.target.value,
                  })
                }
                placeholder="Deskripsi produk (opsional)"
              />
            </div>
            <div>
              <Label htmlFor="prodPrice">Harga (Rp)</Label>
              <Input
                id="prodPrice"
                type="number"
                value={productForm.price}
                onChange={(e) =>
                  setProductForm({ ...productForm, price: e.target.value ?? "" })
                }
                placeholder="Harga produk"
              />
            </div>
            <div>
              <Label htmlFor="prodCategory">Kategori</Label>
              <Select
                value={productForm.categoryId}
                onValueChange={(value) =>
                  setProductForm({ ...productForm, categoryId: value || "" })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Pilih kategori" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((cat) => (
                    <SelectItem key={cat.id} value={cat.id}>
                      {cat.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsProductDialogOpen(false)}
            >
              Batal
            </Button>
            <Button onClick={handleSaveProduct}>Simpan</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
