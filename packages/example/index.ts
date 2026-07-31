// Entry point: this package's public surface. Copy this package to start a new one.
import { titleCase } from "./lib/impl";

export function greet(name: string): string {
  return `Hello, ${titleCase(name)}!`;
}
