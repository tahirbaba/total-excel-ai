export const APP_NAME =
  process.env.NEXT_PUBLIC_APP_NAME || "Total Constructors AI Sheet Builder";

export const DEFAULT_SITES = [
  "INDUS VALLY SCHOOL",
  "SCB OPS BUILDING",
  "GROVE RESIDENCY",
  "DMC GROUND FLOOR",
  "AKD TOWER",
  "BRENTWOOD",
  "TABBA RESIDENCY",
];

export const DEFAULT_UOMS = [
  "Nos",
  "bag",
  "Titan",
  "ltr",
  "pair",
  "Rft",
  "Roll",
  "pkt",
  "KG",
  "Gallon",
  "Length",
  "Cash",
];

export const DEFAULT_VENDORS: string[] = [];

export const STORAGE_KEYS = {
  pin: "tc_pin",
  sites: "tc_custom_sites",
  vendors: "tc_custom_vendors",
  uoms: "tc_custom_uoms",
} as const;
