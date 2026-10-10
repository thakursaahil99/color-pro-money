/** Amounts of virtual points a player can ask an admin for. Free: there is no payment of any kind. */
export const RECHARGE_AMOUNTS = [100, 500] as const;
export type RechargeAmount = (typeof RECHARGE_AMOUNTS)[number];

export function isRechargeAmount(v: unknown): v is RechargeAmount {
  return typeof v === "number" && (RECHARGE_AMOUNTS as readonly number[]).includes(v);
}
