import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import CheckoutInvoice from "../components/CheckoutInvoice";

describe("CheckoutInvoice Component", () => {
  const sampleCart = [
    { id: 101, name: "Masala Dosa", price: 45, vendor: "Udupi" },
    { id: 101, name: "Masala Dosa", price: 45, vendor: "Udupi" },
    { id: 401, name: "Classic Coffee", price: 25, vendor: "Nescafe" },
  ];

  test("renders invoice header, items table, quantities, unit prices, and subtotals", () => {
    render(<CheckoutInvoice cart={sampleCart} type="food" />);

    expect(screen.getByText("CampusOS Order Invoice")).toBeInTheDocument();
    expect(screen.getByText("Masala Dosa")).toBeInTheDocument();
    expect(screen.getByText("Classic Coffee")).toBeInTheDocument();

    // Dosa unit price 45, qty 2, subtotal 90
    expect(screen.getByText("₹45.00")).toBeInTheDocument();
    expect(screen.getByText("₹90.00")).toBeInTheDocument();

    // Coffee unit price 25
    expect(screen.getAllByText("₹25.00").length).toBeGreaterThan(0);
  });

  test("displays correct subtotal, taxes & charges, and final order total", () => {
    render(<CheckoutInvoice cart={sampleCart} type="food" />);

    // Items total = 90 + 25 = 115
    expect(screen.getByText("₹115.00")).toBeInTheDocument();

    // GST 5% of 115 = 5.75
    expect(screen.getByText("₹5.75")).toBeInTheDocument();

    // Packaging Fee = 10
    expect(screen.getByText("₹10.00")).toBeInTheDocument();

    // Delivery Fee = 25 (matches Coffee unit price, subtotal, and delivery fee)
    expect(screen.getAllByText("₹25.00").length).toBe(3);

    // Total Taxes & Charges = 5.75 + 10 + 25 = 40.75
    // Final Total = 115 + 40.75 = 155.75 (appears in billing summary and Pay Now button)
    expect(screen.getAllByText("₹155.75").length).toBe(2);
  });

  test("renders Pay Now placeholder button with correct amount and placeholder tag", () => {
    const notifyMock = jest.fn();
    render(<CheckoutInvoice cart={sampleCart} type="food" notify={notifyMock} />);

    const payBtn = screen.getByRole("button", { name: /Pay Now/i });
    expect(payBtn).toBeInTheDocument();
    expect(screen.getByText("[Placeholder]")).toBeInTheDocument();

    fireEvent.click(payBtn);
    expect(notifyMock).toHaveBeenCalledWith(
      expect.stringContaining("[Razorpay Placeholder] Ready to process payment of ₹155.75")
    );
  });

  test("triggers onUpdateQuantity when quantity controls are clicked", () => {
    const updateQtyMock = jest.fn();
    render(<CheckoutInvoice cart={sampleCart} type="food" onUpdateQuantity={updateQtyMock} />);

    const plusButtons = screen.getAllByLabelText("Increase quantity");
    fireEvent.click(plusButtons[0]);
    expect(updateQtyMock).toHaveBeenCalledWith(101, 1);

    const minusButtons = screen.getAllByLabelText("Decrease quantity");
    fireEvent.click(minusButtons[0]);
    expect(updateQtyMock).toHaveBeenCalledWith(101, -1);
  });

  test("renders empty cart state when cart is empty", () => {
    render(<CheckoutInvoice cart={[]} type="food" />);

    expect(screen.getByText("Your cart is empty")).toBeInTheDocument();
    expect(screen.getByText(/Return to Food Hub/i)).toBeInTheDocument();
  });
});
