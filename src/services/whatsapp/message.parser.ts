import { prisma } from "@/lib/prisma";
import { ValidationError } from "@/lib/errors";

export interface ParsedOrderItem {
  productName: string;
  quantity: number;
  productId?: string;
  unitPrice?: number;
}

export interface ParsedOrder {
  tableNumber?: number;
  items: ParsedOrderItem[];
  rawMessage: string;
}

export class MessageParser {
  /**
   * Parse a WhatsApp message to extract order information
   */
  async parseMessage(
    message: string,
    restaurantId: string
  ): Promise<ParsedOrder> {
    const lines = message
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    let tableNumber: number | undefined;
    const items: ParsedOrderItem[] = [];

    for (const line of lines) {
      // Try to parse table number
      const tableMatch = line.match(
        /(?:meja|table)\s*(\d+)/i
      );
      if (tableMatch) {
        tableNumber = parseInt(tableMatch[1], 10);
        continue;
      }

      // Try to parse item with quantity (e.g., "Nasi Goreng x2" or "Nasi Goreng 2")
      const itemMatch = line.match(
        /^(.+?)\s*(?:x|×)?\s*(\d+)$/i
      );
      if (itemMatch) {
        const productName = itemMatch[1].trim();
        const quantity = parseInt(itemMatch[2], 10);
        items.push({ productName, quantity });
        continue;
      }

      // Try to parse item without quantity (default quantity = 1)
      if (line.length > 0 && !line.match(/^(halo|hai|hey|pesanan|order)/i)) {
        items.push({ productName: line, quantity: 1 });
      }
    }

    return {
      tableNumber,
      items,
      rawMessage: message,
    };
  }

  /**
   * Validate parsed items against database
   */
  async validateItems(
    parsedItems: ParsedOrderItem[],
    restaurantId: string
  ): Promise<
    Array<ParsedOrderItem & { productId: string; unitPrice: number }>
  > {
    const validatedItems: Array<
      ParsedOrderItem & { productId: string; unitPrice: number }
    > = [];

    for (const item of parsedItems) {
      // Search for product by name (case-insensitive, partial match)
      const products = await prisma.product.findMany({
        where: {
          restaurantId,
          isActive: true,
          isAvailable: true,
          name: {
            contains: item.productName,
          },
        },
      });

      if (products.length === 0) {
        throw new ValidationError(
          `Produk "${item.productName}" tidak ditemukan atau tidak tersedia`
        );
      }

      // Use exact match if available, otherwise use first match
      const product =
        products.find(
          (p) => p.name.toLowerCase() === item.productName.toLowerCase()
        ) || products[0];

      validatedItems.push({
        ...item,
        productId: product.id,
        unitPrice: Number(product.price),
      });
    }

    return validatedItems;
  }
}

export const messageParser = new MessageParser();
