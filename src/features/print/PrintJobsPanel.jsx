import React, { useEffect, useState } from "react";
import { EmptyState } from "../../components/ui/States";
import { cancelPrintJob, startPrintJobRefund } from "../../services/mvpService";
import QRCode from "qrcode";
import { HiPrinter } from "react-icons/hi2";

const PRINT_CANCELLABLE_STATUSES = new Set(["AWAITING_PAYMENT", "UPLOADED", "PROCESSING", "QUEUED", "FAILED"]);

const PRINT_QR_STATUSES = new Set(["UPLOADED", "PROCESSING", "QUEUED", "PRINTING", "READY"]);

function PrintJobRow({ job, notify, onChange }) {
  const [qrUrl, setQrUrl] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!PRINT_QR_STATUSES.has(job.status) || !job.pickup_code) { setQrUrl(""); return; }
    let cancelled = false;
    QRCode.toDataURL(job.pickup_code, { width: 140, margin: 1, color: { dark: "#17151f", light: "#ffffff" } })
      .then((url) => { if (!cancelled) setQrUrl(url); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [job.status, job.pickup_code]);

  const cancel = async () => {
    if (busy) return;
    try {
      setBusy(true);
      const result = await cancelPrintJob(job.id, "Cancelled by student");
      if (result?.refund_id) {
        try {
          await startPrintJobRefund(result.refund_id);
          notify("Print job cancelled — refund processed.");
        } catch (refundError) {
          console.error("Print refund:", refundError);
          notify("Print job cancelled — refund is processing, check My Activity shortly.");
        }
      } else {
        notify("Print job cancelled.");
      }
      onChange?.();
    } catch (error) {
      notify(error.message || "Could not cancel this job");
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="resource-row">
      <div className="resource-icon"><HiPrinter /></div>
      <div>
        <b>{job.file_name}</b>
        <small>
          {job.pages} pages · {job.copies} {job.copies === 1 ? "copy" : "copies"} · {job.color_mode === "colour" ? "Colour" : "B&W"} ·{" "}
          {job.paper_size}{job.duplex ? " · Duplex" : ""}{job.binding && job.binding !== "none" ? ` · ${job.binding}` : ""}
          {job.price != null ? ` · ₹${job.price}` : ""}
        </small>
        {job.status === "CANCELLED" && job.cancel_reason && <small>Reason: {job.cancel_reason}</small>}
      </div>
      <strong>{job.status.replace(/_/g, " ")}</strong>
      {qrUrl && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
          <img src={qrUrl} alt={`Pickup QR for code ${job.pickup_code}`} width={64} height={64} />
          <small>{job.pickup_code}</small>
        </div>
      )}
      {PRINT_CANCELLABLE_STATUSES.has(job.status) && (
        <button className="ghost" disabled={busy} onClick={cancel}>
          {busy ? "Cancelling…" : "Cancel"}
        </button>
      )}
    </article>
  );
}

function PrintJobsPanel({ jobs, notify, onChange }) {
  if (!jobs?.length) {
    return <EmptyState icon={<HiPrinter />} title="No print jobs yet" text="Upload a document above to get started." />;
  }
  return (
    <div className="resource-list">
      {jobs.map((job) => <PrintJobRow key={job.id} job={job} notify={notify} onChange={onChange} />)}
    </div>
  );
}

export { PRINT_CANCELLABLE_STATUSES, PRINT_QR_STATUSES, PrintJobRow, PrintJobsPanel };
