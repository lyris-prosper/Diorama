import data from "./catalog.json";
import type { Dims } from "./types";
import type { Lang } from "./i18n";

export type Availability = "in_stock" | "in_store_only" | "out_of_stock" | "not_verified";

/** One piece in the furniture library (lib/catalog.json). Images and models live in public/catalog. */
export type CatalogItem = {
  id: string;
  name: string;
  nameEn: string;
  shop: string;
  /** Group for the filter chips (see catalogCategories). */
  category: string;
  kind: string;
  /** Listed product size in cm; `dimsLabel` is the wording the shop uses. */
  dims: Dims;
  dimsLabel: string;
  /** Only where the Chinese wording has words in it (直径, 高…). */
  dimsLabelEn?: string;
  /** Reference price in US dollars: the official list price, converted when the shop sells in another currency. */
  price: number;
  /** The product page on the brand's own regional site. */
  link: string;
  /** Region of that site (ISO code) and its name, e.g. SE · 瑞典. */
  market: string;
  marketName: string;
  marketNameEn: string;
  /** The price as the site lists it, in its own currency. */
  originalPrice: number;
  originalCurrency: string;
  availability: Availability;
  /** Colour / size / material the price is for. */
  variant: string;
  variantEn: string;
  sku: string;
  /** What the price leaves out (cover only, lid sold separately…). */
  buyNote?: string;
  buyNoteEn?: string;
  /** A price that needs a membership; never used as the main price. */
  memberOffer?: { label: string; labelEn: string; price: number; originalPrice: number; currency: string; until: string };
  tags: string[];
  image: string;
  /** Hung on a wall rather than stood on the floor. */
  wall?: boolean;
  model?: string;
  /** Size of the prepared model in cm, and its height in metres. */
  modelSize?: Dims;
  modelHeight?: number;
};

export type Pricing = {
  currency: "USD";
  /** Date the prices were checked on the official sites. */
  verified: string;
  fx: { provider: string; rateDate: string; source: string; usdPer: Record<string, number> };
  /** Sum of all 20 reference prices. */
  total: number;
  note: string;
  noteEn: string;
};

export const pricing = data.pricing as Pricing;
export const catalog = (data.items as CatalogItem[]).filter((i) => i.model && i.modelHeight);
export const catalogItem = (id: string) => catalog.find((i) => i.id === id);

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
/** $198.35 */
export const formatUSD = (v: number) => usd.format(v);
export const formatPrice = (i: Pick<CatalogItem, "price">) => formatUSD(i.price);
/** A budget: $50 for whole dollars, $74.58 otherwise. */
export const formatBudget = (v: number) => formatUSD(v).replace(/\.00$/, "");
/** SEK 1,995 · JPY 39,600 · USD 79.00 */
export const formatOriginal = (i: Pick<CatalogItem, "originalPrice" | "originalCurrency">) =>
  `${i.originalCurrency} ${i.originalPrice.toLocaleString("en-US", {
    minimumFractionDigits: i.originalCurrency === "JPY" || Number.isInteger(i.originalPrice) ? 0 : 2,
    maximumFractionDigits: i.originalCurrency === "JPY" ? 0 : 2,
  })}`;
/** The piece's name in the page's language. */
export const itemName = (i: Pick<CatalogItem, "name" | "nameEn">, lang: Lang) => (lang === "en" ? i.nameEn : i.name);
export const variantText = (i: Pick<CatalogItem, "variant" | "variantEn">, lang: Lang) => (lang === "en" ? i.variantEn : i.variant);
export const dimsText = (i: Pick<CatalogItem, "dimsLabel" | "dimsLabelEn">, lang: Lang) => (lang === "en" ? i.dimsLabelEn ?? i.dimsLabel : i.dimsLabel);
export const buyNoteText = (i: Pick<CatalogItem, "buyNote" | "buyNoteEn">, lang: Lang) => (lang === "en" ? i.buyNoteEn : i.buyNote);
/** 瑞典官网 · Sweden site */
export const marketLabel = (i: Pick<CatalogItem, "marketName" | "marketNameEn">, lang: Lang = "zh") =>
  lang === "en" ? `${i.marketNameEn} site` : `${i.marketName}官网`;
/** Shown only when the piece is not simply in stock. */
export const availabilityLabel = (i: Pick<CatalogItem, "availability">, lang: Lang = "zh") =>
  (lang === "en"
    ? { in_stock: "", in_store_only: "In store only", out_of_stock: "Sold out online", not_verified: "Stock unverified" }
    : { in_stock: "", in_store_only: "仅门店有售", out_of_stock: "官网缺货", not_verified: "库存未核实" })[i.availability];
/** US dollars for an amount in another currency, at the same ECB fixing as the prices. */
export const toUSD = (amount: number, currency: string) => amount * (pricing.fx.usdPer[currency] ?? NaN);
