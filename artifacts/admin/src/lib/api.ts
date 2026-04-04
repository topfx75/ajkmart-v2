export const getApiBase = () => {
  return `${window.location.origin}/api/admin`;
};

export const getToken = () => {
  return localStorage.getItem("ajkmart_admin_token");
};

export const fetcher = async (endpoint: string, options: RequestInit = {}) => {
  const token = getToken();

  const res = await fetch(`${getApiBase()}${endpoint}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { "x-admin-token": token } : {}),
      ...options.headers,
    },
  });

  const json = await res.json();

  if (!res.ok) {
    if (res.status === 401 && token) {
      // Only remove the token if this request was sent WITH a token.
      // This prevents an in-flight pre-login request (sent without a token)
      // from deleting a token that was stored after the request was sent —
      // which was causing a race-condition logout right after login.
      const currentToken = getToken();
      if (currentToken === token) {
        localStorage.removeItem("ajkmart_admin_token");
      }
    }
    throw new Error(json.error || "An error occurred");
  }

  return json.data !== undefined ? json.data : json;
};
