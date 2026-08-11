import 'dotenv/config';
import * as fs from 'fs';
import { PdfExtractionService } from './src/modules/v1/import/services/pdf-extraction.service';

class FakeConfigService {
  get<T = unknown>(key: string, fallback?: T): T {
    return (process.env[key] as unknown as T) ?? (fallback as T);
  }
}

async function run(fileName: string) {
  const service = new PdfExtractionService(new FakeConfigService() as any);
  const buffer = fs.readFileSync(fileName);
  console.log(`\n=== Extracting: ${fileName} (${buffer.length} bytes) ===`);
  try {
    const result = await service.extractContract(buffer, fileName);
    console.log(JSON.stringify(result, null, 2));
  } catch (e) {
    console.error('EXTRACTION FAILED:', (e as Error).message);
  }
}

async function main() {
  await run('Shop 7 - M17 (1).Pdf');
  await run('SHOP 8  - M17.Pdf');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
