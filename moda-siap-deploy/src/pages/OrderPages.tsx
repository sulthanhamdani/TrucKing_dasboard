import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  Download,
  Edit3,
  ExternalLink,
  Eye,
  History,
  MessageCircle,
  Plus,
  Search,
  Send,
  Trash2,
  X,
} from 'lucide-react';
import { apiFetch, ApiError, downloadAuthedCsv, formatWib } from '../lib/api.ts';
import {
  buildWhatsAppClickToChatUrl,
  renderWhatsAppOrderTemplate,
} from '../../shared/whatsapp.ts';
import { StatusIndicator } from '../components/StatusIndicator.tsx';
import { ORDER_STATUSES } from '../../shared/types.ts';
import type {
  AuthUser,
  OrderRecord,
  OrderStatus,
  OrderStatusHistoryRecord,
  RoleCode,
  TransporterRecord,
} from '../../shared/types.ts';

interface OrdersListResponse {
  orders: OrderRecord[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

export function CreateOrderPage({
  user,
  preselectedTransporterId,
  editingOrder,
  onOrderSaved,
  onCancel,
}: {
  user: AuthUser;
  preselectedTransporterId: number | null;
  editingOrder: OrderRecord | null;
  onOrderSaved: () => void;
  onCancel: () => void;
}) {
  const [transporters, setTransporters] = useState<TransporterRecord[]>([]);
  const [templateBody, setTemplateBody] = useState('');
  const [suggestedOrderNo, setSuggestedOrderNo] = useState('ORD-PREVIEW');
  const [idempotencyKey] = useState(() =>
    typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Date.now())
  );

  // Form Fields
  const [customerName, setCustomerName] = useState(editingOrder?.customer_name || '');
  const [serviceType, setServiceType] = useState(editingOrder?.service_type || 'Dedicated Charter');
  const [origin, setOrigin] = useState(editingOrder?.origin || '');
  const [originAddress, setOriginAddress] = useState(editingOrder?.origin_address || '');
  const [destination, setDestination] = useState(editingOrder?.destination || '');
  const [destinationAddress, setDestinationAddress] = useState(editingOrder?.destination_address || '');
  const [plannedPickupAt, setPlannedPickupAt] = useState(editingOrder?.planned_pickup_at || '');
  const [plannedDeliveryAt, setPlannedDeliveryAt] = useState(editingOrder?.planned_delivery_at || '');
  const [cargoType, setCargoType] = useState(editingOrder?.cargo_type || '');
  const [cargoQty, setCargoQty] = useState(editingOrder?.cargo_qty || '');
  const [cargoWeight, setCargoWeight] = useState(editingOrder?.cargo_weight || '');
  const [fleetNeeded, setFleetNeeded] = useState(editingOrder?.fleet_needed || 'CDD');
  const [specialNotes, setSpecialNotes] = useState(editingOrder?.special_notes || '');
  const [transporterId, setTransporterId] = useState<number>(
    editingOrder?.transporter_id || preselectedTransporterId || 0
  );
  const [contactId, setContactId] = useState<number | null>(editingOrder?.contact_id || null);
  const [picName, setPicName] = useState(editingOrder?.pic_name || '');
  const [whatsappNumber, setWhatsappNumber] = useState(editingOrder?.whatsapp_number || '');
  const [rateInfo, setRateInfo] = useState(editingOrder?.rate_info || '');

  // Preview / Created Step State
  const [savedOrder, setSavedOrder] = useState<OrderRecord | null>(null);
  const [editableMessage, setEditableMessage] = useState(editingOrder?.message_text || '');
  const [messageDirty, setMessageDirty] = useState(Boolean(editingOrder));
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [waInfoMsg, setWaInfoMsg] = useState<string | null>(null);

  const isAdminEditingActiveOrder = Boolean(
    editingOrder && user.role === 'admin' && !['Draft', 'Ready to Send'].includes(editingOrder.status)
  );

  useEffect(() => {
    Promise.all([
      apiFetch<{ transporters: TransporterRecord[] }>('/api/transporters?status=Active&pageSize=100'),
      apiFetch<{ suggestedOrderNumber: string; template: { body: string } }>('/api/orders/next-preview'),
    ])
      .then(([trpRes, prevRes]) => {
        setTransporters(trpRes.transporters);
        setSuggestedOrderNo(editingOrder ? editingOrder.order_number : prevRes.suggestedOrderNumber);
        setTemplateBody(prevRes.template.body);

        const targetId = editingOrder?.transporter_id || preselectedTransporterId;
        if (targetId) {
          const found = trpRes.transporters.find((t) => t.id === targetId);
          if (found && !editingOrder) {
            setTransporterId(found.id);
            setPicName(found.pic_name);
            setWhatsappNumber(found.whatsapp_normalized);
            const primary = found.contacts?.find((c) => c.is_primary === 1);
            setContactId(primary?.id ?? null);
          }
        }
      })
      .catch(() => {
        setError('Gagal memuat data master transporter atau template.');
      });
  }, [editingOrder, preselectedTransporterId]);

  const selectedTransporter = transporters.find((t) => t.id === transporterId) || null;

  // Live template preview whenever form updates (unless operator manually edited text)
  useEffect(() => {
    if (messageDirty || !templateBody) return;
    const rendered = renderWhatsAppOrderTemplate(templateBody, {
      nama_pic: picName || selectedTransporter?.pic_name,
      nama_transporter: selectedTransporter?.company_name,
      nomor_order: savedOrder?.order_number || suggestedOrderNo,
      nama_customer: customerName,
      jenis_layanan: serviceType,
      origin,
      alamat_muat: originAddress,
      destination,
      alamat_bongkar: destinationAddress,
      tanggal_jam_muat: plannedPickupAt,
      tanggal_jam_bongkar: plannedDeliveryAt,
      jenis_armada: fleetNeeded,
      jenis_barang: cargoType,
      jumlah_barang: cargoQty,
      berat_barang: cargoWeight,
      informasi_biaya: rateInfo,
      catatan: specialNotes,
      dibuat_oleh: user.full_name,
    });
    setEditableMessage(rendered);
  }, [
    messageDirty,
    templateBody,
    picName,
    selectedTransporter,
    savedOrder,
    suggestedOrderNo,
    customerName,
    serviceType,
    origin,
    originAddress,
    destination,
    destinationAddress,
    plannedPickupAt,
    plannedDeliveryAt,
    fleetNeeded,
    cargoType,
    cargoQty,
    cargoWeight,
    rateInfo,
    specialNotes,
    user.full_name,
  ]);

  function handleTransporterChange(nextId: number) {
    setTransporterId(nextId);
    const found = transporters.find((t) => t.id === nextId);
    if (found) {
      setPicName(found.pic_name);
      setWhatsappNumber(found.whatsapp_normalized);
      const primary = found.contacts?.find((c) => c.is_primary === 1);
      setContactId(primary?.id ?? null);
    } else {
      setPicName('');
      setWhatsappNumber('');
      setContactId(null);
    }
  }

  function handleContactChange(nextContactId: number) {
    setContactId(nextContactId);
    const c = selectedTransporter?.contacts?.find((x) => x.id === nextContactId);
    if (c) {
      setPicName(c.contact_name);
      setWhatsappNumber(c.whatsapp_normalized);
    }
  }

  async function saveOrder(saveAsDraft: boolean) {
    setError(null);
    setSubmitting(true);
    try {
      const payload = {
        idempotency_key: idempotencyKey,
        customer_name: customerName,
        service_type: serviceType,
        origin,
        origin_address: originAddress,
        destination,
        destination_address: destinationAddress,
        planned_pickup_at: plannedPickupAt,
        planned_delivery_at: plannedDeliveryAt,
        cargo_type: cargoType,
        cargo_qty: cargoQty,
        cargo_weight: cargoWeight,
        fleet_needed: fleetNeeded,
        special_notes: specialNotes,
        transporter_id: transporterId,
        contact_id: contactId,
        pic_name: picName,
        whatsapp_number: whatsappNumber,
        rate_info: rateInfo,
        message_text: editableMessage,
        save_as_draft: saveAsDraft,
        preserve_status: isAdminEditingActiveOrder,
      };

      const res = editingOrder
        ? await apiFetch<{ order: OrderRecord }>(`/api/orders/${editingOrder.id}`, {
            method: 'PUT',
            body: JSON.stringify(payload),
          })
        : await apiFetch<{ order: OrderRecord }>('/api/orders', {
            method: 'POST',
            body: JSON.stringify(payload),
          });

      setSavedOrder(res.order);
      setEditableMessage(res.order.message_text);
      setWaInfoMsg(
        isAdminEditingActiveOrder
          ? `Perubahan pada order ${res.order.order_number} berhasil disimpan (status tetap ${res.order.status}).`
          : saveAsDraft
            ? `Order ${res.order.order_number} disimpan sebagai Draft.`
            : `Order ${res.order.order_number} siap dikirim ke WhatsApp vendor.`
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal menyimpan order.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleFormSubmit(e: FormEvent) {
    e.preventDefault();
    await saveOrder(false);
  }

  async function handleRecordWhatsAppOpened() {
    if (!savedOrder) return;
    try {
      const res = await apiFetch<{ order: OrderRecord; note: string }>(
        `/api/orders/${savedOrder.id}/whatsapp-opened`,
        {
          method: 'POST',
          body: JSON.stringify({ message_text: editableMessage }),
        }
      );
      setSavedOrder(res.order);
      setWaInfoMsg(res.note);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal mencatat pembukaan WhatsApp.');
    }
  }

  async function handleConfirmSent() {
    if (!savedOrder) return;
    try {
      const res = await apiFetch<{ order: OrderRecord }>(`/api/orders/${savedOrder.id}/confirm-sent`, {
        method: 'POST',
        body: JSON.stringify({ note: 'Dikonfirmasi terkirim secara manual oleh operator.' }),
      });
      setSavedOrder(res.order);
      setWaInfoMsg('Order berhasil ditandai Sudah Dikirim (Konfirmasi Manual).');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal mengkonfirmasi pengiriman.');
    }
  }

  const clickToChatHref =
    savedOrder && savedOrder.whatsapp_number
      ? buildWhatsAppClickToChatUrl(savedOrder.whatsapp_number, editableMessage)
      : '#';

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
      {/* Left Form */}
      <form onSubmit={handleFormSubmit} className="xl:col-span-7 bg-white border border-slate-200 rounded-xl p-6 space-y-5">
        <div className="flex items-center justify-between border-b border-slate-200 pb-4">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              {editingOrder ? `Edit Order ${editingOrder.order_number}` : 'Buat Order Pengiriman Baru'}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Pembuat Order: <span className="font-semibold text-slate-700">{user.full_name}</span> &middot; Pemilihan transporter dilakukan manual oleh operator.
            </p>
          </div>
          <span className="font-mono text-xs font-semibold text-slate-700 bg-slate-100 border border-slate-200 px-2.5 py-1 rounded-md">
            {savedOrder?.order_number || suggestedOrderNo}
          </span>
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-800">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {isAdminEditingActiveOrder && editingOrder && !savedOrder && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-900">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-amber-700" />
            <span>
              Mode Edit Super Admin: Order berstatus <strong>{editingOrder.status}</strong>. Perubahan data akan
              mempertahankan status operasional saat ini dan tercatat di riwayat audit.
            </span>
          </div>
        )}

        {/* Section 1: Informasi Order */}
        <div className="space-y-3 text-xs">
          <h3 className="font-bold text-slate-800 text-xs uppercase tracking-wider">1. Informasi Order</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-medium text-slate-700 mb-1">Nama Customer *</label>
              <input
                type="text"
                required
                disabled={Boolean(savedOrder)}
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="PT Indofood / PT Unilever..."
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs disabled:bg-slate-50"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Jenis Layanan *</label>
              <select
                disabled={Boolean(savedOrder)}
                value={serviceType}
                onChange={(e) => setServiceType(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs disabled:bg-slate-50"
              >
                <option value="Dedicated Charter">Dedicated Charter (FTL)</option>
                <option value="Reguler Distribution">Reguler Distribution</option>
                <option value="Express / Urgent">Express / Urgent</option>
                <option value="Multi-Drop">Multi-Drop</option>
              </select>
            </div>
          </div>
        </div>

        {/* Section 2: Informasi Pengiriman */}
        <div className="space-y-3 text-xs border-t border-slate-100 pt-4">
          <h3 className="font-bold text-slate-800 text-xs uppercase tracking-wider">2. Informasi Pengiriman</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-medium text-slate-700 mb-1">Origin / Kota Muat *</label>
              <input
                type="text"
                required
                disabled={Boolean(savedOrder)}
                value={origin}
                onChange={(e) => setOrigin(e.target.value)}
                placeholder="Jakarta / Cikarang"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs disabled:bg-slate-50"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Destination / Kota Bongkar *</label>
              <input
                type="text"
                required
                disabled={Boolean(savedOrder)}
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                placeholder="Surabaya / Semarang"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs disabled:bg-slate-50"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-medium text-slate-700 mb-1">Alamat Lengkap Lokasi Muat *</label>
              <textarea
                rows={2}
                required
                disabled={Boolean(savedOrder)}
                value={originAddress}
                onChange={(e) => setOriginAddress(e.target.value)}
                placeholder="Alamat gudang muat..."
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs disabled:bg-slate-50"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Alamat Lengkap Lokasi Bongkar *</label>
              <textarea
                rows={2}
                required
                disabled={Boolean(savedOrder)}
                value={destinationAddress}
                onChange={(e) => setDestinationAddress(e.target.value)}
                placeholder="Alamat gudang tujuan..."
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs disabled:bg-slate-50"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-medium text-slate-700 mb-1">Rencana Tanggal &amp; Jam Muat *</label>
              <input
                type="datetime-local"
                required
                disabled={Boolean(savedOrder)}
                value={plannedPickupAt}
                onChange={(e) => setPlannedPickupAt(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs disabled:bg-slate-50"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Rencana Tanggal &amp; Jam Bongkar *</label>
              <input
                type="datetime-local"
                required
                disabled={Boolean(savedOrder)}
                value={plannedDeliveryAt}
                onChange={(e) => setPlannedDeliveryAt(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs disabled:bg-slate-50"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div>
              <label className="block font-medium text-slate-700 mb-1">Jenis Armada *</label>
              <select
                disabled={Boolean(savedOrder)}
                value={fleetNeeded}
                onChange={(e) => setFleetNeeded(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs disabled:bg-slate-50"
              >
                {['CDE', 'CDD', 'Fuso', 'Wingbox', 'Tronton', 'Trailer', 'Box'].map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Jenis Barang *</label>
              <input
                type="text"
                required
                disabled={Boolean(savedOrder)}
                value={cargoType}
                onChange={(e) => setCargoType(e.target.value)}
                placeholder="FMCG / Kemasan"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs disabled:bg-slate-50"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Jumlah / Koli *</label>
              <input
                type="text"
                required
                disabled={Boolean(savedOrder)}
                value={cargoQty}
                onChange={(e) => setCargoQty(e.target.value)}
                placeholder="120 Koli / 12 Palet"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs disabled:bg-slate-50"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Berat (Opsional)</label>
              <input
                type="text"
                disabled={Boolean(savedOrder)}
                value={cargoWeight}
                onChange={(e) => setCargoWeight(e.target.value)}
                placeholder="4.5 Ton"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs disabled:bg-slate-50"
              />
            </div>
          </div>
          <div>
            <label className="block font-medium text-slate-700 mb-1">Catatan / Instruksi Khusus</label>
            <input
              type="text"
              disabled={Boolean(savedOrder)}
              value={specialNotes}
              onChange={(e) => setSpecialNotes(e.target.value)}
              placeholder="Wajib terpal / surat jalan rangkap 3..."
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs disabled:bg-slate-50"
            />
          </div>
        </div>

        {/* Section 3: Informasi Vendor (Manual Selection ONLY) */}
        <div className="space-y-3 text-xs border-t border-slate-100 pt-4">
          <h3 className="font-bold text-slate-800 text-xs uppercase tracking-wider">
            3. Pemilihan Transporter (Manual)
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-medium text-slate-700 mb-1">Pilih Transporter *</label>
              <select
                required
                disabled={Boolean(savedOrder)}
                value={transporterId}
                onChange={(e) => handleTransporterChange(Number(e.target.value))}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs disabled:bg-slate-50"
              >
                <option value={0}>-- Pilih Vendor Transporter --</option>
                {transporters.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.company_name} ({t.code})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Pilih Kontak PIC</label>
              {selectedTransporter && (selectedTransporter.contacts?.length || 0) > 1 ? (
                <select
                  disabled={Boolean(savedOrder)}
                  value={contactId ?? ''}
                  onChange={(e) => handleContactChange(Number(e.target.value))}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs disabled:bg-slate-50"
                >
                  {selectedTransporter.contacts?.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.contact_name} ({c.role_title})
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  required
                  disabled={Boolean(savedOrder)}
                  value={picName}
                  onChange={(e) => setPicName(e.target.value)}
                  placeholder="Otomatis dari master transporter"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs disabled:bg-slate-50"
                />
              )}
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-medium text-slate-700 mb-1">Nomor WhatsApp Transporter *</label>
              <input
                type="text"
                required
                disabled={Boolean(savedOrder)}
                value={whatsappNumber}
                onChange={(e) => setWhatsappNumber(e.target.value)}
                placeholder="628..."
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono disabled:bg-slate-50"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Informasi Biaya / Rate (Opsional)</label>
              <input
                type="text"
                disabled={Boolean(savedOrder)}
                value={rateInfo}
                onChange={(e) => setRateInfo(e.target.value)}
                placeholder="Sesuai kontrak / Rp ..."
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs disabled:bg-slate-50"
              />
            </div>
          </div>
        </div>

        {!savedOrder && (
          <div className="flex flex-wrap items-center justify-end gap-2 pt-4 border-t border-slate-200">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Batal
            </button>
            {!isAdminEditingActiveOrder && (
              <button
                type="button"
                disabled={submitting}
                onClick={() => saveOrder(true)}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
              >
                Save Draft
              </button>
            )}
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-[#0F2A24] px-4 py-2 text-xs font-semibold text-white hover:bg-[#163C33] disabled:opacity-50"
            >
              {submitting
                ? 'Menyimpan Order...'
                : isAdminEditingActiveOrder
                  ? 'Simpan Perubahan Order'
                  : 'Simpan Order & Siapkan WhatsApp'}
            </button>
          </div>
        )}
      </form>

      {/* Right Preview & WhatsApp Dispatch Panel */}
      <div className="xl:col-span-5 space-y-4">
        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Preview Pesan WhatsApp Order</h3>
              <p className="text-xs text-slate-500">Anda dapat meninjau atau menyunting teks sebelum membuka WhatsApp.</p>
            </div>
            {messageDirty && !savedOrder && (
              <button
                type="button"
                onClick={() => setMessageDirty(false)}
                className="text-xs font-medium text-emerald-800 hover:underline"
              >
                Reset ke Template
              </button>
            )}
          </div>

          <textarea
            rows={18}
            value={editableMessage}
            onChange={(e) => {
              setMessageDirty(true);
              setEditableMessage(e.target.value);
            }}
            className="w-full rounded-lg border border-slate-300 bg-slate-50 p-3.5 text-xs font-mono leading-relaxed text-slate-800 focus:border-emerald-700 focus:bg-white focus:outline-none"
          />

          {waInfoMsg && (
            <div className="mt-4 flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs text-emerald-900">
              <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5 text-emerald-700" />
              <span>{waInfoMsg}</span>
            </div>
          )}

          {savedOrder && (
            <div className="mt-4 space-y-3 border-t border-slate-200 pt-4">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-600 font-medium">Status Saat Ini:</span>
                <StatusIndicator status={savedOrder.status} />
              </div>

              <a
                href={clickToChatHref}
                target="_blank"
                rel="noopener noreferrer"
                onClick={handleRecordWhatsAppOpened}
                className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-700 px-4 py-2.5 text-xs font-semibold text-white hover:bg-emerald-800 transition-colors"
              >
                <MessageCircle className="h-4 w-4" />
                <span>Send Order via WhatsApp</span>
                <ExternalLink className="h-3.5 w-3.5" />
              </a>

              <p className="text-[11px] text-slate-500 leading-relaxed">
                Membuka tautan WhatsApp hanya mencatat status teknis <strong>WhatsApp Opened</strong>. Setelah Anda menekan tombol Send di aplikasi WhatsApp, klik tombol konfirmasi di bawah.
              </p>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleConfirmSent}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-teal-300 bg-teal-50 px-3 py-2 text-xs font-semibold text-teal-900 hover:bg-teal-100"
                >
                  <Send className="h-3.5 w-3.5" />
                  Tandai Sudah Dikirim
                </button>
                <button
                  type="button"
                  onClick={onOrderSaved}
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Lihat Riwayat Order
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function OrderManagementPage({
  userRole,
  onCreateNew,
  onEditDraft,
}: {
  userRole: RoleCode;
  onCreateNew: () => void;
  onEditDraft: (order: OrderRecord) => void;
}) {
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 15, total: 0, totalPages: 1 });
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Order Detail & History Modal
  const [selectedOrder, setSelectedOrder] = useState<OrderRecord | null>(null);
  const [orderHistory, setOrderHistory] = useState<OrderStatusHistoryRecord[]>([]);
  const [newStatus, setNewStatus] = useState<OrderStatus>('Accepted');
  const [statusNote, setStatusNote] = useState('');
  const [updatingStatus, setUpdatingStatus] = useState(false);

  // Super Admin Delete Order Modal
  const [deleteTarget, setDeleteTarget] = useState<OrderRecord | null>(null);
  const [deleteReason, setDeleteReason] = useState('');
  const [deleting, setDeleting] = useState(false);

  const loadOrders = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({
        search,
        status: statusFilter,
        page: String(page),
        pageSize: '15',
      });
      const res = await apiFetch<OrdersListResponse>(`/api/orders?${qs.toString()}`);
      setOrders(res.orders);
      setPagination(res.pagination);
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof ApiError ? err.message : 'Gagal memuat riwayat order.',
      });
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, page]);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  async function openOrderDetail(id: number) {
    try {
      const res = await apiFetch<{ order: OrderRecord; history: OrderStatusHistoryRecord[] }>(
        `/api/orders/${id}`
      );
      setSelectedOrder(res.order);
      setOrderHistory(res.history);
      setNewStatus(res.order.status);
      setStatusNote('');
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof ApiError ? err.message : 'Gagal memuat detail order.',
      });
    }
  }

  async function handleDuplicate(order: OrderRecord) {
    try {
      const res = await apiFetch<{ order: OrderRecord }>(`/api/orders/${order.id}/duplicate`, {
        method: 'POST',
      });
      setFeedback({
        type: 'ok',
        text: `Order berhasil diduplikasi sebagai Draft (${res.order.order_number}).`,
      });
      await loadOrders();
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof ApiError ? err.message : 'Gagal menduplikasi order.',
      });
    }
  }

  async function handleMarkWhatsAppOpened(order: OrderRecord) {
    try {
      const res = await apiFetch<{ order: OrderRecord; note: string }>(
        `/api/orders/${order.id}/whatsapp-opened`,
        { method: 'POST', body: JSON.stringify({}) }
      );
      setFeedback({ type: 'ok', text: res.note });
      if (selectedOrder?.id === order.id) {
        await openOrderDetail(order.id);
      }
      await loadOrders();
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof ApiError ? err.message : 'Gagal mencatat pembukaan WhatsApp.',
      });
    }
  }

  async function handleConfirmSent(order: OrderRecord) {
    try {
      await apiFetch(`/api/orders/${order.id}/confirm-sent`, {
        method: 'POST',
        body: JSON.stringify({ note: 'Dikonfirmasi manual oleh operator dari riwayat order.' }),
      });
      setFeedback({
        type: 'ok',
        text: `Order ${order.order_number} ditandai Sudah Dikirim (Konfirmasi Manual).`,
      });
      if (selectedOrder?.id === order.id) {
        await openOrderDetail(order.id);
      }
      await loadOrders();
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof ApiError ? err.message : 'Gagal mengkonfirmasi pengiriman.',
      });
    }
  }

  async function handleUpdateStatus(e: FormEvent) {
    e.preventDefault();
    if (!selectedOrder) return;
    setUpdatingStatus(true);
    try {
      await apiFetch(`/api/orders/${selectedOrder.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: newStatus, note: statusNote }),
      });
      setFeedback({
        type: 'ok',
        text: `Status order ${selectedOrder.order_number} diperbarui menjadi ${newStatus}.`,
      });
      await openOrderDetail(selectedOrder.id);
      await loadOrders();
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof ApiError ? err.message : 'Gagal memperbarui status order.',
      });
    } finally {
      setUpdatingStatus(false);
    }
  }

  async function handleConfirmDelete(e: FormEvent) {
    e.preventDefault();
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await apiFetch<{ message: string }>(`/api/orders/${deleteTarget.id}`, {
        method: 'DELETE',
        body: JSON.stringify({ reason: deleteReason }),
      });
      setFeedback({ type: 'ok', text: res.message });
      if (selectedOrder?.id === deleteTarget.id) {
        setSelectedOrder(null);
      }
      setDeleteTarget(null);
      setDeleteReason('');
      await loadOrders();
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof ApiError ? err.message : 'Gagal menghapus order.',
      });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-5">
      {feedback && (
        <div
          className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-xs ${
            feedback.type === 'ok'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
              : 'border-rose-200 bg-rose-50 text-rose-800'
          }`}
        >
          <span>{feedback.text}</span>
          <button type="button" onClick={() => setFeedback(null)}>
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Toolbar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3 flex-1 min-w-[260px]">
          <div className="relative flex-1 min-w-[200px] max-w-xs">
            <Search className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Cari Order ID, customer, rute, vendor..."
              className="w-full rounded-lg border border-slate-300 pl-9 pr-3 py-2 text-xs focus:border-emerald-700 focus:outline-none"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700"
          >
            <option value="all">Semua Status Order</option>
            {ORDER_STATUSES.map((st) => (
              <option key={st} value={st}>
                {st}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => downloadAuthedCsv('/api/orders/export/csv', 'moda_orders.csv')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
          >
            <Download className="h-3.5 w-3.5" />
            Export Order
          </button>
          <button
            type="button"
            onClick={onCreateNew}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#0F2A24] px-4 py-2 text-xs font-semibold text-white hover:bg-[#163C33] whitespace-nowrap"
          >
            <Plus className="h-4 w-4" />
            Create New Order
          </button>
        </div>
      </div>

      {/* Orders Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600">
                <th className="py-3 px-4">Order ID</th>
                <th className="py-3 px-4">Customer</th>
                <th className="py-3 px-3">Origin</th>
                <th className="py-3 px-3">Destination</th>
                <th className="py-3 px-4">Transporter</th>
                <th className="py-3 px-3">Tanggal Muat</th>
                <th className="py-3 px-3">Status</th>
                <th className="py-3 px-3">Dibuat Oleh</th>
                <th className="py-3 px-4 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {loading && (
                <tr>
                  <td colSpan={9} className="py-10 text-center text-slate-500">
                    Memuat daftar order...
                  </td>
                </tr>
              )}
              {!loading &&
                orders.map((ord) => {
                  const waHref = buildWhatsAppClickToChatUrl(ord.whatsapp_number, ord.message_text);
                  return (
                    <tr key={ord.id} className="hover:bg-slate-50">
                      <td className="py-3 px-4 font-mono font-semibold text-slate-900 whitespace-nowrap">
                        {ord.order_number}
                      </td>
                      <td className="py-3 px-4 font-medium text-slate-800">{ord.customer_name}</td>
                      <td className="py-3 px-3 text-slate-600">{ord.origin}</td>
                      <td className="py-3 px-3 text-slate-600">{ord.destination}</td>
                      <td className="py-3 px-4">
                        <div className="font-medium text-slate-900">{ord.transporter_name}</div>
                        <div className="text-[11px] text-slate-500">{ord.pic_name}</div>
                      </td>
                      <td className="py-3 px-3 font-mono tabular-nums text-slate-600 whitespace-nowrap">
                        {ord.planned_pickup_at.replace('T', ' ')}
                      </td>
                      <td className="py-3 px-3">
                        <StatusIndicator status={ord.status} />
                      </td>
                      <td className="py-3 px-3 text-slate-600">{ord.created_by_name}</td>
                      <td className="py-3 px-4">
                        <div className="flex items-center justify-end gap-1.5 flex-wrap">
                          <button
                            type="button"
                            onClick={() => openOrderDetail(ord.id)}
                            title="View Order & History"
                            className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                          >
                            <Eye className="h-3.5 w-3.5" />
                            View
                          </button>
                          {(userRole === 'admin' || ['Draft', 'Ready to Send'].includes(ord.status)) && (
                            <button
                              type="button"
                              onClick={() => onEditDraft(ord)}
                              title={
                                userRole === 'admin' && !['Draft', 'Ready to Send'].includes(ord.status)
                                  ? 'Edit Order (Super Admin)'
                                  : 'Edit Order'
                              }
                              className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                            >
                              <Edit3 className="h-3.5 w-3.5" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleDuplicate(ord)}
                            title="Duplicate Order"
                            className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </button>
                          <a
                            href={waHref}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={() => handleMarkWhatsAppOpened(ord)}
                            title="Open WhatsApp Again"
                            className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-800 hover:bg-emerald-100"
                          >
                            <MessageCircle className="h-3.5 w-3.5" />
                            WA
                          </a>
                          {userRole === 'admin' && (
                            <button
                              type="button"
                              onClick={() => {
                                setDeleteTarget(ord);
                                setDeleteReason('');
                              }}
                              title="Hapus Order (Super Admin)"
                              className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] font-medium text-rose-700 hover:bg-rose-100"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              {!loading && orders.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-xs text-slate-500">
                    Belum ada order operasional yang dicatat. Klik &ldquo;Create New Order&rdquo; untuk memulai.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-xs text-slate-600">
          <span className="tabular-nums">
            Total {pagination.total} order &middot; Halaman {pagination.page} dari {pagination.totalPages}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="rounded-md border border-slate-300 px-3 py-1 disabled:opacity-40"
            >
              Sebelumnya
            </button>
            <button
              type="button"
              disabled={page >= pagination.totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-md border border-slate-300 px-3 py-1 disabled:opacity-40"
            >
              Berikutnya
            </button>
          </div>
        </div>
      </div>

      {/* Order Detail & Status Audit Modal */}
      {selectedOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-xl bg-white border border-slate-200 p-6 space-y-6">
            <div className="flex items-start justify-between border-b border-slate-200 pb-4">
              <div>
                <div className="font-mono text-xs text-slate-500">Dibuat: {formatWib(selectedOrder.created_at)}</div>
                <h3 className="text-lg font-bold text-slate-900">{selectedOrder.order_number}</h3>
                <div className="mt-1 flex items-center gap-2">
                  <StatusIndicator status={selectedOrder.status} />
                  <span className="text-xs text-slate-500">oleh {selectedOrder.created_by_name}</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {userRole === 'admin' && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        const ord = selectedOrder;
                        setSelectedOrder(null);
                        onEditDraft(ord);
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      <Edit3 className="h-3.5 w-3.5" />
                      Edit Order
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDeleteTarget(selectedOrder);
                        setDeleteReason('');
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-100"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Hapus
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => setSelectedOrder(null)}
                  className="text-slate-400 hover:text-slate-700 p-1"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 text-xs">
              <div className="space-y-4">
                <div className="rounded-lg border border-slate-200 p-4 space-y-2">
                  <div className="font-bold text-slate-800">Rincian Pengiriman &amp; Vendor</div>
                  <div><span className="text-slate-500">Customer:</span> <strong>{selectedOrder.customer_name}</strong> ({selectedOrder.service_type})</div>
                  <div><span className="text-slate-500">Origin:</span> {selectedOrder.origin} — {selectedOrder.origin_address}</div>
                  <div><span className="text-slate-500">Destination:</span> {selectedOrder.destination} — {selectedOrder.destination_address}</div>
                  <div><span className="text-slate-500">Rencana Muat/Bongkar:</span> {selectedOrder.planned_pickup_at} s/d {selectedOrder.planned_delivery_at}</div>
                  <div><span className="text-slate-500">Armada &amp; Muatan:</span> {selectedOrder.fleet_needed} &middot; {selectedOrder.cargo_type} ({selectedOrder.cargo_qty})</div>
                  <div><span className="text-slate-500">Transporter:</span> <strong>{selectedOrder.transporter_name}</strong> (PIC: {selectedOrder.pic_name} / +{selectedOrder.whatsapp_number})</div>
                </div>

                {/* WhatsApp Actions */}
                <div className="rounded-lg border border-slate-200 p-4 space-y-3">
                  <div className="font-bold text-slate-800">Aksi WhatsApp &amp; Konfirmasi</div>
                  <div className="flex flex-wrap gap-2">
                    <a
                      href={buildWhatsAppClickToChatUrl(selectedOrder.whatsapp_number, selectedOrder.message_text)}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => handleMarkWhatsAppOpened(selectedOrder)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-800"
                    >
                      <MessageCircle className="h-4 w-4" />
                      Open WhatsApp Again
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                    <button
                      type="button"
                      onClick={() => handleConfirmSent(selectedOrder)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-teal-300 bg-teal-50 px-3.5 py-2 text-xs font-semibold text-teal-900 hover:bg-teal-100"
                    >
                      <Send className="h-3.5 w-3.5" />
                      Tandai Sudah Dikirim
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    Konfirmasi &ldquo;Sudah Dikirim&rdquo; adalah pernyataan manual operator, bukan bukti pengiriman terverifikasi dari WhatsApp.
                  </p>
                </div>

                {/* Manual Status Update Form */}
                <form onSubmit={handleUpdateStatus} className="rounded-lg border border-slate-200 p-4 space-y-3">
                  <div className="font-bold text-slate-800">Perbarui Status Order</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <select
                      value={newStatus}
                      onChange={(e) => setNewStatus(e.target.value as OrderStatus)}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
                    >
                      {ORDER_STATUSES.map((st) => (
                        <option key={st} value={st}>
                          {st}
                        </option>
                      ))}
                    </select>
                    <input
                      type="text"
                      value={statusNote}
                      onChange={(e) => setStatusNote(e.target.value)}
                      placeholder="Catatan perubahan status..."
                      className="rounded-lg border border-slate-300 px-3 py-2 text-xs"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={updatingStatus}
                    className="rounded-lg bg-[#0F2A24] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#163C33] disabled:opacity-50"
                  >
                    {updatingStatus ? 'Memperbarui...' : 'Simpan Status Baru'}
                  </button>
                </form>
              </div>

              {/* Right Column: Message Text + Status History Timeline */}
              <div className="space-y-4">
                <div>
                  <div className="font-bold text-slate-800 mb-1.5">Pesan Order WhatsApp</div>
                  <pre className="whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 p-3.5 font-mono text-[11px] leading-relaxed text-slate-700 max-h-56 overflow-y-auto">
                    {selectedOrder.message_text}
                  </pre>
                </div>

                <div>
                  <div className="flex items-center gap-1.5 font-bold text-slate-800 mb-2">
                    <History className="h-4 w-4 text-slate-500" />
                    <span>Riwayat Status Order</span>
                  </div>
                  <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                    {orderHistory.map((h) => (
                      <div key={h.id} className="rounded-lg border border-slate-200 p-3 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-slate-900">
                            {h.from_status ? `${h.from_status} → ${h.to_status}` : h.to_status}
                          </span>
                          <span className="text-[11px] font-mono text-slate-500">{formatWib(h.created_at)}</span>
                        </div>
                        <div className="mt-1 text-slate-600">{h.note || '-'}</div>
                        <div className="mt-0.5 text-[11px] text-slate-400">Oleh: {h.changed_by_name}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Super Admin Delete Confirmation Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/50 p-4">
          <form
            onSubmit={handleConfirmDelete}
            className="w-full max-w-md rounded-xl bg-white border border-slate-200 p-6 space-y-4 shadow-xl"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">Hapus Order Operasional</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Tindakan ini khusus Super Admin. Order akan dinonaktifkan (soft delete) dari daftar aktif namun jejak
                  audit tetap tersimpan.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="text-slate-400 hover:text-slate-700"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-900 space-y-1">
              <div className="font-mono font-bold">{deleteTarget.order_number}</div>
              <div>
                {deleteTarget.customer_name} &middot; {deleteTarget.origin} → {deleteTarget.destination}
              </div>
              <div>
                Vendor: {deleteTarget.transporter_name} &middot; Status: <strong>{deleteTarget.status}</strong>
              </div>
            </div>

            <div className="text-xs">
              <label className="block font-medium text-slate-700 mb-1">Alasan Penghapusan (Opsional)</label>
              <input
                type="text"
                value={deleteReason}
                onChange={(e) => setDeleteReason(e.target.value)}
                placeholder="Contoh: Order duplikat / dibatalkan customer..."
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-rose-600 focus:outline-none"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={deleting}
                className="inline-flex items-center gap-1.5 rounded-lg bg-rose-700 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-800 disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {deleting ? 'Menghapus...' : 'Hapus Order'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
