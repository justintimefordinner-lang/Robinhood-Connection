// Example-mode earnings dates ({ SYMBOL: "YYYY-MM-DD" }, like fetch_earnings.py's
// data/earnings.json). Used to flag CSPs that span an earnings report. Dates line
// up with the erDate values seeded on the example CSP options.
export const exampleEarnings: Record<string, string> = {
  SOFI: "2026-07-28",
  MU: "2026-06-25",
  TSM: "2026-07-17",
  AMAT: "2026-06-23",
  ADI: "2026-06-25",
  NVDA: "2026-08-27",
  AVGO: "2026-09-04",
  INTC: "2026-07-24",
};
