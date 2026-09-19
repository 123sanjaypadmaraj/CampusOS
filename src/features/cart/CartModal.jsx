import { FEATURES } from "../../config/features";
import { HiCreditCard, HiShoppingCart, HiXMark } from "react-icons/hi2";
import { ModalShell } from "../../components/ui/Shell";

function CartModal({ title,cart,onClose,notify,type,onCheckout,onUpdateQuantity,onRemove}) {
  const total = cart.reduce((sum, item) => sum + Number(item.price) * Number(item.quantity || 1), 0);

  return (
    <ModalShell
      kicker={type === "food" ? "FOOD HUB" : "CAMPUS STORE"}
      title={title}
      onClose={onClose}
    >
      {cart.length === 0 ? (
        <div className="empty-state">
          <HiShoppingCart />
          <h3>Your cart is empty</h3>
          <p>Add something to continue.</p>
        </div>
      ) : (
        <>
          <div className="cart-list">
            {cart.map((item, index) => (
              <div key={`${item.id}-${index}`}>
                <span style={{ gridColumn: 1, gridRow: 1 }}>{item.name}</span>
                <small style={{ gridColumn: 1, gridRow: 2, color: "var(--muted)" }}>
                  {item.vendor || item.category}
                  {item.addonSummary && ` · + ${item.addonSummary}`}
                </small>
                {onUpdateQuantity ? (
                  <span style={{ gridColumn: 2, gridRow: "1 / 3", display: "flex", alignItems: "center", gap: 6 }}>
                    <button className="ghost" onClick={() => onUpdateQuantity(index, Number(item.quantity || 1) - 1)}>−</button>
                    <b>{item.quantity || 1}</b>
                    <button className="ghost" onClick={() => onUpdateQuantity(index, Number(item.quantity || 1) + 1)}>+</button>
                  </span>
                ) : (
                  <small style={{ gridColumn: 2, gridRow: "1 / 3" }}>× {item.quantity || 1}</small>
                )}
                <b style={{ gridColumn: 3, gridRow: "1 / 3" }}>₹{Number(item.price) * Number(item.quantity || 1)}</b>
                {onRemove && (
                  <button
                    className="ghost"
                    style={{ gridColumn: 4, gridRow: "1 / 3" }}
                    aria-label={`Remove ${item.name}`}
                    onClick={() => onRemove(index)}
                  >
                    <HiXMark />
                  </button>
                )}
              </div>
            ))}
          </div>

          <div className="price-preview">
            <span>Total</span>
            <b>₹{total}</b>
          </div>

          <button
            className="primary wide"
            disabled={type === "store" && !FEATURES.storeCheckout}
            onClick={async () => {
            if (onCheckout) {
              await onCheckout();
            } else {
              notify(
                "Checkout opened"
              );
              onClose();
            }
          }}
          >
            {type === "store" && !FEATURES.storeCheckout ? "Ordering paused" : <>Continue to payment <HiCreditCard /></>}
          </button>
        </>
      )}
    </ModalShell>
  );
}

export { CartModal };
