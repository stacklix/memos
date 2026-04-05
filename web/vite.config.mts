import react from "@vitejs/plugin-react";
import { resolve } from "path";
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

function manualChunksFromId(id: string): string | undefined {
  if (!id.includes("node_modules")) {
    return undefined;
  }

  // Do not bundle all of `mermaid/` into one manual chunk — it collapses Mermaid's own
  // dynamic imports (per-diagram splits) into a multi‑MB file.
  if (
    /[/\\]node_modules[/\\]leaflet[/\\]/.test(id) ||
    /[/\\]node_modules[/\\]leaflet\.markercluster[/\\]/.test(id) ||
    /[/\\]node_modules[/\\]react-leaflet-cluster[/\\]/.test(id) ||
    /[/\\]node_modules[/\\]react-leaflet[/\\]/.test(id)
  ) {
    return "leaflet-vendor";
  }
  if (id.includes("lodash-es") || id.includes("/dayjs")) {
    return "utils-vendor";
  }
  if (id.includes("@tanstack/react-query")) {
    return "tanstack-vendor";
  }
  if (id.includes("react-router")) {
    return "router-vendor";
  }
  if (id.includes("react-dom") || /[/\\]node_modules[/\\]react[/\\]/.test(id)) {
    return "react-vendor";
  }
  if (id.includes("scheduler")) {
    return "react-vendor";
  }
  if (id.includes("@radix-ui")) {
    return "radix-vendor";
  }
  if (id.includes("@emotion")) {
    return "emotion-vendor";
  }
  if (id.includes("i18next") || id.includes("react-i18next")) {
    return "i18n-vendor";
  }
  if (id.includes("@connectrpc") || id.includes("@bufbuild")) {
    return "connect-vendor";
  }
  if (id.includes("highlight.js") || id.includes("lowlight")) {
    return "syntax-highlight-vendor";
  }
  // KaTeX + markdown stack in one chunk avoids circular markdown-vendor ↔ katex-vendor.
  if (
    id.includes("katex") ||
    id.includes("react-markdown") ||
    id.includes("/remark-") ||
    id.includes("/rehype-") ||
    id.includes("micromark") ||
    id.includes("mdast") ||
    id.includes("/unist") ||
    id.includes("hast-util") ||
    id.includes("decode-named-character-reference") ||
    id.includes("character-entities")
  ) {
    return "markdown-vendor";
  }

  return undefined;
}

/** Default: Hono Node (`npm run dev:node`) on port 3000 */
let devProxyServer = "http://localhost:3000";
if (process.env.DEV_PROXY_SERVER && process.env.DEV_PROXY_SERVER.length > 0) {
  console.log("Use devProxyServer from environment: ", process.env.DEV_PROXY_SERVER);
  devProxyServer = process.env.DEV_PROXY_SERVER;
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: "0.0.0.0",
    port: 3001,
    proxy: {
      "^/api": {
        target: devProxyServer,
        xfwd: true,
      },
      "^/healthz": {
        target: devProxyServer,
        xfwd: true,
      },
    },
  },
  resolve: {
    alias: {
      "@/": `${resolve(__dirname, "src")}/`,
    },
  },
  build: {
    outDir: "../dist/public",
    emptyOutDir: true,
    // highlight.js full bundle (~1 MB) + large app chunks exceed Vite’s default 500 kB hint.
    chunkSizeWarningLimit: 1100,
    rollupOptions: {
      output: {
        manualChunks: manualChunksFromId,
      },
    },
  },
});
