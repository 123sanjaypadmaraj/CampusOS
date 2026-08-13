import React from "react";
import { calculateOrderSummary } from "../utils/orderCalculator";
import {
  HiShoppingCart,
  HiCreditCard,
  HiPlus,
  HiMinus,
  HiTrash,
  HiReceiptPercent,
  HiBuildingStorefront,
  HiUser,
  HiCheckCircle,
  HiInformationCircle,
  HiSparkles,
} from "react-icons/hi2";

/**
 * CheckoutInvoice Component
 * 
 * Renders a clean digital food-order invoice for Campus OS.
 * 
 * Props:
 * - cart: Raw or grouped cart items array
 * - type: "food" | "store"
 * - user: User object or null
 * - onUpdateQuantity: Function(itemId, delta) to change item quantity
 * - onRemoveItem: Function(itemId) to remove an item completely
 * - onClearCart: Function() to clear the entire cart
 * - onClose: Function() to close modal
 * - notify: Function(message) to display toast notification
 */
const CheckoutInvoice = ({
  cart = [],
  type = "food",
  user = null,
  onUpdateQuantity,
  onRemoveItem,
  onClearCart,
  onClose,
  notify,
}) => {
  // Calculate authoritative summary for frontend display
  const summary = calculateOrderSummary(cart);

  const customerName = user?.name || "Sanjay Padmaraj";
  const customerMeta = user
    ? `${user.year} · ${user.course}`
    : "2nd Year · Computer Science & Engineering";

  const handlePayNow = () => {
    if (summary.items.length === 0) return;
    if (notify) {
      notify(
        `[Razorpay Placeholder] Ready to process payment of ₹${summary.finalTotal.toFixed(
          2
        )}`
      );
    }
  };

  if (summary.items.length === 0) {
    return (
      <div className="invoice-empty-container">
        <div className="empty-state">
          <div className="empty-icon-wrap">
            <HiShoppingCart />
          </div>
          <h3>Your cart is empty</h3>
          <p>Add some delicious items from the canteen or supplies from the store to generate an invoice.</p>
          <button className="primary wide" onClick={onClose} style={{ marginTop: "16px" }}>
            Return to {type === "food" ? "Food Hub" : "Campus Store"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="digital-invoice-wrap">
      {/* Digital Invoice Container */}
      <div className="digital-invoice">
        {/* Invoice Header Badge */}
        <div className="invoice-header">
          <div className="invoice-brand">
            <span className="brand-mark">C</span>
            <div>
              <b className="invoice-title">CampusOS Order Invoice</b>
              <small className="invoice-subtitle">
                {type === "food" ? "Canteen Digital Receipt" : "Campus Store Receipt"}
              </small>
            </div>
          </div>
          <div className="invoice-meta-badge">
            <span className="invoice-status">ORDER DRAFT</span>
            <span className="invoice-id">INV-{Math.floor(100000 + Math.random() * 900000)}</span>
          </div>
        </div>

        {/* Customer & Location Meta Bar */}
        <div className="invoice-info-grid">
          <div className="info-block">
            <span className="info-label">
              <HiUser /> CUSTOMER
            </span>
            <strong className="info-val">{customerName}</strong>
            <small className="info-sub">{customerMeta}</small>
          </div>

          <div className="info-block">
            <span className="info-label">
              <HiBuildingStorefront /> LOCATION / PICKUP
            </span>
            <strong className="info-val">
              {type === "food" ? "Canteen Main Counter" : "Campus Store Block B"}
            </strong>
            <small className="info-sub">New Horizon Campus</small>
          </div>
        </div>

        {/* Invoice Items Section */}
        <div className="invoice-section">
          <div className="section-title-row">
            <span className="section-kicker">ITEMS ORDERED ({summary.itemCount})</span>
            {onClearCart && (
              <button className="clear-cart-text-btn" onClick={onClearCart} title="Clear all items">
                Clear Cart
              </button>
            )}
          </div>

          <div className="invoice-items-table">
            <div className="table-head">
              <span className="col-item">Item</span>
              <span className="col-qty text-center">Qty</span>
              <span className="col-price text-right">Unit Price</span>
              <span className="col-total text-right">Subtotal</span>
            </div>

            <div className="table-body">
              {summary.items.map((item) => (
                <div className="table-row" key={item.id}>
                  <div className="col-item item-detail">
                    <strong className="item-name">{item.name}</strong>
                    <span className="item-vendor-badge">{item.vendor}</span>
                  </div>

                  <div className="col-qty qty-controls-cell text-center">
                    <div className="qty-pill">
                      <button
                        className="qty-btn minus"
                        onClick={() => onUpdateQuantity && onUpdateQuantity(item.id, -1)}
                        aria-label="Decrease quantity"
                      >
                        <HiMinus />
                      </button>
                      <span className="qty-val">{item.quantity}</span>
                      <button
                        className="qty-btn plus"
                        onClick={() => onUpdateQuantity && onUpdateQuantity(item.id, 1)}
                        aria-label="Increase quantity"
                      >
                        <HiPlus />
                      </button>
                    </div>
                  </div>

                  <div className="col-price text-right price-text">
                    ₹{item.unitPrice.toFixed(2)}
                  </div>

                  <div className="col-total text-right subtotal-text">
                    ₹{item.itemSubtotal.toFixed(2)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Invoice Breakdown & Summary */}
        <div className="invoice-summary-box">
          <div className="summary-title">Billing Summary</div>

          <div className="summary-row">
            <span>Items Subtotal</span>
            <strong>₹{summary.subtotal.toFixed(2)}</strong>
          </div>

          <div className="summary-row sub-row">
            <span>GST ({summary.breakdown.gstRatePercent}%)</span>
            <span>₹{summary.breakdown.gstAmount.toFixed(2)}</span>
          </div>

          <div className="summary-row sub-row">
            <span>Packaging & Platform Fee</span>
            <span>
              {summary.breakdown.packagingFee > 0
                ? `₹${summary.breakdown.packagingFee.toFixed(2)}`
                : "FREE"}
            </span>
          </div>

          <div className="summary-row sub-row">
            <span>Campus Delivery Fee</span>
            <span>
              {summary.breakdown.deliveryFee === 0 ? (
                <span className="free-badge">
                  <HiCheckCircle /> FREE
                </span>
              ) : (
                `₹${summary.breakdown.deliveryFee.toFixed(2)}`
              )}
            </span>
          </div>

          <div className="summary-divider"></div>

          <div className="summary-row final-total-row">
            <div>
              <strong className="final-label">Final Order Total</strong>
              <small className="final-sub">Includes all applicable taxes & charges</small>
            </div>
            <strong className="final-amount">₹{summary.finalTotal.toFixed(2)}</strong>
          </div>
        </div>

        {/* Razorpay Integration Placeholder Banner */}
        <div className="razorpay-placeholder-banner">
          <div className="banner-icon">
            <HiInformationCircle />
          </div>
          <div className="banner-text">
            <strong>Razorpay Integration Placeholder</strong>
            <p>
              Backend price validation & payment gateway verification will connect here upon server deployment.
            </p>
          </div>
        </div>

        {/* Pay Now Button */}
        <div className="invoice-actions">
          <button
            className="pay-now-btn"
            onClick={handlePayNow}
            aria-label={`Pay Now ₹${summary.finalTotal.toFixed(2)}`}
          >
            <span className="pay-btn-content">
              <HiCreditCard className="pay-icon" />
              <span>Pay Now</span>
              <span className="pay-dot">•</span>
              <span className="pay-amount">₹{summary.finalTotal.toFixed(2)}</span>
            </span>
            <span className="placeholder-tag">[Placeholder]</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default CheckoutInvoice;
