import { classifyTransactionType } from "@/lib/classification/transaction-types";

describe("classifyTransactionType", () => {
  it("classifies purchase transactions as Card", () => {
    expect(classifyTransactionType("purchaseTransaction")).toBe("Card");
    expect(classifyTransactionType("purchase")).toBe("Card");
  });

  it("classifies ATM transactions", () => {
    expect(classifyTransactionType("atmTransaction")).toBe("ATM");
  });

  it("classifies fee transactions", () => {
    expect(classifyTransactionType("feeTransaction")).toBe("Fee");
  });

  it("classifies book transactions", () => {
    expect(classifyTransactionType("bookTransaction")).toBe("Book/Payment");
    expect(classifyTransactionType("bookPayment")).toBe("Book/Payment");
  });

  it("classifies transfer types", () => {
    expect(classifyTransactionType("wireTransaction")).toBe("Transfer/Other");
    expect(classifyTransactionType("achTransaction")).toBe("Transfer/Other");
  });

  it("returns Other for null/empty", () => {
    expect(classifyTransactionType(null)).toBe("Other");
    expect(classifyTransactionType("")).toBe("Other");
    expect(classifyTransactionType(undefined)).toBe("Other");
  });

  it("returns Other:<type> for unknown types", () => {
    expect(classifyTransactionType("mysteryTransaction")).toBe(
      "Other:mysteryTransaction"
    );
  });

  it("is case-insensitive", () => {
    expect(classifyTransactionType("PurchaseTransaction")).toBe("Card");
    expect(classifyTransactionType("ATMTRANSACTION")).toBe("ATM");
  });
});
