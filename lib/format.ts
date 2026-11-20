const TZ = "Asia/Tokyo";

export function fmtDuration(sec: number): string {
  const m = Math.max(0, Math.round(sec / 60));
  if (m < 60) return `${m}分`;
  if (m < 60 * 24) return `${Math.floor(m / 60)}時間${m % 60 ? `${m % 60}分` : ""}`;
  return `${Math.floor(m / 1440)}日`;
}

export function fmtClock(epochSec: number): string {
  return new Intl.DateTimeFormat("ja-JP", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(epochSec * 1000);
}

export function fmtDateTime(epochSec: number): string {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: TZ, month: "numeric", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit",
  }).format(epochSec * 1000);
}

export function fmtAcu(n: number): string {
  return n >= 100 ? n.toFixed(0) : n.toFixed(1);
}
