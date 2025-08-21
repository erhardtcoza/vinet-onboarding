export function ipAllowed(request) {
  // VNET 160.226.128.0/20 (128..143)
  const ip = request.headers.get("CF-Connecting-IP") || "";
  const [a,b,c] = ip.split(".").map(Number);
  return a===160 && b===226 && c>=128 && c<=143;
}
