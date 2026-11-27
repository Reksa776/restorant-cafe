import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { resolveActiveTenant } from "@/lib/tenant";
import { extractSubdomainSlug } from "@/lib/tenant-url";
import MenuClient from "./menu-client";

/**
 * /menu — tenant storefront.
 *
 * On a merchant SUBDOMAIN (`kopisenja.domainlo.com/menu`) the host is
 * authoritative, so an unknown/inactive subdomain renders the friendly 404
 * ("Toko / Kafe tidak ditemukan") instead of letting the client fail on a
 * tenant lookup it cannot recover from.
 *
 * On the main domain the existing client resolution flow is untouched:
 * `/r/<slug>` (cookie), table QR context and `/pilih-cabang` all still work.
 */
export default async function MenuPage() {
  const headerList = await headers();
  const host =
    headerList.get("x-forwarded-host") ?? headerList.get("host") ?? null;
  const slug = extractSubdomainSlug(host, process.env.NEXT_PUBLIC_ROOT_DOMAIN);

  if (slug) {
    const tenant = await resolveActiveTenant({ slug });
    if (!tenant) notFound();
  }

  return <MenuClient />;
}
