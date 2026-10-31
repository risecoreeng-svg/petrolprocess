// Unit tests for the price warnings shown on Add stock, Record sale, Set pump price and Add expense.
// Usage: npm run test:unit   (Node 22+, runs lib/price-check.ts directly with type stripping)
import { checkPrice, PRICE_FACTOR } from "../lib/price-check.ts";

let passed = 0;
let failed = 0;
function check(name, ok, detail = "") {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  -> ${detail}`}`);
}
const usd = (v) => `$${v.toFixed(2)}`;
const perL = (v, refs) => checkPrice(v, refs, { perLitre: true, fmt: usd });

// The example from the spec: a total typed as a price per litre.
const w = perL(44, [{ label: "last price", value: 1.1 }]);
check("40x higher than the last price is flagged", w?.direction === "higher" && w.ratio === 40, JSON.stringify(w));
check(
  "…with a plain message that names the price and suggests the total",
  w?.message === "This is 40x higher than your last price of $1.10/L. Did you enter the total instead of the price per litre, or use the wrong currency?",
  w?.message,
);

check("A normal price is not flagged", perL(1.25, [{ label: "last price", value: 1.1 }]) === null);
check(`Exactly ${PRICE_FACTOR}x is still allowed`, perL(5.5, [{ label: "last price", value: 1.1 }]) === null);
check(`Just over ${PRICE_FACTOR}x is flagged`, perL(5.6, [{ label: "last price", value: 1.1 }]) !== null);

// SDG typed as if it were USD comes out far too high; USD typed as SDG far too low.
const low = perL(1.1 / 2600, [{ label: "pump price", value: 1.1 }]);
check("A price 2,600x too low is flagged as lower", low?.direction === "lower" && Math.round(low.ratio) === 2600, JSON.stringify(low));
check("…and suggests the wrong currency", low?.message.includes("wrong currency"), low?.message);
check(`Just under 1/${PRICE_FACTOR} is flagged`, perL(0.2, [{ label: "pump price", value: 1.1 }])?.direction === "lower");

// Several references: the one it is furthest from is reported.
const two = perL(30, [
  { label: "last price", value: 2 },
  { label: "tank average cost", value: 1 },
]);
check("With two references, the furthest one is named", two?.ref.label === "tank average cost" && two.ratio === 30, JSON.stringify(two));
check("Only one reference needs to be off", perL(3, [{ label: "last price", value: 2.9 }, { label: "tank average cost", value: 0.5 }])?.ref.label === "tank average cost");

check("No references (first delivery): nothing to warn about", perL(500, []) === null);
check("Missing or zero references are ignored", perL(500, [{ label: "a", value: null }, { label: "b", value: 0 }, { label: "c", value: undefined }]) === null);
check("Zero, negative or empty values are left to the form's own error", perL(0, [{ label: "x", value: 1 }]) === null && perL(-5, [{ label: "x", value: 1 }]) === null && perL(NaN, [{ label: "x", value: 1 }]) === null);

// Expenses use the amount, not a per-litre price.
const exp = checkPrice(20000, [{ label: "last rent expense", value: 2000 }], { perLitre: false, fmt: usd });
check("An amount 10x the last one of that category is flagged", exp?.ratio === 10, JSON.stringify(exp));
check("…without '/L' and with an amount hint", exp?.message === "This is 10x higher than your last rent expense of $2000.00. Check for an extra zero or the wrong currency.", exp?.message);
check("Ratios under 10 keep one decimal", checkPrice(13, [{ label: "x", value: 2 }], { perLitre: false, fmt: usd })?.message.startsWith("This is 6.5x higher"));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
