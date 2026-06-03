import { sveltekit } from "@sveltejs/kit/vite";
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
