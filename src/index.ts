import { add, multiply, factorial } from "./utils/math";
import { capitalize, isPalindrome } from "./utils/string";
import { UserService } from "./models/User";

function main() {
  console.log("=== Math Utils Demo ===");
  console.log(`2 + 3 = ${add(2, 3)}`);
  console.log(`4 * 5 = ${multiply(4, 5)}`);
  console.log(`5! = ${factorial(5)}`);

  console.log("\n=== String Utils Demo ===");
  console.log(`capitalize("hello") = "${capitalize("hello")}"`);
  console.log(`isPalindrome("A man a plan a canal Panama") = ${isPalindrome("A man a plan a canal Panama")}`);

  console.log("\n=== User Service Demo ===");
  const userService = new UserService();
  const user = userService.create("John Doe", "john@example.com");
  console.log("Created user:", user);

  const found = userService.findByEmail("john@example.com");
  console.log("Found by email:", found);
}

main();
