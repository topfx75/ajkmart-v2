#!/usr/bin/env node
/**
 * Kill any process listening on the given port.
 * Works on NixOS/Linux via /proc/net/tcp and /proc/<pid>/fd.
 * Usage: node kill-port.mjs <port>
 */
import { readFileSync, readdirSync, readlinkSync } from "fs";
import { exit } from "process";

const port = parseInt(process.argv[2] ?? process.env.PORT ?? "0", 10);
if (!port || Number.isNaN(port)) {
  console.error("[kill-port] No port specified");
  exit(0);
}

function findInodesForPort(filePath) {
  const inodes = new Set();
  try {
    const content = readFileSync(filePath, "utf8");
    for (const line of content.split("\n").slice(1)) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 10) continue;
      const localPort = parseInt(parts[1].split(":").pop(), 16);
      const state = parts[3];
      if (localPort === port && state === "0A") {
        inodes.add(parts[9]);
      }
    }
  } catch {
  }
  return inodes;
}

const inodes = new Set([
  ...findInodesForPort("/proc/net/tcp"),
  ...findInodesForPort("/proc/net/tcp6"),
]);

if (inodes.size === 0) {
  exit(0);
}

let killed = false;
try {
  for (const pid of readdirSync("/proc")) {
    if (!/^\d+$/.test(pid)) continue;
    try {
      const fdDir = `/proc/${pid}/fd`;
      for (const fd of readdirSync(fdDir)) {
        try {
          const link = readlinkSync(`${fdDir}/${fd}`);
          const m = link.match(/socket:\[(\d+)\]/);
          if (m && inodes.has(m[1])) {
            process.kill(parseInt(pid, 10), "SIGKILL");
            console.log(`[kill-port] Killed PID ${pid} listening on port ${port}`);
            killed = true;
          }
        } catch {
        }
      }
    } catch {
    }
  }
} catch {
}

if (!killed) {
  console.log(`[kill-port] No process found on port ${port}`);
}
