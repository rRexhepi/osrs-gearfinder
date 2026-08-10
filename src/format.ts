export const fmtNum = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1_000) return `${(n / 1000).toFixed(1)}k`;
  return String(Math.round(n));
};

export const fmtGp = (n: number): string => `${fmtNum(n)} gp`;

/** the ranking metric: dps as 8.24, xp/hr as 61k */
export const fmtMetric = (n: number, training: boolean): string => (training ? fmtNum(n) : n.toFixed(2));
