// /src/utils/cookies.js
export function getCookie(map, k) {
  const raw = map.get("cookie") || "";
  const found = raw.split(/;\s*/).find(s => s.startsWith(k + "="));
  return found ? decodeURIComponent(found.split("=")[1]) : "";
}
