const storageKey = "yiyi:provider-session";

export function providerSessionHeaders(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    let value = window.sessionStorage.getItem(storageKey);
    if (!value || !/^[0-9a-f-]{36}$/i.test(value)) {
      value = crypto.randomUUID();
      window.sessionStorage.setItem(storageKey, value);
    }
    return { "X-YiYi-Client-Session": value };
  } catch {
    return {};
  }
}
