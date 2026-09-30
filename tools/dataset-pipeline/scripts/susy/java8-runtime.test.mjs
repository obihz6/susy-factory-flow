import path from "node:path";
import { describe, expect, it } from "vitest";
import { isJava8VersionOutput, javaHomeFor } from "./java8-runtime.mjs";

describe("Java 8 runtime helpers", () => {
  it("recognizes Java 8 version output from stderr", () => {
    expect(isJava8VersionOutput('java version "1.8.0_402"\n')).toBe(true);
    expect(isJava8VersionOutput('openjdk version "8.0.402" 2024-01-16\n')).toBe(true);
  });

  it("rejects newer Java versions and unrelated output", () => {
    expect(isJava8VersionOutput('openjdk version "17.0.10" 2024-01-16\n')).toBe(false);
    expect(isJava8VersionOutput("not a Java version\n")).toBe(false);
  });

  it("derives JAVA_HOME from a Java binary path", () => {
    expect(javaHomeFor(path.join("runtime", "jre8", "bin", "java"))).toBe(
      path.resolve("runtime", "jre8"),
    );
  });
});
