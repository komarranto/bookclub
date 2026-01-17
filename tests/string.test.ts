import { describe, it, expect } from "vitest";
import { capitalize, reverse, isPalindrome, truncate, countWords } from "../src/utils/string";

describe("String Utils", () => {
  describe("capitalize", () => {
    it("should capitalize first letter", () => {
      expect(capitalize("hello")).toBe("Hello");
    });

    it("should return empty string for empty input", () => {
      expect(capitalize("")).toBe("");
    });
  });

  describe("reverse", () => {
    it("should reverse a string", () => {
      expect(reverse("hello")).toBe("olleh");
    });

    it("should handle empty string", () => {
      expect(reverse("")).toBe("");
    });
  });

  describe("isPalindrome", () => {
    it("should detect palindrome", () => {
      expect(isPalindrome("racecar")).toBe(true);
    });

    it("should ignore case and spaces", () => {
      expect(isPalindrome("A man a plan a canal Panama")).toBe(true);
    });

    it("should return false for non-palindrome", () => {
      expect(isPalindrome("hello")).toBe(false);
    });
  });

  describe("truncate", () => {
    it("should not truncate short strings", () => {
      expect(truncate("hello", 10)).toBe("hello");
    });

    it("should truncate long strings with ellipsis", () => {
      expect(truncate("hello world", 8)).toBe("hello...");
    });
  });

  describe("countWords", () => {
    it("should count words correctly", () => {
      expect(countWords("hello world")).toBe(2);
    });

    it("should handle multiple spaces", () => {
      expect(countWords("  hello   world  ")).toBe(2);
    });
  });
});
