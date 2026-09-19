import React, { useEffect, useState } from "react";
import { FEATURES } from "../../config/features";
import { getCurrentUser, getPrintBindingRates, getPrintRateCard, getPrintShopStatus, startPrintJobPayment, uploadPrintJob, validatePrintFile } from "../../services/mvpService";
import { calculatePrintJobPrice } from "../../utils/mvpHelpers";
import { openRazorpayCheckout } from "../payments/razorpay";
import { HiCheck, HiCreditCard, HiDocumentArrowUp, HiExclamationTriangle } from "react-icons/hi2";
import { ModalShell } from "../../components/ui/Shell";

const PRINT_PAPER_SIZES = ["A4", "A3", "Letter"];

const PRINT_BINDING_OPTIONS = [
  { value: "none", label: "No binding" },
  { value: "staple", label: "Staple" },
  { value: "spiral", label: "Spiral" },
];

function PrintModal({ onClose, setPrintFile, notify, authUser, user, campusId }) {
  const [file, setFile] = useState(null);
  const [fileError, setFileError] = useState("");
  const [pages, setPages] = useState(12);
  const [copies, setCopies] = useState(1);
  const [color, setColor] = useState("black_white");
  const [paperSize, setPaperSize] = useState("A4");
  const [duplex, setDuplex] = useState(false);
  const [binding, setBinding] = useState("none");
  const [rateCard, setRateCard] = useState([]);
  const [bindingRates, setBindingRates] = useState(null);
  const [shopStatus, setShopStatus] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!campusId) return;
    Promise.all([getPrintRateCard(campusId), getPrintBindingRates(campusId), getPrintShopStatus(campusId)])
      .then(([rates, binding_, status]) => {
        setRateCard(rates);
        setBindingRates(binding_);
        setShopStatus(status);
      })
      .catch(() => {});
  }, [campusId]);

  const pricePerPage = rateCard.find((r) => r.color_mode === color)?.price_per_page;
  const bindingFee = binding === "staple" ? bindingRates?.staple_fee : binding === "spiral" ? bindingRates?.spiral_fee : 0;
  let estimate = null;
  try {
    estimate = calculatePrintJobPrice({
      pages, copies, colorMode: color, binding: binding !== "none",
      pricePerPage, bindingFee,
    });
  } catch { /* invalid pages/copies while typing -- just hide the estimate */ }

  return (
    <ModalShell kicker="PRINT HUB" title="Upload & print" onClose={onClose}>
      {shopStatus && shopStatus.status !== "online" && (
        <div className="offline-banner" role="status">
          <HiExclamationTriangle /> The print shop is currently {shopStatus.status}
          {shopStatus.message ? ` — ${shopStatus.message}` : ""}. You can still place an order; it will be queued once the shop is back.
        </div>
      )}

      <label>
        Document (PDF only, max 25MB)
        <input
          type="file"
          accept="application/pdf"
          onChange={(event) => {
            const selected = event.target.files?.[0] || null;
            setFileError("");
            if (selected) {
              try {
                validatePrintFile(selected);
              } catch (err) {
                setFileError(err.message);
                setFile(null);
                setPrintFile(null);
                return;
              }
            }
            setFile(selected);
            setPrintFile(selected);
          }}
        />
      </label>

      {fileError && <p style={{ color: "#c23a3a", fontSize: 12 }}>{fileError}</p>}

      {file && (
        <div className="file-chip">
          <HiDocumentArrowUp />
          {file.name}
          <HiCheck />
        </div>
      )}

      <div className="form-grid">
        <label>
          Pages
          <input type="number" min="1" max="500" value={pages} onChange={(event) => setPages(event.target.value)} />
        </label>

        <label>
          Copies
          <input type="number" min="1" max="100" value={copies} onChange={(event) => setCopies(event.target.value)} />
        </label>

        <label>
          Print mode
          <select value={color} onChange={(event) => setColor(event.target.value)}>
            <option value="black_white">B&W</option>
            <option value="colour">Colour</option>
          </select>
        </label>

        <label>
          Paper size
          <select value={paperSize} onChange={(event) => setPaperSize(event.target.value)}>
            {PRINT_PAPER_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}
          </select>
        </label>

        <label>
          Binding
          <select value={binding} onChange={(event) => setBinding(event.target.value)}>
            {PRINT_BINDING_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
          </select>
        </label>

        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="checkbox" checked={duplex} onChange={(event) => setDuplex(event.target.checked)} />
          Double-sided (duplex)
        </label>
      </div>

      <div className="price-preview">
        <span>Estimated total</span>
        <b>{estimate != null ? `₹${estimate}` : "—"}</b>
      </div>
      <p style={{ fontSize: 12, opacity: 0.7 }}>Final price is confirmed by the print shop&apos;s current rate card at checkout.</p>

      <button
        className="primary wide"
        disabled={submitting || !FEATURES.printPayments}
        onClick={async () => {
          try {
            if (!FEATURES.printPayments) {
              notify("Print ordering is temporarily paused — check back soon.");
              return;
            }

            if (!file) {
              notify("Choose a document first");
              return;
            }

            const currentUser = authUser || await getCurrentUser();
            if (!currentUser) {
              notify("Sign in before printing");
              return;
            }

            setSubmitting(true);

            const job = await uploadPrintJob({
              userId: currentUser.id,
              file,
              pages: Number(pages),
              copies: Number(copies),
              colorMode: color,
              paperSize,
              binding,
              duplex,
            });

            notify(`Print job created · ₹${job.price} — opening payment…`);

            try {
              const payment = await startPrintJobPayment(job.id);
              await openRazorpayCheckout({
                keyId: payment.key_id,
                gatewayOrderId: payment.gateway_order_id,
                amount: payment.amount,
                currency: payment.currency,
                description: `Print job · ${job.pickup_code}`,
                prefillEmail: currentUser.email,
                prefillName: user?.name,
                onDismiss: () => notify("Payment cancelled — you can pay again from My Activity"),
              });
              notify(`Once payment clears, pickup code ${job.pickup_code} will be shown in My Activity.`);
            } catch (paymentError) {
              console.error("Print payment start failed:", paymentError);
              notify(
                paymentError.message?.includes("GATEWAY_NOT_CONFIGURED") || paymentError.message?.includes("not configured")
                  ? "Job created, but payments aren't configured on this deployment yet."
                  : (paymentError.message || "Payment could not be started. Try again from My Activity.")
              );
            }

            onClose();
          } catch (error) {
            console.error("Print job:", error);
            notify(error.message || "Unable to create print job");
          } finally {
            setSubmitting(false);
          }
        }}
      >
        {!FEATURES.printPayments ? "Print ordering paused" : submitting ? "Working…" : "Continue to payment"} <HiCreditCard />
      </button>
    </ModalShell>
  );
}

export { PRINT_BINDING_OPTIONS, PRINT_PAPER_SIZES, PrintModal };
