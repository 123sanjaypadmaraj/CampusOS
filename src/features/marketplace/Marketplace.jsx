import React, { useEffect, useState } from "react";
import { HiPlus, HiXMark, HiShoppingCart, HiStar, HiCheckCircle, HiChatBubbleLeftRight } from "react-icons/hi2";
import { EmptyState } from "../../components/ui/States";
import { createMarketplaceListing, markMarketplaceListingSold } from "../../services/mvpService";
import { startConversation } from "../../services/messagingService";
import * as marketApi from "./api";

function Modal({ title, kicker, onClose, children }) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="feature-modal" onMouseDown={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}><HiXMark /></button>
        {kicker && <span className="section-kicker">{kicker}</span>}
        <h2>{title}</h2>
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

export default function Marketplace({ notify, authUser, openLogin, campusId, listings: dbListings = [], onChange, onOpenConversation }) {
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState(null);
  const [ratingSummaries, setRatingSummaries] = useState({});
  const [unrated, setUnrated] = useState([]);
  const [ratingTarget, setRatingTarget] = useState(null);

  const listings = dbListings;

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

      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
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

      {listings.length === 0 && (
        <EmptyState icon={<HiShoppingCart />} title="No listings yet" text="Be the first to list something for sale." />
      )}

      <div className="marketplace-grid">
        {listings.map((item) => {
          const summary = ratingSummaries[item.seller_id];
          return (
            <button key={item.id} className="listing-card" onClick={() => setSelected(item)}>
              <div className="listing-card-img">
                {item.image_urls?.[0] ? <img src={item.image_urls[0]} alt={item.title} /> : <HiShoppingCart />}
              </div>
              <b>{item.title}</b>
              <span className="listing-price">₹{item.price}</span>
              <div className="listing-meta">
                <span>{item.profiles?.name || "Campus seller"}</span>
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
        <CreateListingModal
          campusId={campusId}
          authUser={authUser}
          notify={notify}
          onClose={() => setCreating(false)}
          onCreated={(listing) => { onChange?.((items) => [listing, ...items]); setCreating(false); }}
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

function CreateListingModal({ campusId, authUser, notify, onClose, onCreated }) {
  const [form, setForm] = useState({ title: "", description: "", category: "Other", price: "", condition: "Used", location: "Campus" });
  const [saving, setSaving] = useState(false);
  const change = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <Modal kicker="MARKETPLACE" title="Create listing" onClose={onClose}>
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
      <button
        className="primary wide"
        disabled={saving || !form.title.trim() || Number(form.price) < 0}
        onClick={async () => {
          try {
            setSaving(true);
            const listing = await createMarketplaceListing({ userId: authUser.id, campusId, ...form });
            onCreated(listing);
            notify("Listing published");
          } catch (err) {
            notify(err.message || "Could not publish listing");
          } finally {
            setSaving(false);
          }
        }}
      >
        {saving ? "Publishing…" : "Publish listing"}
      </button>
    </Modal>
  );
}

function ListingDetailModal({ listing, authUser, openLogin, campusId, notify, onClose, onSold, onOpenConversation }) {
  const [summary, setSummary] = useState(null);
  const [reviews, setReviews] = useState([]);
  const [markingSold, setMarkingSold] = useState(false);
  const [messaging, setMessaging] = useState(false);
  const isOwner = listing.seller_id === authUser?.id;

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

  useEffect(() => {
    marketApi.getSellerRatingSummary([listing.seller_id]).then((m) => setSummary(m[listing.seller_id] || null)).catch(() => {});
    marketApi.getSellerReviews(listing.seller_id).then(setReviews).catch(() => {});
  }, [listing.seller_id]);

  return (
    <Modal kicker="LISTING" title={listing.title} onClose={onClose}>
      <div className="listing-card-img" style={{ height: 180, marginBottom: 14 }}>
        {listing.image_urls?.[0] ? <img src={listing.image_urls[0]} alt={listing.title} /> : <HiShoppingCart />}
      </div>
      <p style={{ color: "var(--muted)", fontSize: 13 }}>{listing.description || "No description provided."}</p>
      <div className="listing-meta" style={{ marginBottom: 10 }}>
        <span>{listing.category} · {listing.condition} · {listing.location}</span>
        <span className="listing-price">₹{listing.price}</span>
      </div>

      <h3 style={{ fontSize: 14, margin: "16px 0 8px" }}>Seller: {listing.profiles?.name || "Campus seller"}</h3>
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
        <button
          className="primary wide"
          disabled={markingSold}
          onClick={async () => { setMarkingSold(true); }}
        >
          Mark sold
        </button>
      ) : (
        <button className="primary wide" disabled={messaging} onClick={messageSeller}>
          <HiChatBubbleLeftRight /> {messaging ? "Starting…" : "Message seller"}
        </button>
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
          <button key={n} onClick={() => setRating(n)} style={{ fontSize: 26, color: n <= rating ? "#f0a83c" : "var(--border)" }}>
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
