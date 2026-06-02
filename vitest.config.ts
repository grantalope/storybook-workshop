import { defineConfig } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import path from "node:path";

export default defineConfig({
	plugins: [svelte({ hot: false })],
	resolve: {
		alias: {
			"$lib": path.resolve(__dirname, "src/lib"),
			"$app": path.resolve(__dirname, "src/test-stubs/$app"),
		},
	},
	test: {
		include: ["tests/**/*.test.ts"],
		exclude: ["node_modules", "dist", ".svelte-kit", "e2e/**"],
		environment: "node",
		globals: true,
		setupFiles: ["tests/setup/web-crypto-polyfill.ts"],
		testTimeout: 30000,
		hookTimeout: 10000,
		pool: "vmForks",
	},
});
