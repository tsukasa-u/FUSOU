import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default {
  entry: './src/index.ts',
  target: 'webworker',
  output: {
    filename: 'worker.js',
    path: path.join(__dirname, 'dist'),
    publicPath: '/', // Fix "Automatic publicPath is not supported" error
    module: true, // Output as ES module (Cloudflare Workers support this)
    chunkFormat: 'module',
    library: {
      type: 'module',
    },
  },
  mode: 'production',
  resolve: {
    extensions: ['.ts', '.js'],
    fallback: {
      "buffer": false, // 'buffer/' alias caused issues in some ESM builds, use node:buffer or false if not needed
    }
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        loader: 'ts-loader',
        options: {
          transpileOnly: true,
        },
      },
    ],
  },
  experiments: {
    outputModule: true, // Required for output.module: true
  },
  performance: {
    hints: false,
  },
};
