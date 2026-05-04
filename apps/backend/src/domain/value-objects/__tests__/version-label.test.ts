import { VersionLabel } from "../version-label.js";

describe("VersionLabel", () => {
  it("formats fromSequence as v{n}", () => {
    expect(VersionLabel.fromSequence(1).toString()).toBe("v1");
    expect(VersionLabel.fromSequence(42).toString()).toBe("v42");
  });

  it.each([0, -1, 1.5, Number.NaN])("rejects sequence %p", (n) => {
    expect(() => VersionLabel.fromSequence(n)).toThrow(/positive integer/);
  });

  it.each(["v0", "v01", "v1", "v1234"])("parse accepts %p", (raw) => {
    expect(() => VersionLabel.parse(raw)).not.toThrow();
  });

  it.each(["", "version1", "1", "v", "v-1", "vX"])("parse rejects %p", (raw) => {
    expect(() => VersionLabel.parse(raw)).toThrow(/Invalid version label/);
  });
});
