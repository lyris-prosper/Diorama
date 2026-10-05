import data from "./catalog.json";
import type { Dims } from "./types";

/** One piece in the furniture library (lib/catalog.json). Images and models live in public/catalog. */
export type CatalogItem = {
  id: string;
  name: string;
  shop: string;
  /** Group for the filter chips (see catalogCategories). */
  category: string;
  kind: string;
  /** Listed product size in cm; `dimsLabel` is the wording the shop uses. */
  dims: Dims;
  dimsLabel: string;
  price: number;
  /** false: no official CNY price could be confirmed, shown as “约 ¥…”. */
  priceVerified: boolean;
  link: string;
  /** search: the link opens the official shop's search rather than the product page. */
  linkKind: "product" | "search";
  tags: string[];
  image: string;
  /** Hung on a wall rather than stood on the floor. */
  wall?: boolean;
  model?: string;
  /** Size of the prepared model in cm, and its height in metres. */
  modelSize?: Dims;
  modelHeight?: number;
};

export const catalog = (data.items as CatalogItem[]).filter((i) => i.model && i.modelHeight);
export const catalogItem = (id: string) => catalog.find((i) => i.id === id);

export const formatPrice = (i: Pick<CatalogItem, "price" | "priceVerified">) =>
  (i.priceVerified ? "" : "约 ") + "¥" + (Number.isInteger(i.price) ? i.price.toLocaleString("zh-CN") : i.price.toFixed(2));
