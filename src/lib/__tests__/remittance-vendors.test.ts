import {
  classifyRemittanceVendor,
  classifyRemittanceVendorWithEvidence,
} from "@/lib/classification/remittance-vendors";

describe("classifyRemittanceVendor", () => {
  // Real-world patterns from Unit CSV exports
  it("identifies Remitly patterns from real data", () => {
    expect(
      classifyRemittanceVendor("RMTLY* RE26E, REMITLY.COM, WA, US  |  **1451", null)
    ).toBe("Remitly");
    expect(
      classifyRemittanceVendor("RMTLY_FLX* MBRSHPFEE, WWW.REMITLY.C, WA, US  |  **8178", null)
    ).toBe("Remitly");
  });

  it("identifies Felix Pago patterns from real data", () => {
    expect(
      classifyRemittanceVendor("Felix Pago, San Francisco, CA, US  |  **6761", null)
    ).toBe("Felix");
    expect(
      classifyRemittanceVendor("FELIXPAGO.COM, FELIXPAGO.COM, FL, US  |  **1066", null)
    ).toBe("Felix");
  });

  it("identifies RIA patterns from real data", () => {
    expect(
      classifyRemittanceVendor("RIA Financial Services, 818-6747076, KS, US  |  **3998", null)
    ).toBe("RIA");
    expect(
      classifyRemittanceVendor("Ria Money Transfer, 818-6747076, KS, US  |  **7511", null)
    ).toBe("RIA");
  });

  it("identifies Western Union patterns from real data", () => {
    expect(
      classifyRemittanceVendor("WU DIGITAL USA AFT, 8003256000, CA, US  |  **9830", null)
    ).toBe("Western Union");
  });

  it("identifies MoneyGram patterns from real data", () => {
    expect(
      classifyRemittanceVendor("MONEYGRAM US ONLINE, https://www.m, TX, US  |  **6450", null)
    ).toBe("MoneyGram");
  });

  it("identifies Pangea patterns from real data", () => {
    expect(
      classifyRemittanceVendor("PANGEA MONEY TRANSFER, 866-8589928, IL, US  |  **0865", null)
    ).toBe("Pangea");
  });

  it("identifies Boss Money patterns from real data", () => {
    expect(
      classifyRemittanceVendor("BOSS MONEY, WWW.IDT.NET, NJ, US  |  **1768", null)
    ).toBe("Boss Money");
  });

  it("identifies TapTap Send patterns from real data", () => {
    expect(
      classifyRemittanceVendor("TapTap Send, 833-9160670, DE, US  |  **9869", null)
    ).toBe("TapTap Send");
  });

  it("identifies Uniteller patterns from real data", () => {
    expect(
      classifyRemittanceVendor("SERVICIO UNITELLER INC, Rochelle Park, NJ, US  |  **3088", null)
    ).toBe("Uniteller");
  });

  // Exclusion tests
  it("excludes false positives for RIA", () => {
    expect(
      classifyRemittanceVendor("CRITERIA CORP payment", null)
    ).toBe("Not remittance");
    expect(
      classifyRemittanceVendor("MATERIAL SUPPLY CO", null)
    ).toBe("Not remittance");
    expect(
      classifyRemittanceVendor("GLORIA RESTAURANT", null)
    ).toBe("Not remittance");
  });

  it("excludes 'otherwise' from Wise", () => {
    expect(
      classifyRemittanceVendor("Otherwise qualified payment", null)
    ).toBe("Not remittance");
    expect(
      classifyRemittanceVendor("Likewise payment", null)
    ).toBe("Not remittance");
  });

  it("excludes 'zoom' from Xoom", () => {
    expect(
      classifyRemittanceVendor("ZOOM VIDEO COMMUNICATIONS", null)
    ).toBe("Not remittance");
  });

  // Non-remittance tests
  it("returns Not remittance for unrecognized transactions", () => {
    expect(
      classifyRemittanceVendor("WAL-MART PURCHASE", null)
    ).toBe("Not remittance");
    expect(classifyRemittanceVendor("UBER EATS", null)).toBe("Not remittance");
    expect(classifyRemittanceVendor(null, null)).toBe("Not remittance");
    expect(classifyRemittanceVendor("", "")).toBe("Not remittance");
    expect(
      classifyRemittanceVendor("APPLE COM BILL, ONE APPLE PARK WAY, CUPERTINO, CA, US", null)
    ).toBe("Not remittance");
    expect(
      classifyRemittanceVendor("PlayStation Netw, PlayStation Netw, San Mateo, CA, US", null)
    ).toBe("Not remittance");
  });

  it("checks counterpartyName field", () => {
    expect(classifyRemittanceVendor(null, "Remitly Inc")).toBe("Remitly");
    expect(classifyRemittanceVendor("Regular purchase", "MONEYGRAM")).toBe(
      "MoneyGram"
    );
  });

  it("identifies generic remittance keywords", () => {
    expect(
      classifyRemittanceVendor("MONEY TRANSFER SERVICE XYZ", null)
    ).toBe("Remittance (Unknown)");
  });

  // Specific vendor tests
  it("identifies Intermex", () => {
    expect(classifyRemittanceVendor("INTERMEX WIRE TRANS", null)).toBe("Intermex");
  });

  it("identifies Xoom (without zoom)", () => {
    expect(classifyRemittanceVendor("XOOM TRANSFER", null)).toBe("Xoom");
  });

  it("identifies Wise", () => {
    expect(classifyRemittanceVendor("WISE.COM transfer", null)).toBe("Wise");
  });
});

describe("classifyRemittanceVendorWithEvidence", () => {
  it("returns match evidence for debugging", () => {
    const result = classifyRemittanceVendorWithEvidence(
      "RMTLY* RE26E, REMITLY.COM, WA, US  |  **1451",
      null
    );

    expect(result.vendor).toBe("Remitly");
    expect(result.evidence).not.toBeNull();
    expect(result.evidence?.matchedKeyword).toBe("rmtly*");
    expect(result.evidence?.matchedField).toBe("summary");
    expect(result.evidence?.matchPosition).toBeGreaterThanOrEqual(0);
  });

  it("returns null evidence for non-remittance", () => {
    const result = classifyRemittanceVendorWithEvidence(
      "WAL-MART PURCHASE",
      null
    );

    expect(result.vendor).toBe("Not remittance");
    expect(result.evidence).toBeNull();
  });

  it("identifies match in counterpartyName field", () => {
    const result = classifyRemittanceVendorWithEvidence(
      "Regular purchase",
      "MONEYGRAM"
    );

    expect(result.vendor).toBe("MoneyGram");
    expect(result.evidence?.matchedField).toBe("counterpartyName");
  });
});
