import {
  parseEmployerMapping,
  buildEmployerLookup,
  normalizeEmployerKey,
} from "@/lib/classification/employer-mapping";

describe("normalizeEmployerKey", () => {
  it("trims and collapses whitespace", () => {
    expect(normalizeEmployerKey("  Acme  Corp  ")).toBe("ACME CORP");
  });

  it("converts to uppercase", () => {
    expect(normalizeEmployerKey("acme corp")).toBe("ACME CORP");
  });
});

describe("parseEmployerMapping", () => {
  it("parses format (a): direct dictionary", () => {
    const data = {
      cust1: "Acme Corp",
      cust2: "Beta LLC",
      cust3: "Acme Corp",
    };

    const result = parseEmployerMapping(data);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({
      customerId: "cust1",
      employerName: "Acme Corp",
    });
  });

  it("parses format (b): array of records", () => {
    const data = [
      { customerId: "cust1", employerName: "Acme Corp" },
      { customer_id: "cust2", employer_name: "Beta LLC" },
      { workerId: "cust3", company: "Gamma Inc" },
    ];

    const result = parseEmployerMapping(data);
    expect(result).toHaveLength(3);
    expect(result[0].customerId).toBe("cust1");
    expect(result[0].employerName).toBe("Acme Corp");
    expect(result[1].customerId).toBe("cust2");
    expect(result[2].customerId).toBe("cust3");
    expect(result[2].employerName).toBe("Gamma Inc");
  });

  it("parses format (c): employer-keyed with nested workers", () => {
    const data = {
      emp1: {
        name: "Acme Corp",
        workers: ["cust1", "cust2"],
      },
      emp2: {
        name: "Beta LLC",
        customerIds: ["cust3"],
      },
    };

    const result = parseEmployerMapping(data);
    expect(result).toHaveLength(3);
    expect(result.find((m) => m.customerId === "cust1")?.employerName).toBe(
      "Acme Corp"
    );
    expect(result.find((m) => m.customerId === "cust3")?.employerName).toBe(
      "Beta LLC"
    );
  });

  it("handles empty/null input", () => {
    expect(parseEmployerMapping(null)).toEqual([]);
    expect(parseEmployerMapping(undefined)).toEqual([]);
    expect(parseEmployerMapping({})).toEqual([]);
    expect(parseEmployerMapping([])).toEqual([]);
  });
});

describe("buildEmployerLookup", () => {
  it("builds a lookup map from mappings", () => {
    const mappings = [
      { customerId: "cust1", employerName: "Acme Corp" },
      { customerId: "cust2", employerName: "Beta LLC" },
    ];

    const lookup = buildEmployerLookup(mappings);
    expect(lookup.get("cust1")).toEqual({
      employerName: "Acme Corp",
      employerKey: "ACME CORP",
    });
    expect(lookup.get("cust2")).toEqual({
      employerName: "Beta LLC",
      employerKey: "BETA LLC",
    });
    expect(lookup.get("unknown")).toBeUndefined();
  });
});
