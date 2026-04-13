export const getApiBase = () => {
  return `${window.location.origin}/api/admin`;
};

export const getToken = () => {
  return localStorage.getItem("ajkmart_admin_token");
};

export const uploadAdminImage = async (file: File): Promise<string> => {
  const token = getToken();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const base64 = (reader.result as string).split(",")[1];
        const res = await fetch(`${getApiBase()}/uploads/admin`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { "x-admin-token": token } : {}),
          },
          body: JSON.stringify({ base64, mimeType: file.type }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Upload failed");
        const data = json.data !== undefined ? json.data : json;
        resolve(data.url as string);
      } catch (e) {
        reject(e);
      }
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
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

  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    if (res.status === 401 && token) {
      const currentToken = getToken();
      if (currentToken === token) {
        localStorage.removeItem("ajkmart_admin_token");
      }
    }
    const text = await res.text().catch(() => "");
    throw new Error(`Server error (HTTP ${res.status}): ${text.slice(0, 200).replace(/<[^>]*>/g, "").trim() || "Unexpected non-JSON response"}`);
  }

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
