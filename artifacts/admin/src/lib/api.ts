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

  const data = await res.json();

  if (!res.ok) {
    if (res.status === 401) {
      localStorage.removeItem("ajkmart_admin_token");
    }
    throw new Error(data.error || "An error occurred");
  }

  return data;
};
