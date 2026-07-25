# Mixed federation example

The repository example uses a Vite host on 5173, a direct Rspack remote on 3001,
and an Rsbuild remote on 3002. Both remotes expose visible React components and
share React as a singleton. Playwright proves both render without console errors.
