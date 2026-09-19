import { useEffect } from "react";
import { FEATURES } from "../config/features";
import { openRazorpayCheckout } from "../features/payments/razorpay";
import { createFoodOrder, getCampusFood, logClientError, startFoodOrderPayment, subscribeToFood } from "../services/mvpService";
import { createStoreOrder, getMyStoreOrders, getStoreItems, getStores, subscribeToStoreOrders, subscribeToStores } from "../services/storeService";
import { mergeCartItem } from "../utils/mvpHelpers";

function useFoodAndStore({ authUser, campusId, foodCart, notify, setDbCanteens, setDbError, setDbFoodItems, setDbLoading, setDbStoreItems, setDbStoresLoading, setFoodCart, setLoginOpen, setModal, setMyStoreOrders, setOrders, setStoreCart, storeCart, user }) {
  const addFood = (item) => {
      setFoodCart((cart) => {
        if (cart.length && cart[0].canteenId && item.canteenId && cart[0].canteenId !== item.canteenId) {
          notify("You can only order from one canteen at a time.");
          return cart;
        }
        notify(`${item.name} added to food cart`);
        return mergeCartItem(cart, item);
      });
    };

  const addStore = (item) => {
      setStoreCart((cart) => {
        if (cart.length && cart[0].storeId && item.storeId && cart[0].storeId !== item.storeId) {
          notify("You can only order from one store at a time.");
          return cart;
        }
        notify(`${item.name} added to store cart`);
        return mergeCartItem(cart, item);
      });
    };

  const checkoutStore = async () => {
      if (!FEATURES.storeCheckout) {
        notify("Store ordering is temporarily paused — check back soon.");
        return;
      }
      if (!authUser) {
        setLoginOpen(true);
        notify("Sign in before placing an order");
        return;
      }
      if (!storeCart.length) {
        notify("Your store cart is empty");
        return;
      }
      const storeId = storeCart[0]?.storeId;
      if (!storeId) {
        notify("Please pick items from the store first");
        return;
      }
      try {
        const idempotencyKey =
          typeof crypto !== "undefined" && crypto.randomUUID
            ? crypto.randomUUID()
            : `${authUser.id}-${Date.now()}`;
  
        const order = await createStoreOrder({ storeId, cart: storeCart, idempotencyKey });
        setMyStoreOrders((current) => [order, ...current]);
        setStoreCart([]);
        setModal(null);
        notify(`Order placed! Pickup code: ${order.pickup_code}`);
      } catch (error) {
        notify(error.message || "Could not place order");
      }
    };

  const checkoutFood = async () => {
      try {
  
        if (!authUser) {
          setLoginOpen(true);
  
          notify(
            "Sign in before placing an order"
          );
  
          return;
        }
  
        if (!foodCart.length) {
          notify(
            "Your food cart is empty"
          );
  
          return;
        }
  
        const canteenId =
          foodCart[0]?.canteenId;
  
        if (!canteenId) {
          notify(
            "Please select a canteen"
          );
  
          return;
        }
  
        // A fresh idempotency key per checkout *attempt* -- if this click
        // fires twice (flaky Wi-Fi, doc §63), the RPC returns the same order
        // both times instead of creating a duplicate.
        const idempotencyKey =
          typeof crypto !== "undefined" && crypto.randomUUID
            ? crypto.randomUUID()
            : `${authUser.id}-${Date.now()}`;
  
        const order =
          await createFoodOrder({
            userId:
              authUser.id,
  
            canteenId,
  
            cart:
              foodCart,
  
            idempotencyKey,
          });
  
        setOrders(
          (current) => [
            order,
            ...current,
          ]
        );
  
        setFoodCart([]);
        setModal(null);
        notify(`Order created · ₹${order.total} — opening payment…`);
  
        // Payment: re-derive the amount server-side and open Razorpay
        // Checkout. The order becomes PAID only once razorpay-webhook
        // verifies the gateway signature -- the realtime `orders`
        // subscription above then updates this order's status on its own.
        try {
          const payment = await startFoodOrderPayment(order.id);
          await openRazorpayCheckout({
            keyId: payment.key_id,
            gatewayOrderId: payment.gateway_order_id,
            amount: payment.amount,
            currency: payment.currency,
            prefillEmail: authUser.email,
            prefillName: user?.name,
            onDismiss: () => notify("Payment cancelled — you can pay again from My Orders"),
          });
        } catch (paymentError) {
          console.error("Payment start failed:", paymentError);
          logClientError(paymentError.message || "Payment start failed", {
            stack: paymentError.stack,
            severity: "error",
            context: { flow: "food_order_payment", orderId: order.id },
          });
          notify(
            paymentError.message?.includes("GATEWAY_NOT_CONFIGURED") ||
            paymentError.message?.includes("not configured")
              ? "Order created, but payments aren't configured on this deployment yet."
              : (paymentError.message || "Payment could not be started. Try again from My Orders.")
          );
        }
  
      } catch (error) {
  
        console.error(
          "Food order:",
          error
        );
  
        logClientError(error.message || "Food order creation failed", {
          stack: error.stack,
          severity: "error",
          context: { flow: "food_order_create" },
        });
  
        notify(
          error.message ||
          "Unable to place order"
        );
      }
    };

  useEffect(() => {
        let mounted = true;
  
        async function loadFood() {
          try {
            setDbLoading(true);
            setDbError("");
  
            const { canteens, items } = await getCampusFood(campusId);
  
            if (!mounted) return;
  
            setDbCanteens(canteens);
            setDbFoodItems(items);
          } catch (error) {
            console.error("Food loading error:", error);
            if (mounted) {
              setDbError(error.message || "Unable to load campus food.");
            }
          } finally {
            if (mounted) {
              setDbLoading(false);
            }
          }
        }
  
        loadFood();
        const unsub = subscribeToFood(() => loadFood());
  
        return () => {
          mounted = false;
          unsub?.();
        };
      }, [campusId]); // eslint-disable-line react-hooks/exhaustive-deps -- the setX are useState setters, stable

  useEffect(() => {
        let mounted = true;

        async function loadStore() {
          try {
            setDbStoresLoading(true);
            // Every active store's catalog, flattened into one shopping grid --
            // same "one flat list" shape the old hardcoded storeItems array
            // had, just backed by real per-store items now. Each item carries
            // its store_id/store name so the cart can enforce "one store at a
            // time" (create_store_order requires it) and the receipt can show
            // who it's from.
            const stores = await getStores(campusId);
            const perStore = await Promise.all(stores.map((s) => getStoreItems(s.id)));
            const flattened = stores.flatMap((s, i) =>
              perStore[i].map((item) => ({ ...item, storeId: s.id, storeName: s.name, vendor: s.name }))
            );
            if (!mounted) return;
            setDbStoreItems(flattened);
          } catch (error) {
            console.error("Store loading error:", error);
          } finally {
            if (mounted) setDbStoresLoading(false);
          }
        }
  
        loadStore();
        const unsub = subscribeToStores(() => loadStore());
  
        return () => {
          mounted = false;
          unsub?.();
        };
      }, [campusId]); // eslint-disable-line react-hooks/exhaustive-deps -- the setX are useState setters, stable

  useEffect(() => {
        if (!authUser?.id) { setMyStoreOrders([]); return; }
  
        const loadMyStoreOrders = () => {
          getMyStoreOrders(authUser.id).then(setMyStoreOrders).catch(() => {});
        };
  
        loadMyStoreOrders();
        const unsub = subscribeToStoreOrders(authUser.id, loadMyStoreOrders);
        return () => unsub?.();
      }, [authUser?.id]); // eslint-disable-line react-hooks/exhaustive-deps -- setMyStoreOrders is a useState setter, stable

  return { addFood, addStore, checkoutFood, checkoutStore };
}

export { useFoodAndStore };
