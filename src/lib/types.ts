export type PaymentType = "Cash" | "Credit";

export interface Item {
  id: string;
  material: string;
  vendor: string;
  uom: string;
  qty: number | null;
  rate: number | null;
  payment_type: PaymentType;
  remarks: string;
  needs_review: boolean;
}

export interface Site {
  id: string;
  site_name: string;
  items: Item[];
}

export interface Sheet {
  date: string; // DD/MM/YYYY
  sites: Site[];
}

/** Shape exchanged with the AI / Python endpoints (no client ids). */
export type RawItem = Omit<Item, "id">;
export interface RawSite {
  site_name: string;
  items: RawItem[];
}
export interface RawSheet {
  date: string;
  sites: RawSite[];
}

export interface UploadFile {
  name: string;
  mimeType: string;
  data: string; // base64 (no data: prefix)
}
