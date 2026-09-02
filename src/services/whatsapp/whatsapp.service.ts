import { whatsappSessionManager } from "./session-manager";

export interface SendMessageInput {
  to: string;
  message: string;
}

export class WhatsAppService {
  /**
   * Send a WhatsApp message through the session manager.
   * Uses the restaurantId to find the correct Baileys connection.
   */
  async sendMessage(
    input: SendMessageInput,
    restaurantId: string
  ): Promise<boolean> {
    try {
      await whatsappSessionManager.sendMessage(
        restaurantId,
        input.to,
        input.message
      );
      return true;
    } catch (error) {
      console.error("Failed to send WhatsApp message:", error);
      return false;
    }
  }

  async sendOrderReceived(
    orderNumber: string,
    customerPhone: string,
    restaurantId: string
  ) {
    const message = `Halo! 👋\n\nPesanan Anda telah diterima.\n\n📋 Nomor Pesanan: *${orderNumber}*\n\nKami akan segera memproses pesanan Anda.\n\nTerima kasih! 🙏`;

    return this.sendMessage({ to: customerPhone, message }, restaurantId);
  }

  async sendOrderConfirmed(
    orderNumber: string,
    customerPhone: string,
    restaurantId: string
  ) {
    const message = `✅ Pesanan Anda telah dikonfirmasi!\n\n📋 Nomor Pesanan: *${orderNumber}*\n\nPesanan sedang diproses.\n\nTerima kasih! 🙏`;

    return this.sendMessage({ to: customerPhone, message }, restaurantId);
  }

  async sendPaymentRequest(
    orderNumber: string,
    customerPhone: string,
    amount: string,
    paymentUrl: string,
    restaurantId: string
  ) {
    const message = `💰 Pembayaran Diperlukan\n\n📋 Nomor Pesanan: *${orderNumber}*\n💵 Total: *Rp${amount}*\n\nSilakan lakukan pembayaran melalui link berikut:\n${paymentUrl}\n\nTerima kasih! 🙏`;

    return this.sendMessage({ to: customerPhone, message }, restaurantId);
  }

  async sendPaymentSuccess(
    orderNumber: string,
    customerPhone: string,
    restaurantId: string
  ) {
    const message = `✅ Pembayaran Berhasil!\n\n📋 Nomor Pesanan: *${orderNumber}*\n\nTerima kasih telah melakukan pembayaran! 🙏`;

    return this.sendMessage({ to: customerPhone, message }, restaurantId);
  }

  async sendOrderProcessing(
    orderNumber: string,
    customerPhone: string,
    restaurantId: string
  ) {
    const message = `👨‍🍳 Pesanan Sedang Diproses\n\n📋 Nomor Pesanan: *${orderNumber}*\n\nPesanan Anda sedang kami siapkan.\n\nTerima kasih! 🙏`;

    return this.sendMessage({ to: customerPhone, message }, restaurantId);
  }

  async sendOrderCompleted(
    orderNumber: string,
    customerPhone: string,
    restaurantId: string
  ) {
    const message = `🎉 Pesanan Selesai!\n\n📋 Nomor Pesanan: *${orderNumber}*\n\nPesanan Anda sudah siap diambil/diantar.\n\nTerima kasih telah memesan! 🙏`;

    return this.sendMessage({ to: customerPhone, message }, restaurantId);
  }

  async sendOrderCancelled(
    orderNumber: string,
    customerPhone: string,
    restaurantId: string
  ) {
    const message = `❌ Pesanan Dibatalkan\n\n📋 Nomor Pesanan: *${orderNumber}*\n\nPesanan Anda telah dibatalkan.\n\nJika ada pertanyaan, silakan hubungi kami.`;

    return this.sendMessage({ to: customerPhone, message }, restaurantId);
  }
}

export const whatsappService = new WhatsAppService();
