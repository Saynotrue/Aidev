// .env 로딩 (Node 20.12+ 내장 process.loadEnvFile 사용, 외부 패키지 없음)
import { existsSync } from 'node:fs';
import path from 'node:path';

export function loadEnv(root) {
  const file = path.join(root, '.env');
  if (existsSync(file) && typeof process.loadEnvFile === 'function') process.loadEnvFile(file);
}
