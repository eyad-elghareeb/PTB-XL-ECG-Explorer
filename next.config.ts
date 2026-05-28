import type {NextConfig} from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'picsum.photos',
        port: '',
        pathname: '/**',
      },
    ],
  },
  // Vercel serverless functions will use their own builder
  // Standalone output is not used for Vercel deployments
  transpilePackages: ['motion'],
  // Copy sql.js WASM file to output so it can be loaded at runtime
  webpack: (config, {dev, isServer}) => {
    // HMR is disabled via DISABLE_HMR env var.
    // Do not modify—file watching is disabled to prevent flickering during agent edits.
    if (dev && process.env.DISABLE_HMR === 'true') {
      config.watchOptions = {
        ignored: /.*/,
      };
    }

    // Ensure sql.js WASM is handled correctly
    // sql.js by default triggers async WebAssembly.instantiateStreaming
    // We add the WASM file as an external to prevent webpack from bundling it
    if (isServer) {
      // On the server, we need to copy the WASM file to the output directory
      // This is needed because sql.js loads the WASM at runtime via fs
    }

    return config;
  },
  // Ensure sql.js is not bundled by the server compiler — it needs WASM
  serverExternalPackages: ['sql.js'],
  // Include the pre-extracted JSON data files in the serverless function bundle for Vercel.
  // These are generated at build time by scripts/extract-data.js and are much smaller
  // than shipping the full 15MB SQLite database + WASM runtime.
  // Note: list specific files since directory globs may not work reliably with outputFileTracingIncludes.
  outputFileTracingIncludes: {
    '/*': [
      './public/data/records.json',
      './public/data/scp_statements.json',
      './public/data/classCounts.json',
      './public/data/searchIndex.json',
      './public/data/db_info.json',
    ],
  },
};

export default nextConfig;