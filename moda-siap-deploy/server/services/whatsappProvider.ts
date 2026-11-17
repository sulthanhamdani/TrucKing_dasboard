import { buildWhatsAppClickToChatUrl, normalizeWhatsAppNumber } from '../../shared/whatsapp.ts';

export interface WhatsAppDispatchPayload {
  orderNumber: string;
  recipientPhone: string;
  messageText: string;
}

export interface WhatsAppDispatchResult {
  provider: 'click_to_chat' | 'business_cloud_api';
  normalizedPhone: string;
  clickToChatUrl?: string;
  externalMessageId?: string;
  statusLabel: 'WhatsApp Opened' | 'API Queued';
  note: string;
}

export interface WhatsAppProvider {
  readonly mode: 'click_to_chat' | 'business_cloud_api';
  prepareDispatch(payload: WhatsAppDispatchPayload): Promise<WhatsAppDispatchResult>;
}

/**
 * Click-to-Chat Provider (Active):
 * Uses official https://wa.me/<number>?text=<encoded> deep links.
 * Never automates WhatsApp Web or claims automatic delivery.
 */
export class ClickToChatWhatsAppProvider implements WhatsAppProvider {
  readonly mode = 'click_to_chat' as const;

  async prepareDispatch(payload: WhatsAppDispatchPayload): Promise<WhatsAppDispatchResult> {
    const validation = normalizeWhatsAppNumber(payload.recipientPhone);
    if (!validation.valid) {
      throw new Error(validation.error || 'Nomor WhatsApp transporter tidak valid.');
    }

    const url = buildWhatsAppClickToChatUrl(validation.normalized, payload.messageText);
    return {
      provider: this.mode,
      normalizedPhone: validation.normalized,
      clickToChatUrl: url,
      statusLabel: 'WhatsApp Opened',
      note: 'Tautan Click-to-Chat dibuat. Pengiriman pesan tetap dikonfirmasi manual oleh operator.',
    };
  }
}

/**
 * Architectural placeholder for future official Meta WhatsApp Business Cloud API integration.
 * Ready to accept webhook delivery receipts when credentials are configured.
 */
export class BusinessCloudApiWhatsAppProvider implements WhatsAppProvider {
  readonly mode = 'business_cloud_api' as const;

  async prepareDispatch(payload: WhatsAppDispatchPayload): Promise<WhatsAppDispatchResult> {
    const token = process.env.WHATSAPP_CLOUD_API_TOKEN;
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

    if (!token || !phoneNumberId) {
      throw new Error(
        'WhatsApp Business Cloud API belum dikonfigurasi. Gunakan mode Click-to-Chat.'
      );
    }

    const validation = normalizeWhatsAppNumber(payload.recipientPhone);
    if (!validation.valid) {
      throw new Error(validation.error || 'Nomor WhatsApp tidak valid.');
    }

    // Future integration point: POST https://graph.facebook.com/v21.0/{phoneNumberId}/messages
    // and receive delivery statuses via verified webhook signature.
    throw new Error('Integrasi WhatsApp Business Cloud API belum diaktifkan pada environment ini.');
  }
}

export function getWhatsAppProvider(): WhatsAppProvider {
  const mode = process.env.WHATSAPP_PROVIDER === 'business_cloud_api'
    ? 'business_cloud_api'
    : 'click_to_chat';

  if (mode === 'business_cloud_api') {
    return new BusinessCloudApiWhatsAppProvider();
  }
  return new ClickToChatWhatsAppProvider();
}
