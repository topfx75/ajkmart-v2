import React from "react";

export function WebView({ source, style, ...props }) {
  const src = source?.uri || "";
  return React.createElement("iframe", {
    src,
    style: Object.assign({ border: "none", width: "100%", height: "100%" }, style),
    allow: "geolocation",
    ...props,
  });
}

export default WebView;
