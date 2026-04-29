import { PromptVariable } from "../../../../domain/value-objects/prompt-variable.js";
import { assertVariableIntegrity } from "../variable-integrity.js";

describe("assertVariableIntegrity", () => {
  const make = (...names: string[]) =>
    names.map((n) => PromptVariable.create({ name: n }));

  it("passes when every reference is declared", () => {
    expect(() =>
      assertVariableIntegrity({
        body: "Hello {{name}}, today is {{date}}",
        variables: make("name", "date"),
      }),
    ).not.toThrow();
  });

  it("passes when declarations exceed references (unused defs allowed)", () => {
    expect(() =>
      assertVariableIntegrity({
        body: "Hello {{name}}",
        variables: make("name", "future"),
      }),
    ).not.toThrow();
  });

  it("throws when a reference is undeclared", () => {
    expect(() =>
      assertVariableIntegrity({
        body: "Hello {{name}}, today is {{date}}",
        variables: make("name"),
      }),
    ).toThrow(/undeclared/);
  });

  it("checks both body and mermaid", () => {
    expect(() =>
      assertVariableIntegrity({
        body: "Use {{a}}",
        mermaid: "graph TD; N1[ask {{b}}] --> N2[answer]",
        variables: make("a"),
      }),
    ).toThrow(/undeclared/);
  });
});
