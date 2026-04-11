import React from "react";
import { SvgXml } from "react-native-svg";

const COLOR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 520 215" fill="none">
  <defs>
    <linearGradient id="cartBodyGrad" x1="0%" y1="0%" x2="90%" y2="100%">
      <stop offset="0%" stop-color="#FFA726"/>
      <stop offset="100%" stop-color="#E64A19"/>
    </linearGradient>
  </defs>
  <rect x="4"  y="58" width="44" height="8"   rx="4"    fill="#1B2B6B"/>
  <rect x="0"  y="72" width="36" height="5.5" rx="2.75" fill="#1B2B6B"/>
  <rect x="4"  y="84" width="28" height="4"   rx="2"    fill="#1B2B6B"/>
  <text x="48" y="118" font-family="'Arial Black','Impact',Arial,sans-serif" font-weight="900" font-size="80" fill="#1B2B6B" font-style="italic" letter-spacing="-4">AJK</text>
  <rect x="208" y="54" width="38" height="7.5" rx="3.5" fill="#E65100"/>
  <rect x="204" y="67" width="30" height="5.5" rx="2.5" fill="#E65100"/>
  <rect x="207" y="79" width="22" height="4"   rx="2"   fill="#E65100"/>
  <path d="M248 38 Q253 15 276 12 L344 12" stroke="#1B2B6B" stroke-width="9" fill="none" stroke-linecap="round"/>
  <path d="M250 50 L352 50 L340 108 L262 108 Z" fill="url(#cartBodyGrad)"/>
  <path d="M263 54 L344 54 L342 65 L263 65 Z" fill="rgba(255,255,255,0.22)"/>
  <circle cx="278" cy="123" r="13" fill="#1B2B6B"/>
  <circle cx="278" cy="123" r="6.5" fill="white"/>
  <circle cx="278" cy="123" r="2.5" fill="#1B2B6B"/>
  <circle cx="328" cy="123" r="13" fill="#1B2B6B"/>
  <circle cx="328" cy="123" r="6.5" fill="white"/>
  <circle cx="328" cy="123" r="2.5" fill="#1B2B6B"/>
  <text x="22" y="172" font-family="'Arial Black','Impact',Arial,sans-serif" font-weight="900" font-size="58" fill="#1B2B6B" letter-spacing="-1">ajkmart</text>
  <text x="26" y="200" font-family="Arial,'Helvetica Neue',sans-serif" font-weight="700" font-size="17" fill="#1B2B6B" letter-spacing="4.5">FAST HOME DELIVERY</text>
</svg>`;

const WHITE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 520 215" fill="none">
  <defs>
    <linearGradient id="cartBodyGradW" x1="0%" y1="0%" x2="90%" y2="100%">
      <stop offset="0%" stop-color="#FFA726"/>
      <stop offset="100%" stop-color="#E64A19"/>
    </linearGradient>
  </defs>
  <rect x="4"  y="58" width="44" height="8"   rx="4"    fill="rgba(255,255,255,0.7)"/>
  <rect x="0"  y="72" width="36" height="5.5" rx="2.75" fill="rgba(255,255,255,0.7)"/>
  <rect x="4"  y="84" width="28" height="4"   rx="2"    fill="rgba(255,255,255,0.7)"/>
  <text x="48" y="118" font-family="'Arial Black','Impact',Arial,sans-serif" font-weight="900" font-size="80" fill="white" font-style="italic" letter-spacing="-4">AJK</text>
  <rect x="208" y="54" width="38" height="7.5" rx="3.5" fill="#FFA726"/>
  <rect x="204" y="67" width="30" height="5.5" rx="2.5" fill="#FFA726"/>
  <rect x="207" y="79" width="22" height="4"   rx="2"   fill="#FFA726"/>
  <path d="M248 38 Q253 15 276 12 L344 12" stroke="white" stroke-width="9" fill="none" stroke-linecap="round"/>
  <path d="M250 50 L352 50 L340 108 L262 108 Z" fill="url(#cartBodyGradW)"/>
  <path d="M263 54 L344 54 L342 65 L263 65 Z" fill="rgba(255,255,255,0.22)"/>
  <circle cx="278" cy="123" r="13" fill="white"/>
  <circle cx="278" cy="123" r="6.5" fill="rgba(255,255,255,0.35)"/>
  <circle cx="278" cy="123" r="2.5" fill="white"/>
  <circle cx="328" cy="123" r="13" fill="white"/>
  <circle cx="328" cy="123" r="6.5" fill="rgba(255,255,255,0.35)"/>
  <circle cx="328" cy="123" r="2.5" fill="white"/>
  <text x="22" y="172" font-family="'Arial Black','Impact',Arial,sans-serif" font-weight="900" font-size="58" fill="white" letter-spacing="-1">ajkmart</text>
  <text x="26" y="200" font-family="Arial,'Helvetica Neue',sans-serif" font-weight="700" font-size="17" fill="rgba(255,255,255,0.65)" letter-spacing="4.5">FAST HOME DELIVERY</text>
</svg>`;

const COMPACT_WHITE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 370 130" fill="none">
  <defs>
    <linearGradient id="cartBodyGradC" x1="0%" y1="0%" x2="90%" y2="100%">
      <stop offset="0%" stop-color="#FFA726"/>
      <stop offset="100%" stop-color="#E64A19"/>
    </linearGradient>
  </defs>
  <rect x="4"  y="58" width="44" height="8"   rx="4"    fill="rgba(255,255,255,0.7)"/>
  <rect x="0"  y="72" width="36" height="5.5" rx="2.75" fill="rgba(255,255,255,0.7)"/>
  <rect x="4"  y="84" width="28" height="4"   rx="2"    fill="rgba(255,255,255,0.7)"/>
  <text x="48" y="118" font-family="'Arial Black','Impact',Arial,sans-serif" font-weight="900" font-size="80" fill="white" font-style="italic" letter-spacing="-4">AJK</text>
  <rect x="208" y="54" width="38" height="7.5" rx="3.5" fill="#FFA726"/>
  <rect x="204" y="67" width="30" height="5.5" rx="2.5" fill="#FFA726"/>
  <rect x="207" y="79" width="22" height="4"   rx="2"   fill="#FFA726"/>
  <path d="M248 38 Q253 15 276 12 L344 12" stroke="white" stroke-width="9" fill="none" stroke-linecap="round"/>
  <path d="M250 50 L352 50 L340 108 L262 108 Z" fill="url(#cartBodyGradC)"/>
  <path d="M263 54 L344 54 L342 65 L263 65 Z" fill="rgba(255,255,255,0.22)"/>
  <circle cx="278" cy="123" r="13" fill="white"/>
  <circle cx="278" cy="123" r="6.5" fill="rgba(255,255,255,0.35)"/>
  <circle cx="278" cy="123" r="2.5" fill="white"/>
  <circle cx="328" cy="123" r="13" fill="white"/>
  <circle cx="328" cy="123" r="6.5" fill="rgba(255,255,255,0.35)"/>
  <circle cx="328" cy="123" r="2.5" fill="white"/>
</svg>`;

type AjkLogoProps = {
  variant?: "color" | "white" | "compact-white";
  width?: number;
  height?: number;
};

export function AjkLogo({ variant = "color", width = 160, height = 66 }: AjkLogoProps) {
  const xml = variant === "white" ? WHITE_SVG : variant === "compact-white" ? COMPACT_WHITE_SVG : COLOR_SVG;
  return <SvgXml xml={xml} width={width} height={height} />;
}
