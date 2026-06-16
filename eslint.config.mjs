import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlatCompat } from '@eslint/eslintrc';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compat = new FlatCompat({ baseDirectory: __dirname });

const eslintConfig = [
  {
    ignores: ['.next/**', '.test-dist/**', 'node_modules/**', 'next-env.d.ts']
  },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    rules: {
      // Foto berasal dari private Supabase signed URL dan ukurannya tidak diketahui saat render.
      '@next/next/no-img-element': 'off'
    }
  }
];

export default eslintConfig;
