import React, { useEffect, useState } from "react";
import { EmptyState, LoadingState } from "../../components/ui/States";
import { claimLostFoundItem, createLostFoundItemWithImages, listLostFoundMatches, reportContent, uploadLostFoundImage } from "../../services/mvpService";
import { HiMagnifyingGlassCircle, HiPlus } from "react-icons/hi2";
import { ModalShell } from "../../components/ui/Shell";

const LOST_FOUND_CATEGORIES = ["Electronics", "ID card", "Bag", "Documents", "Keys", "Clothing", "Other"];

function LostFoundClaimModal({ item, authUser, notify, onClose, onClaimed }) {
  const [proof, setProof] = useState("");
  const [image, setImage] = useState(null);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!proof.trim()) { notify("Describe how you can prove this item is yours"); return; }
    try {
      setSaving(true);
      let proofText = proof.trim();
      if (image) {
        const url = await uploadLostFoundImage(image, authUser.id);
        proofText += `\n\nProof photo: ${url}`;
      }
      await claimLostFoundItem({ itemId: item.id, userId: authUser.id, proof: proofText });
      notify("Claim submitted — staff will verify and contact you");
      onClaimed();
    } catch (error) {
      notify(error.message || "Could not claim item");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell kicker="CLAIM ITEM" title={`Claim "${item.title}"`} onClose={onClose}>
      <label>How can you prove this is yours?
        <textarea rows={3} value={proof} onChange={(e) => setProof(e.target.value)} placeholder="A unique mark, what's inside, receipt details, a matching photo…" />
      </label>
      <label>Proof photo (optional)
        <input type="file" accept="image/*" onChange={(e) => setImage(e.target.files?.[0] || null)} />
      </label>
      <p style={{ color: "var(--muted)", fontSize: 13 }}>Staff will verify your claim before handover — this doesn&rsquo;t hand the item over automatically.</p>
      <button className="primary wide" disabled={saving || !proof.trim()} onClick={submit}>
        {saving ? "Submitting…" : "Submit claim"}
      </button>
    </ModalShell>
  );
}

function LostFoundMatchesPanel({ itemId, notify }) {
  const [matches, setMatches] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listLostFoundMatches(itemId)
      .then(setMatches)
      .catch((err) => { notify(err.message || "Could not load possible matches"); setMatches([]); })
      .finally(() => setLoading(false));
  }, [itemId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <LoadingState label="Looking for possible matches…" />;
  if (!matches?.length) return <EmptyState title="No possible matches yet" text="We'll notify you if a matching report comes in." />;

  return (
    <div className="resource-list">
      {matches.map((m) => (
        <article className="resource-row" key={m.id}>
          <div className="resource-icon"><HiMagnifyingGlassCircle /></div>
          <div>
            <b>{m.title}</b>
            <small>{m.item_type === "found" ? "Found" : "Lost"} · {m.category} · {m.location}</small>
            {m.description && <small>{m.description}</small>}
          </div>
        </article>
      ))}
    </div>
  );
}

const LOST_FOUND_FILTERS = ["all", "lost", "found"];

function LostService({ notify, authUser, openLogin, campusId, items: dbItems = [], loaded = true, onChange }) {
  const [reporting, setReporting] = useState(false);
  const [itemType, setItemType] = useState("lost");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("Other");
  const [location, setLocation] = useState("");
  const [reportImages, setReportImages] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [claimingItem, setClaimingItem] = useState(null);
  const [matchesFor, setMatchesFor] = useState(null);
  const [typeFilter, setTypeFilter] = useState("all");
  const [search, setSearch] = useState("");

  const resetForm = () => {
    setItemType("lost");
    setTitle("");
    setDescription("");
    setCategory("Other");
    setLocation("");
    setReportImages([]);
  };

  const filtered = dbItems.filter((item) => {
    if (typeFilter !== "all" && item.item_type !== typeFilter) return false;
    if (search.trim() && !`${item.title} ${item.description} ${item.category} ${item.location}`.toLowerCase().includes(search.trim().toLowerCase())) return false;
    return true;
  });

  if (loaded && dbItems.length === 0 && !reporting) {
    return (
      <div className="resource-list">
        <EmptyState
          icon={<HiMagnifyingGlassCircle />}
          title="No open reports right now"
          text="Nobody has reported a lost or found item yet. Be the first."
        />
        <button className="primary" onClick={() => setReporting(true)}>
          <HiPlus /> Report an item
        </button>
      </div>
    );
  }

  return (
    <div className="resource-list">
      {!loaded && <LoadingState label="Loading lost & found reports…" />}

      {loaded && dbItems.length > 0 && (
        <div className="socialize-filter-row">
          {LOST_FOUND_FILTERS.map((f) => (
            <button key={f} className={typeFilter === f ? "chip active" : "chip"} onClick={() => setTypeFilter(f)}>
              {f === "all" ? "All" : f === "lost" ? "Lost" : "Found"}
            </button>
          ))}
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by keyword, category or location"
            aria-label="Search lost and found by keyword, category or location"
            style={{ flex: 1, minWidth: 160, padding: "8px 12px", borderRadius: 999, border: "1px solid var(--line)" }}
          />
        </div>
      )}

      {loaded && dbItems.length > 0 && filtered.length === 0 && (
        <EmptyState title="No matches" text="Try a different filter or search term." />
      )}

      {loaded && filtered.map((item) => (
        <article className="resource-row" key={item.id}>
          {item.image_urls?.[0] ? (
            <img src={item.image_urls[0]} alt="" className="resource-icon" style={{ objectFit: "cover" }} />
          ) : (
            <div className="resource-icon"><HiMagnifyingGlassCircle /></div>
          )}
          <div>
            <b>{item.title}</b>
            <small>
              {item.item_type === "found" ? "Found" : "Lost"} · {item.category} · {item.location}
              {item.status === "claim_pending" ? " · Claim pending staff verification" : ""}
            </small>
          </div>
          <div className="chips">
            <button className="ghost" onClick={() => setMatchesFor(item)}>Matches</button>
            {item.status === "claim_pending" ? (
              <strong>Pending</strong>
            ) : (
              <button onClick={() => {
                if (!authUser) { openLogin?.(); notify("Sign in to claim an item"); return; }
                setClaimingItem(item);
              }}>
                Claim
              </button>
            )}
            <button className="ghost" onClick={async () => {
              if (!authUser) { openLogin?.(); notify("Sign in to report an item"); return; }
              const reason = window.prompt("Why are you reporting this item? (scam, bogus, spam, etc.)");
              if (!reason?.trim()) return;
              try {
                await reportContent("lost_found_item", item.id, reason.trim());
                notify("Reported to campus moderators");
              } catch (error) {
                notify(error.message || "Could not report this item");
              }
            }}>
              Report
            </button>
          </div>
        </article>
      ))}
      <button className="primary" onClick={() => setReporting(true)}>
        <HiPlus /> Report an item
      </button>
      {reporting && (
        <ModalShell kicker="LOST & FOUND" title="Report an item" onClose={() => { setReporting(false); resetForm(); }}>
          <div className="segmented-toggle">
            <button type="button" className={itemType === "lost" ? "active" : ""} onClick={() => setItemType("lost")}>I lost something</button>
            <button type="button" className={itemType === "found" ? "active" : ""} onClick={() => setItemType("found")}>I found something</button>
          </div>
          <label>Item title<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Black backpack" /></label>
          <label>Category
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              {LOST_FOUND_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label>{itemType === "found" ? "Where you found it" : "Last seen location"}<input value={location} onChange={(e) => setLocation(e.target.value)} /></label>
          <label>Description (optional)<textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Distinguishing details help the other person prove ownership" /></label>
          <label>Photos (optional)
            <input type="file" accept="image/*" multiple onChange={(e) => setReportImages(Array.from(e.target.files || []))} />
          </label>
          {reportImages.length > 0 && <small>{reportImages.length} photo{reportImages.length === 1 ? "" : "s"} selected</small>}
          <button className="primary wide" disabled={submitting} onClick={async () => {
            if (!authUser) { openLogin?.(); notify("Sign in to report an item"); return; }
            try {
              setSubmitting(true);
              const imageUrls = [];
              for (const file of reportImages) {
                imageUrls.push(await uploadLostFoundImage(file, authUser.id));
              }
              const item = await createLostFoundItemWithImages({ userId: authUser.id, campusId, itemType, title, description, category, location, imageUrls });
              onChange?.((items) => [item, ...items]);
              setReporting(false);
              resetForm();
              notify(itemType === "found" ? "Found item reported — thanks for helping out" : "Lost item reported");
            } catch (error) {
              notify(error.message || "Could not report item");
            } finally {
              setSubmitting(false);
            }
          }}>
            {submitting ? "Submitting…" : "Submit report"}
          </button>
        </ModalShell>
      )}

      {claimingItem && (
        <LostFoundClaimModal
          item={claimingItem}
          authUser={authUser}
          notify={notify}
          onClose={() => setClaimingItem(null)}
          onClaimed={() => {
            onChange?.((items) => items.map((i) => (i.id === claimingItem.id ? { ...i, status: "claim_pending" } : i)));
            setClaimingItem(null);
          }}
        />
      )}

      {matchesFor && (
        <ModalShell kicker="POSSIBLE MATCHES" title={`Matches for "${matchesFor.title}"`} onClose={() => setMatchesFor(null)}>
          <LostFoundMatchesPanel itemId={matchesFor.id} notify={notify} />
        </ModalShell>
      )}
    </div>
  );
}

export { LOST_FOUND_CATEGORIES, LOST_FOUND_FILTERS, LostFoundClaimModal, LostFoundMatchesPanel, LostService };
