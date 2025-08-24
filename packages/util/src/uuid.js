import { v4 as uuidv4 } from "npm:uuid@^9";

export function makeUUID() {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : uuidv4();
}