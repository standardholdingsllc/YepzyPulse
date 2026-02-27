import {
  extractLocation,
  isLocationBearingType,
  classifyCustomersInUs,
} from "@/lib/parsing/location";

describe("extractLocation", () => {
  it("parses standard US address from purchase summary", () => {
    const result = extractLocation(
      "Purchase from WAL-MART #1541 | Address: WEST PALM BEA, FL, US | **7402"
    );
    expect(result).not.toBeNull();
    expect(result!.city).toBe("WEST PALM BEA");
    expect(result!.state).toBe("FL");
    expect(result!.country).toBe("US");
    expect(result!.raw).toBe("WEST PALM BEA, FL, US");
  });

  it("parses ATM withdrawal address", () => {
    const result = extractLocation(
      "Withdraw at CHASE BANK | Address: DOVER, FL, US | **1234"
    );
    expect(result).not.toBeNull();
    expect(result!.city).toBe("DOVER");
    expect(result!.state).toBe("FL");
    expect(result!.country).toBe("US");
  });

  it("parses non-US address", () => {
    const result = extractLocation(
      "Purchase from STORE | Address: MEXICO CI, DF, MX | **5555"
    );
    expect(result).not.toBeNull();
    expect(result!.city).toBe("MEXICO CI");
    expect(result!.state).toBe("DF");
    expect(result!.country).toBe("MX");
  });

  it("returns null for summary without address", () => {
    expect(extractLocation("Book payment from John Doe")).toBeNull();
    expect(extractLocation("Fee charge - monthly")).toBeNull();
    expect(extractLocation("")).toBeNull();
    expect(extractLocation(null)).toBeNull();
    expect(extractLocation(undefined)).toBeNull();
  });

  it("handles two-part addresses", () => {
    const result = extractLocation("Purchase | Address: FL, US");
    expect(result).not.toBeNull();
    expect(result!.state).toBe("FL");
    expect(result!.country).toBe("US");
  });
});

describe("isLocationBearingType", () => {
  it("identifies purchase transactions", () => {
    expect(isLocationBearingType("purchaseTransaction")).toBe(true);
    expect(isLocationBearingType("purchase")).toBe(true);
  });

  it("identifies ATM transactions", () => {
    expect(isLocationBearingType("atmTransaction")).toBe(true);
    expect(isLocationBearingType("atm")).toBe(true);
  });

  it("rejects non-location types", () => {
    expect(isLocationBearingType("feeTransaction")).toBe(false);
    expect(isLocationBearingType("bookTransaction")).toBe(false);
    expect(isLocationBearingType("")).toBe(false);
    expect(isLocationBearingType(null)).toBe(false);
    expect(isLocationBearingType(undefined)).toBe(false);
  });
});

describe("classifyCustomersInUs", () => {
  it("classifies customer as in_us=true with recent US transaction", () => {
    const result = classifyCustomersInUs([
      {
        customerId: "cust1",
        unitType: "purchaseTransaction",
        summary: "Purchase | Address: MIAMI, FL, US",
        createdAt: new Date("2024-01-15T10:00:00Z"),
      },
    ]);

    expect(result.get("cust1")?.inUs).toBe("true");
  });

  it("classifies customer as in_us=false with recent non-US transaction", () => {
    const result = classifyCustomersInUs([
      {
        customerId: "cust2",
        unitType: "purchaseTransaction",
        summary: "Purchase | Address: CANCUN, QR, MX",
        createdAt: new Date("2024-01-15T10:00:00Z"),
      },
    ]);

    expect(result.get("cust2")?.inUs).toBe("false");
  });

  it("classifies customer as unknown when no location-bearing transactions", () => {
    const result = classifyCustomersInUs([
      {
        customerId: "cust3",
        unitType: "feeTransaction",
        summary: "Monthly fee",
        createdAt: new Date("2024-01-15T10:00:00Z"),
      },
    ]);

    expect(result.get("cust3")?.inUs).toBe("unknown");
  });

  it("uses most recent transaction for classification", () => {
    const result = classifyCustomersInUs([
      {
        customerId: "cust4",
        unitType: "purchaseTransaction",
        summary: "Purchase | Address: CANCUN, QR, MX",
        createdAt: new Date("2024-01-10T10:00:00Z"),
      },
      {
        customerId: "cust4",
        unitType: "purchaseTransaction",
        summary: "Purchase | Address: MIAMI, FL, US",
        createdAt: new Date("2024-01-15T10:00:00Z"),
      },
    ]);

    expect(result.get("cust4")?.inUs).toBe("true");
    expect(result.get("cust4")?.latestLocationCountry).toBe("US");
  });

  it("handles multiple customers", () => {
    const result = classifyCustomersInUs([
      {
        customerId: "us_cust",
        unitType: "purchaseTransaction",
        summary: "Purchase | Address: MIAMI, FL, US",
        createdAt: new Date("2024-01-15T10:00:00Z"),
      },
      {
        customerId: "mx_cust",
        unitType: "atmTransaction",
        summary: "Withdraw | Address: TIJUANA, BC, MX",
        createdAt: new Date("2024-01-15T10:00:00Z"),
      },
      {
        customerId: "no_loc",
        unitType: "bookTransaction",
        summary: "Book payment",
        createdAt: new Date("2024-01-15T10:00:00Z"),
      },
    ]);

    expect(result.get("us_cust")?.inUs).toBe("true");
    expect(result.get("mx_cust")?.inUs).toBe("false");
    expect(result.get("no_loc")?.inUs).toBe("unknown");
  });
});
