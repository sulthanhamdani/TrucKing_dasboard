export interface WhatsAppValidationResult {
  valid: boolean;
  normalized: string;
  error?: string;
}

/**
 * Normalizes Indonesian & international phone numbers for WhatsApp Click-to-Chat (wa.me).
 * Accepts formats like 081234567890, 0812-3456-7890, +62 812 3456 7890, 6281234567890.
 * Returns digits-only international format without '+', spaces, or hyphens.
 */
export function normalizeWhatsAppNumber(rawInput: string): WhatsAppValidationResult {
  const trimmed = (rawInput || '').trim();
  if (!trimmed) {
    return { valid: false, normalized: '', error: 'Nomor WhatsApp wajib diisi.' };
  }

  // Strip spaces, hyphens, parentheses, dots, and leading '+'
  let digits = trimmed.replace(/[\s\-().+]/g, '');

  if (!/^\d+$/.test(digits)) {
    return {
      valid: false,
      normalized: '',
      error: 'Nomor WhatsApp hanya boleh berisi angka, spasi, tanda hubung, atau awalan +.',
    };
  }

  // Convert local Indonesian format (08...) to 628...
  if (digits.startsWith('08')) {
    digits = '62' + digits.slice(1);
  } else if (digits.startsWith('0')) {
    digits = '62' + digits.slice(1);
  }

  if (digits.startsWith('62')) {
    if (!digits.startsWith('628')) {
      return {
        valid: false,
        normalized: '',
        error: 'Nomor WhatsApp seluler Indonesia harus diawali 08 atau 628.',
      };
    }
    if (digits.length < 10 || digits.length > 15) {
      return {
        valid: false,
        normalized: '',
        error: 'Panjang nomor WhatsApp Indonesia harus antara 10 hingga 15 digit (format 628...).',
      };
    }
    return { valid: true, normalized: digits };
  }

  // Fallback for valid international E.164 numbers
  if (digits.length < 9 || digits.length > 15) {
    return {
      valid: false,
      normalized: '',
      error: 'Panjang nomor internasional harus antara 9 hingga 15 digit.',
    };
  }

  return { valid: true, normalized: digits };
}

export interface OrderTemplateValues {
  nama_pic?: string | null;
  nama_transporter?: string | null;
  nomor_order?: string | null;
  nama_customer?: string | null;
  jenis_layanan?: string | null;
  origin?: string | null;
  alamat_muat?: string | null;
  destination?: string | null;
  alamat_bongkar?: string | null;
  tanggal_jam_muat?: string | null;
  tanggal_jam_bongkar?: string | null;
  jenis_armada?: string | null;
  jenis_barang?: string | null;
  jumlah_barang?: string | null;
  berat_barang?: string | null;
  informasi_biaya?: string | null;
  catatan?: string | null;
  dibuat_oleh?: string | null;
}

/**
 * Renders WhatsApp template safely without inventing data for unfilled optional fields.
 */
export function renderWhatsAppOrderTemplate(
  templateBody: string,
  values: OrderTemplateValues
): string {
  const safeValue = (val: string | null | undefined): string => {
    const clean = (val ?? '').trim();
    return clean.length > 0 ? clean : '-';
  };

  return templateBody.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key: string) => {
    const typedKey = key as keyof OrderTemplateValues;
    if (typedKey in values) {
      return safeValue(values[typedKey]);
    }
    return '-';
  });
}

export function buildWhatsAppClickToChatUrl(normalizedPhone: string, message: string): string {
  const cleanPhone = normalizedPhone.replace(/[^\d]/g, '');
  return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`;
}
