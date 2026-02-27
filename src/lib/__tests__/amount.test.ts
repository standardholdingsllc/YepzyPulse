import { parseAmountCents, formatCents } from "@/lib/parsing/amount";

describe("parseAmountCents", () => {
  it("parses standard dollar amounts", () => {
    expect(parseAmountCents("$2,517.79")).toBe(251779);
    expect(parseAmountCents("$100.00")).toBe(10000);
    expect(parseAmountCents("$0.50")).toBe(50);
    expect(parseAmountCents("$1,234,567.89")).toBe(123456789);
  });

  it("parses amounts without dollar sign", () => {
    expect(parseAmountCents("2517.79")).toBe(251779);
    expect(parseAmountCents("100")).toBe(10000);
    expect(parseAmountCents("0.50")).toBe(50);
  });

  it("parses negative amounts", () => {
    expect(parseAmountCents("-$100.00")).toBe(-10000);
    expect(parseAmountCents("-100.00")).toBe(-10000);
    expect(parseAmountCents("($50.25)")).toBe(-5025);
  });

  it("handles zero and empty values", () => {
    expect(parseAmountCents("$0.00")).toBe(0);
    expect(parseAmountCents("0")).toBe(0);
    expect(parseAmountCents("")).toBe(0);
    expect(parseAmountCents(null)).toBe(0);
    expect(parseAmountCents(undefined)).toBe(0);
  });

  it("handles whitespace", () => {
    expect(parseAmountCents("  $100.00  ")).toBe(10000);
    expect(parseAmountCents(" 50.25 ")).toBe(5025);
  });

  it("handles malformed input", () => {
    expect(parseAmountCents("abc")).toBe(0);
    expect(parseAmountCents("$")).toBe(0);
    expect(parseAmountCents(",,")).toBe(0);
  });
});

describe("formatCents", () => {
  it("formats positive amounts", () => {
    expect(formatCents(251779)).toBe("$2,517.79");
    expect(formatCents(10000)).toBe("$100.00");
    expect(formatCents(50)).toBe("$0.50");
    expect(formatCents(0)).toBe("$0.00");
  });

  it("formats negative amounts", () => {
    expect(formatCents(-10000)).toBe("-$100.00");
    expect(formatCents(-5025)).toBe("-$50.25");
  });
});
