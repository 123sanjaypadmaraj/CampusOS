import React, { useEffect, useId, useMemo, useState } from "react";
import {
  HiPlus, HiXMark, HiShoppingCart, HiStar, HiCheckCircle, HiChatBubbleLeftRight,
  HiMagnifyingGlass, HiPencilSquare, HiFlag, HiNoSymbol, HiClock, HiPhoto,
} from "react-icons/hi2";
import { EmptyState } from "../../components/ui/States";
import { createMarketplaceListing, markMarketplaceListingSold, reportContent } from "../../services/mvpService";
import { startConversation, blockUser } from "../../services/messagingService";
import * as marketApi from "./api";
import { useModalA11y } from "../../hooks/useModalA11y";

function Modal({ title, kicker, onClose, children }) {
  const titleId = useId();
  const dialogRef = useModalA11y(onClose);
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="feature-modal" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onMouseDown={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close"><HiXMark /></button>
        {kicker && <span className="section-kicker">{kicker}</span>}
        <h2 id={titleId}>{title}</h2>
        {children}
      </div>
    </div>
  );
}

function Stars({ value, size }) {
  const rounded = Math.round(Number(value) || 0);
  return (
    <span className="star-rating" style={size ? { fontSize: size } : undefined}>
      {[1, 2, 3, 4, 5].map((n) => <HiStar key={n} className={n <= rounded ? "" : "star-empty"} />)}
    </span>
  );
}

const CATEGORIES = ["Other", "Books & Notes", "Electronics", "Furniture", "Clothing", "Sports", "Stationery", "Cycles"];
const CONDITIONS = ["New", "Like New", "Used", "For Parts"];
const MAX_IMAGES = 6;

export default function Marketplace({ notify, authUser, openLogin, campusId, listings: dbListings = [], onChange, onOpenConversation }) {
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null);
  const [selected, setSelected] = useState(null);
  const [ratingSummaries, setRatingSummaries] = useState({});
  const [unrated, setUnrated] = useState([]);
  const [ratingTarget, setRatingTarget] = useState(null);

  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [conditionFilter, setConditionFilter] = useState("All");
  const [maxPrice, setMaxPrice] = useState("");

  const listings = dbListings;

  const filteredListings = useMemo(() => {
    const q = search.trim().toLowerCase();
    return listings.filter((item) => {
      if (q && !`${item.title} ${item.description || ""}`.toLowerCase().includes(q)) return false;
      if (categoryFilter !== "All" && item.category !== categoryFilter) return false;
      if (conditionFilter !== "All" && item.condition !== conditionFilter) return false;
      if (maxPrice !== "" && Number(item.price) > Number(maxPrice)) return false;
      return true;
    });
  }, [listings, search, categoryFilter, conditionFilter, maxPrice]);

  useEffect(() => {
    const sellerIds = [...new Set(listings.map((l) => l.seller_id).filter(Boolean))];
    if (sellerIds.length) {
      marketApi.getSellerRatingSummary(sellerIds).then(setRatingSummaries).catch(() => {});
    }
  }, [listings]);

  useEffect(() => {
    if (!authUser?.id) { setUnrated([]); return; }
    marketApi.getMyUnratedPurchases().then(setUnrated).catch(() => {});
  }, [authUser?.id, listings]);

  return (
    <div>
      {unrated.length > 0 && (
        <div className="ai-banner" style={{ marginTop: 0, marginBottom: 20 }}>
          <div>
            <span className="ai-icon"><HiStar /></span>
            <div>
              <h2 style={{ fontSize: 16 }}>Rate {unrated.length === 1 ? "your purchase" : `${unrated.length} purchases`}</h2>
              <p>You bought &ldquo;{unrated[0].title}&rdquo; from {unrated[0].seller_name}. How was it?</p>
            </div>
          </div>
          <button onClick={() => setRatingTarget(unrated[0])}>Rate now</button>
        </div>
      )}

      <div className="marketplace-toolbar" style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 16 }}>
        <label style={{ flex: "1 1 200px", position: "relative", margin: 0 }}>
          <HiMagnifyingGlass style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--muted)" }} />
          <input
            style={{ paddingLeft: 32, width: "100%" }}
            placeholder="Search listings…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} aria-label="Filter by category">
          <option value="All">All categories</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={conditionFilter} onChange={(e) => setConditionFilter(e.target.value)} aria-label="Filter by condition">
          <option value="All">Any condition</option>
          {CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <input
          type="number"
          min="0"
          placeholder="Max price ₹"
          aria-label="Maximum price"
          style={{ width: 120 }}
          value={maxPrice}
          onChange={(e) => setMaxPrice(e.target.value)}
        />
        <button
          className="primary"
          onClick={() => {
            if (!authUser) { openLogin?.(); notify("Sign in to create a listing"); return; }
            setCreating(true);
          }}
        >
          <HiPlus /> Create listing
        </button>
      </div>

      {filteredListings.length === 0 && (
        <EmptyState
          icon={<HiShoppingCart />}
          title={listings.length === 0 ? "No listings yet" : "No listings match your filters"}
          text={listings.length === 0 ? "Be the first to list something for sale." : "Try clearing a filter or searching for something else."}
        />
      )}

      <div className="marketplace-grid">
        {filteredListings.map((item) => {
          const summary = ratingSummaries[item.seller_id];
          return (
            <button key={item.id} className="listing-card" onClick={() => setSelected(item)}>
              <div className="listing-card-img">
                {item.image_urls?.[0] ? <img src={item.image_urls[0]} alt={item.title} /> : <HiShoppingCart />}
                {item.image_urls?.length > 1 && <span className="listing-image-count"><HiPhoto /> {item.image_urls.length}</span>}
              </div>
              <b>{item.title}</b>
              <span className="listing-price">₹{item.price}</span>
              <div className="listing-meta">
                <span>
                  {item.profiles?.name || "Campus seller"}
                  {item.profiles?.availability_status === "away" && <span className="availability-chip away" style={{ marginLeft: 6 }}>Away</span>}
                </span>
                {summary ? (
                  <span className="rating-summary"><Stars value={summary.avg_rating} /> <b>{summary.avg_rating}</b> ({summary.rating_count})</span>
                ) : (
                  <span>No ratings yet</span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {creating && (
        <ListingFormModal
          authUser={authUser}
          notify={notify}
          onClose={() => setCreating(false)}
          onSaved={(listing) => {
            onChange?.((items) => [{ ...listing, profiles: null }, ...items]);
            setCreating(false);
            notify("Listing published");
          }}
          submitLabel="Publish listing"
          onSubmit={(form) => createMarketplaceListing({ userId: authUser.id, campusId, ...form })}
        />
      )}

      {editing && (
        <ListingFormModal
          authUser={authUser}
          notify={notify}
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={(listing) => {
            onChange?.((items) => items.map((i) => (i.id === listing.id ? { ...i, ...listing } : i)));
            setSelected((s) => (s && s.id === listing.id ? { ...s, ...listing } : s));
            setEditing(null);
            notify("Listing updated");
          }}
          submitLabel="Save changes"
          onSubmit={(form) => marketApi.updateMarketplaceListing({ listingId: editing.id, ...form })}
        />
      )}

      {selected && (
        <ListingDetailModal
          listing={selected}
          authUser={authUser}
          openLogin={openLogin}
          campusId={campusId}
          notify={notify}
          onClose={() => setSelected(null)}
          onOpenConversation={onOpenConversation}
          onEdit={() => { setEditing(selected); setSelected(null); }}
          onSold={(listing) => {
            onChange?.((items) => items.filter((i) => i.id !== listing.id));
            setSelected(null);
          }}
        />
      )}

      {ratingTarget && (
        <RateSellerModal
          purchase={ratingTarget}
          notify={notify}
          onClose={() => setRatingTarget(null)}
          onRated={() => { setUnrated((list) => list.filter((p) => p.listing_id !== ratingTarget.listing_id)); setRatingTarget(null); }}
        />
      )}
    </div>
  );
}

// Shared create/edit form -- onSubmit does the actual create_marketplace_listing
// insert or update_marketplace_listing() RPC call, this just collects the
// fields + handles image upload, which is identical either way.
function ListingFormModal({ authUser, notify, initial, onClose, onSaved, submitLabel, onSubmit }) {
  const [form, setForm] = useState(() => ({
    title: initial?.title || "",
    description: initial?.description || "",
    category: initial?.category || "Other",
    price: initial?.price ?? "",
    condition: initial?.condition || "Used",
    location: initial?.location || "Campus",
    imageUrls: initial?.image_urls || [],
  }));
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [history, setHistory] = useState([]);
  const change = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    if (!initial?.id) return;
    marketApi.getListingEditHistory(initial.id).then(setHistory).catch(() => {});
  }, [initial?.id]);

  const addImages = async (fileList) => {
    const files = Array.from(fileList || []).slice(0, MAX_IMAGES - form.imageUrls.length);
    if (!files.length) return;
    try {
      setUploading(true);
      const urls = [];
      for (const file of files) {
        urls.push(await marketApi.uploadMarketplaceImage(file, authUser.id));
      }
      setForm((f) => ({ ...f, imageUrls: [...f.imageUrls, ...urls].slice(0, MAX_IMAGES) }));
    } catch (err) {
      notify(err.message || "Could not upload image");
    } finally {
      setUploading(false);
    }
  };

  return (
    <Modal kicker="MARKETPLACE" title={initial ? "Edit listing" : "Create listing"} onClose={onClose}>
      <label>Title<input value={form.title} onChange={(e) => change("title", e.target.value)} /></label>
      <label>Description<textarea rows={3} value={form.description} onChange={(e) => change("description", e.target.value)} /></label>
      <label>Category
        <select value={form.category} onChange={(e) => change("category", e.target.value)}>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </label>
      <label>Condition
        <select value={form.condition} onChange={(e) => change("condition", e.target.value)}>
          {CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </label>
      <label>Price (₹)<input type="number" min="0" value={form.price} onChange={(e) => change("price", e.target.value)} /></label>
      <label>Location<input value={form.location} onChange={(e) => change("location", e.target.value)} /></label>

      <label>Photos ({form.imageUrls.length}/{MAX_IMAGES})
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          disabled={uploading || form.imageUrls.length >= MAX_IMAGES}
          onChange={(e) => { addImages(e.target.files); e.target.value = ""; }}
        />
      </label>
      {uploading && <p style={{ fontSize: 12, color: "var(--muted)" }}>Uploading…</p>}
      {form.imageUrls.length > 0 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          {form.imageUrls.map((url, i) => (
            <div key={url} style={{ position: "relative" }}>
              <img src={url} alt={`Listing ${i + 1}`} style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 8 }} />
              <button
                type="button"
                className="modal-close"
                style={{ position: "absolute", top: -6, right: -6, width: 20, height: 20, fontSize: 10 }}
                onClick={() => setForm((f) => ({ ...f, imageUrls: f.imageUrls.filter((u) => u !== url) }))}
                aria-label={`Remove image ${i + 1}`}
              >
                <HiXMark />
              </button>
            </div>
          ))}
        </div>
      )}

      <button
        className="primary wide"
        disabled={saving || uploading || !form.title.trim() || Number(form.price) < 0}
        onClick={async () => {
          try {
            setSaving(true);
            const listing = await onSubmit(form);
            onSaved(listing);
          } catch (err) {
            notify(err.message || "Could not save this listing");
          } finally {
            setSaving(false);
          }
        }}
      >
        {saving ? "Saving…" : submitLabel}
      </button>

      {history.length > 0 && (
        <details style={{ marginTop: 14 }}>
          <summary style={{ cursor: "pointer", fontSize: 12, color: "var(--muted)" }}>
            <HiClock style={{ verticalAlign: "-2px" }} /> Edit history ({history.length})
          </summary>
          <div style={{ marginTop: 8 }}>
            {history.map((h) => (
              <div key={h.id} className="review-row">
                <div className="review-row-head">
                  <small>{new Date(h.created_at).toLocaleString()}</small>
                </div>
                <p style={{ fontSize: 12 }}>
                  {h.old_values.title !== h.new_values.title && <>Title: &ldquo;{h.old_values.title}&rdquo; → &ldquo;{h.new_values.title}&rdquo;<br /></>}
                  {Number(h.old_values.price) !== Number(h.new_values.price) && <>Price: ₹{h.old_values.price} → ₹{h.new_values.price}<br /></>}
                  {h.old_values.condition !== h.new_values.condition && <>Condition: {h.old_values.condition} → {h.new_values.condition}<br /></>}
                  {h.old_values.category !== h.new_values.category && <>Category: {h.old_values.category} → {h.new_values.category}</>}
                </p>
              </div>
            ))}
          </div>
        </details>
      )}
    </Modal>
  );
}

function ListingDetailModal({ listing, authUser, openLogin, campusId, notify, onClose, onSold, onOpenConversation, onEdit }) {
  const [summary, setSummary] = useState(null);
  const [reviews, setReviews] = useState([]);
  const [markingSold, setMarkingSold] = useState(false);
  const [messaging, setMessaging] = useState(false);
  const [blocking, setBlocking] = useState(false);
  const [activeImage, setActiveImage] = useState(0);
  const isOwner = listing.seller_id === authUser?.id;
  const images = listing.image_urls?.length ? listing.image_urls : [];
  const canEdit = isOwner && ["active", "pending"].includes(listing.status);

  const messageSeller = async () => {
    if (!authUser) {
      openLogin?.();
      notify("Sign in to message the seller");
      return;
    }
    try {
      setMessaging(true);
      const conversationId = await startConversation(listing.seller_id, listing.id);
      onClose();
      onOpenConversation?.(conversationId);
    } catch (err) {
      notify(err.message || "Could not start a conversation with the seller");
    } finally {
      setMessaging(false);
    }
  };

  const reportListing = async () => {
    if (!authUser) { openLogin?.(); notify("Sign in to report a listing"); return; }
    const reason = window.prompt("Why are you reporting this listing? (prohibited item, scam, spam, etc.)");
    if (!reason?.trim()) return;
    try {
      await reportContent("marketplace_listing", listing.id, reason.trim());
      notify("Reported to campus moderators");
    } catch (err) {
      notify(err.message || "Could not report this listing");
    }
  };

  const blockSeller = async () => {
    if (!authUser) { openLogin?.(); notify("Sign in first"); return; }
    if (!window.confirm(`Block ${listing.profiles?.name || "this seller"}? They won't be able to message you anymore.`)) return;
    try {
      setBlocking(true);
      await blockUser(listing.seller_id);
      notify(`Blocked ${listing.profiles?.name || "this seller"}`);
    } catch (err) {
      notify(err.message || "Could not block this seller");
    } finally {
      setBlocking(false);
    }
  };

  useEffect(() => {
    marketApi.getSellerRatingSummary([listing.seller_id]).then((m) => setSummary(m[listing.seller_id] || null)).catch(() => {});
    marketApi.getSellerReviews(listing.seller_id).then(setReviews).catch(() => {});
  }, [listing.seller_id]);

  return (
    <Modal kicker="LISTING" title={listing.title} onClose={onClose}>
      <div className="listing-card-img" style={{ height: 180, marginBottom: 8 }}>
        {images[activeImage] ? <img src={images[activeImage]} alt={listing.title} /> : <HiShoppingCart />}
      </div>
      {images.length > 1 && (
        <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
          {images.map((url, i) => (
            <button
              key={url}
              onClick={() => setActiveImage(i)}
              style={{ padding: 0, border: i === activeImage ? "2px solid var(--accent)" : "2px solid transparent", borderRadius: 6 }}
            >
              <img src={url} alt="" style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 4, display: "block" }} />
            </button>
          ))}
        </div>
      )}

      <p style={{ color: "var(--muted)", fontSize: 13 }}>{listing.description || "No description provided."}</p>
      <div className="listing-meta" style={{ marginBottom: 10 }}>
        <span>{listing.category} · {listing.condition} · {listing.location}</span>
        <span className="listing-price">₹{listing.price}</span>
      </div>
      {listing.expires_at && listing.status === "active" && (
        <p style={{ fontSize: 11, color: "var(--muted)", marginTop: -6 }}>
          <HiClock style={{ verticalAlign: "-2px" }} /> Listed until {new Date(listing.expires_at).toLocaleDateString()}
        </p>
      )}

      <h3 style={{ fontSize: 14, margin: "16px 0 8px" }}>
        Seller: {listing.profiles?.name || "Campus seller"}
        {listing.profiles?.availability_status === "away" && (
          <span className="availability-chip away" style={{ marginLeft: 8 }}>
            Away{listing.profiles?.availability_message ? ` · ${listing.profiles.availability_message}` : ""}
          </span>
        )}
      </h3>
      {summary ? (
        <div className="rating-summary" style={{ marginBottom: 12 }}>
          <Stars value={summary.avg_rating} /> <b>{summary.avg_rating}</b> · {summary.rating_count} rating{summary.rating_count === 1 ? "" : "s"}
        </div>
      ) : (
        <p style={{ color: "var(--muted)", fontSize: 12, marginBottom: 12 }}>No ratings yet.</p>
      )}
      {reviews.slice(0, 3).map((r) => (
        <div className="review-row" key={r.id}>
          <div className="review-row-head">
            <b>{r.rater?.name || "Buyer"}</b>
            <Stars value={r.rating} size="11px" />
          </div>
          {r.comment && <p>{r.comment}</p>}
        </div>
      ))}

      {isOwner ? (
        <>
          {canEdit && (
            <button className="ghost wide" style={{ marginBottom: 8 }} onClick={onEdit}>
              <HiPencilSquare /> Edit listing
            </button>
          )}
          {listing.status === "active" && (
            <button
              className="primary wide"
              disabled={markingSold}
              onClick={async () => { setMarkingSold(true); }}
            >
              Mark sold
            </button>
          )}
        </>
      ) : (
        <>
          <button className="primary wide" disabled={messaging} onClick={messageSeller}>
            <HiChatBubbleLeftRight /> {messaging ? "Starting…" : "Message seller"}
          </button>
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button className="ghost" style={{ flex: 1 }} onClick={reportListing}>
              <HiFlag /> Report
            </button>
            <button className="ghost" style={{ flex: 1 }} disabled={blocking} onClick={blockSeller}>
              <HiNoSymbol /> Block seller
            </button>
          </div>
        </>
      )}

      {markingSold && (
        <MarkSoldModal
          listing={listing}
          campusId={campusId}
          authUser={authUser}
          notify={notify}
          onClose={() => setMarkingSold(false)}
          onSold={onSold}
        />
      )}
    </Modal>
  );
}

function MarkSoldModal({ listing, campusId, authUser, notify, onClose, onSold }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [buyer, setBuyer] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const handle = setTimeout(() => {
      if (query.trim().length < 2) { setResults([]); return; }
      marketApi.searchBuyers(campusId, query)
        .then((people) => setResults(people.filter((p) => p.id !== authUser?.id)))
        .catch(() => {});
    }, 250);
    return () => clearTimeout(handle);
  }, [query, campusId, authUser?.id]);

  const confirm = async (withBuyer) => {
    try {
      setSaving(true);
      const updated = await markMarketplaceListingSold({ listingId: listing.id, buyerId: withBuyer?.id || null });
      notify(withBuyer ? `Marked sold to ${withBuyer.name}` : "Listing marked sold");
      onSold(updated);
      onClose();
    } catch (err) {
      notify(err.message || "Could not update listing");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal kicker="MARK SOLD" title={`Who bought "${listing.title}"?`} onClose={onClose}>
      <p style={{ color: "var(--muted)", fontSize: 12 }}>
        Picking the buyer lets them leave you a rating. You can skip this if you sold it off-platform.
      </p>
      <label>Search by name<input value={query} onChange={(e) => { setQuery(e.target.value); setBuyer(null); }} placeholder="Start typing a name…" /></label>
      {results.map((p) => (
        <div className="buyer-pick-row" key={p.id}>
          <span>{p.name} <small style={{ color: "var(--muted)" }}>{p.course || ""}</small></span>
          <button className={buyer?.id === p.id ? "primary" : "ghost"} onClick={() => setBuyer(p)}>
            {buyer?.id === p.id ? <><HiCheckCircle /> Selected</> : "Select"}
          </button>
        </div>
      ))}
      <button className="primary wide" disabled={saving || !buyer} onClick={() => confirm(buyer)}>
        {saving ? "Saving…" : buyer ? `Mark sold to ${buyer.name}` : "Select a buyer above"}
      </button>
      <button className="ghost wide" disabled={saving} onClick={() => confirm(null)}>
        Mark sold without a buyer
      </button>
    </Modal>
  );
}

function RateSellerModal({ purchase, notify, onClose, onRated }) {
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);

  return (
    <Modal kicker="RATE SELLER" title={`Rate ${purchase.seller_name}`} onClose={onClose}>
      <p style={{ color: "var(--muted)", fontSize: 12 }}>For &ldquo;{purchase.title}&rdquo;</p>
      <div style={{ display: "flex", gap: 6, margin: "14px 0" }}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} onClick={() => setRating(n)} style={{ fontSize: 26, color: n <= rating ? "#f0a83c" : "var(--border)" }} aria-label={`Rate ${n} star${n > 1 ? "s" : ""}`} aria-pressed={n <= rating}>
            <HiStar />
          </button>
        ))}
      </div>
      <label>Comment (optional)<textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} /></label>
      <button
        className="primary wide"
        disabled={saving}
        onClick={async () => {
          try {
            setSaving(true);
            await marketApi.submitSellerRating({ sellerId: purchase.seller_id, listingId: purchase.listing_id, rating, comment });
            notify("Thanks for rating!");
            onRated();
          } catch (err) {
            notify(err.message || "Could not submit rating");
          } finally {
            setSaving(false);
          }
        }}
      >
        {saving ? "Submitting…" : "Submit rating"}
      </button>
    </Modal>
  );
}
