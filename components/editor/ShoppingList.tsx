"use client";
import { Popover } from "radix-ui";
import { ArrowUpRight, Library, ShoppingBag } from "lucide-react";
import { catalogItem, formatUSD, itemName, type CatalogItem } from "@/lib/catalog";
import { useLang } from "@/lib/i18n";
import type { Item } from "@/lib/types";

/**
 * The library pieces in this space as a shopping list: what each costs at its listed reference price,
 * the shop links and the total. The badge counts the pieces.
 */
export default function ShoppingList({ items, onBrowse }: { items: Item[]; onBrowse?: () => void }) {
  const { lang, t } = useLang();
  const lines = new Map<string, { entry: CatalogItem; count: number }>();
  for (const i of items) {
    const entry = i.catalogId ? catalogItem(i.catalogId) : undefined;
    if (!entry) continue;
    const line = lines.get(entry.id);
    if (line) line.count++;
    else lines.set(entry.id, { entry, count: 1 });
  }
  const list = [...lines.values()];
  const count = list.reduce((n, l) => n + l.count, 0);
  const total = list.reduce((n, l) => n + l.entry.price * l.count, 0);
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button className="icon cart" aria-label={t(`购物清单，${count} 件`, `Shopping list, ${count} ${count === 1 ? "piece" : "pieces"}`)} title={t("购物清单", "Shopping list")}>
          <ShoppingBag />
          {count > 0 && <span className="cart-count">{count}</span>}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="cart-pop" align="end" sideOffset={10} collisionPadding={12}>
          <div className="cart-head">
            <strong>{t("购物清单", "Shopping list")}</strong>
            <span>{t("房间里来自家具库的商品", "Library pieces in this room")}</span>
          </div>
          {list.length ? (
            <>
              <ul className="cart-lines">
                {list.map(({ entry, count }) => (
                  <li key={entry.id}>
                    <img src={entry.image} alt="" />
                    <div>
                      <strong title={itemName(entry, lang)}>{itemName(entry, lang)}</strong>
                      <span>
                        {entry.shop}
                        {count > 1 && ` · × ${count}`}
                      </span>
                    </div>
                    <b>{formatUSD(entry.price * count)}</b>
                    <a className="icon" href={entry.link} target="_blank" rel="noopener noreferrer" aria-label={t(`去 ${entry.shop} 官网`, `Open on ${entry.shop}`)} title={t("去官网", "Shop")}>
                      <ArrowUpRight />
                    </a>
                  </li>
                ))}
              </ul>
              <div className="cart-total">
                <span>{t(`共 ${count} 件 · 参考合计`, `${count} ${count === 1 ? "piece" : "pieces"} · about`)}</span>
                <b>{formatUSD(total)}</b>
              </div>
              <p className="cart-note">{t("各品牌官网标价换算的美元参考价，不含运费和关税。", "Reference prices from each brand's site, in US dollars; shipping and duties not included.")}</p>
            </>
          ) : (
            <div className="cart-empty">
              <p>{t("还没有摆家具库里的商品。", "No library pieces in the room yet.")}</p>
              {onBrowse && (
                <Popover.Close asChild>
                  <button className="button" onClick={onBrowse}>
                    <Library size={15} />
                    {t("打开家具库", "Open the library")}
                  </button>
                </Popover.Close>
              )}
            </div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
