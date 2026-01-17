import { describe, it, expect } from "vitest";
import { add, subtract, multiply, divide, factorial } from "../src/utils/math";

describe("Math Utils", () => {
  describe("add", () => {
    it("should add two positive numbers", () => {
      expect(add(2, 3)).toBe(5);
    });

    it("should handle negative numbers", () => {
      expect(add(-1, 1)).toBe(0);
    });
  });

  describe("subtract", () => {
    it("should subtract two numbers", () => {
      expect(subtract(5, 3)).toBe(2);
    });
  });

  describe("multiply", () => {
    it("should multiply two numbers", () => {
      expect(multiply(3, 4)).toBe(12);
    });

    it("should return zero when multiplying by zero", () => {
      expect(multiply(5, 0)).toBe(0);
    });
  });

  describe("divide", () => {
    it("should divide two numbers", () => {
      expect(divide(10, 2)).toBe(5);
    });

    it("should throw error on division by zero", () => {
      expect(() => divide(10, 0)).toThrow("Division by zero");
    });
  });

  describe("factorial", () => {
    it("should return 1 for 0", () => {
      expect(factorial(0)).toBe(1);
    });

    it("should calculate factorial correctly", () => {
      expect(factorial(5)).toBe(120);
    });

    it("should throw error for negative numbers", () => {
      expect(() => factorial(-1)).toThrow();
    });
  });
});
