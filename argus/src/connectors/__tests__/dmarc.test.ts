import { describe, it, expect } from "vitest";
import { dmarcPass } from "../gmail";

// The DMARC gate decides which senders are eligible for unattended
// auto-execution, so a false positive lets a spoofed sender inherit earned
// trust. It must trust a pass ONLY from Google's own verifier (authserv-id
// "mx.google.com") and fail safe on anything else.

describe("dmarcPass — authserv-id-pinned DMARC gate", () => {
  it("accepts a genuine Google-stamped pass", () => {
    expect(
      dmarcPass([
        "mx.google.com; dkim=pass header.i=@bank.com; spf=pass; dmarc=pass (p=REJECT sp=REJECT) header.from=bank.com",
      ]),
    ).toBe(true);
  });

  it("rejects a pass from a non-Google authserv-id (upstream/forged header)", () => {
    expect(
      dmarcPass([
        "attacker-relay.example.com; dmarc=pass (p=NONE) header.from=bank.com",
      ]),
    ).toBe(false);
  });

  it("trusts Google's header even when a forged one is also present", () => {
    expect(
      dmarcPass([
        "evil.example.com; dmarc=pass header.from=bank.com", // forged, ignored
        "mx.google.com; spf=fail; dkim=fail; dmarc=fail header.from=bank.com", // real
      ]),
    ).toBe(false); // Google says fail → no trust
    expect(
      dmarcPass([
        "evil.example.com; dmarc=pass header.from=bank.com",
        "mx.google.com; dmarc=pass header.from=bank.com",
      ]),
    ).toBe(true); // Google says pass → trust
  });

  it("rejects a Google fail and empty/absent results", () => {
    expect(dmarcPass(["mx.google.com; dmarc=fail header.from=x.com"])).toBe(false);
    expect(dmarcPass([])).toBe(false);
    expect(dmarcPass([""])).toBe(false);
  });

  it("does not match a substring like dmarc=passfail or dmarc=none", () => {
    expect(dmarcPass(["mx.google.com; dmarc=none header.from=x.com"])).toBe(false);
  });
});
