import { sveltekit } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [sveltekit()],
	server: {
		fs: { allow: [".."] },
	},
	optimizeDeps: {
		exclude: ["@xenova/transformers"], // load via CDN per upstream guidance
	},
});
