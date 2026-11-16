#!/usr/bin/env node
'use strict';

/**
 * Замер скорости скачивания: делает N последовательных запросов к URL,
 * для каждого дожидается полного тела ответа и считает итоговую статистику.
 *
 * Использование:
 *   node speedtest.js <url> [-n <кол-во запросов>]
 */

const { performance } = require('node:perf_hooks');

const DEFAULT_COUNT = 10;

function usage() {
  console.log('Использование: node speedtest.js <url> [-n <кол-во запросов>]');
  console.log('Пример:        node speedtest.js https://example.com/big.jpg');
}

function parseArgs(argv) {
  let url = null;
  let count = DEFAULT_COUNT;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      usage();
      process.exit(0);
    } else if (arg === '-n' || arg === '--count') {
      count = Number(argv[++i]);
      if (!Number.isInteger(count) || count < 1) {
        throw new Error('Кол-во запросов (-n) должно быть целым числом больше 0');
      }
    } else if (!url) {
      url = arg;
    } else {
      throw new Error(`Неизвестный аргумент: ${arg}`);
    }
  }

  if (!url) throw new Error('Не указан URL');

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Некорректный URL: ${url}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Поддерживаются только http и https');
  }

  return { url: parsed.href, count };
}

/** Один запрос: возвращает { bytes, ms } после полного получения тела. */
async function measureOnce(url) {
  const start = performance.now();

  const res = await fetch(url, {
    redirect: 'follow',
    headers: {
      // Просим не сжимать, чтобы считать реально переданные байты.
      'accept-encoding': 'identity',
      // Просим промежуточные кэши не отдавать сохранённую копию.
      'cache-control': 'no-cache',
    },
  });

  if (!res.ok) {
    // Тело всё равно дочитываем, чтобы освободить соединение.
    await res.body?.cancel();
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }

  let bytes = 0;
  if (res.body) {
    for await (const chunk of res.body) {
      bytes += chunk.byteLength;
    }
  }

  const ms = performance.now() - start;
  return { bytes, ms };
}

const fmtMB = (bytes) => (bytes / 1e6).toFixed(2);
const fmtMs = (ms) => ms.toFixed(1);

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`Ошибка: ${err.message}\n`);
    usage();
    process.exit(2);
  }

  const { url, count } = opts;
  console.log(`URL: ${url}`);
  console.log(`Запросов: ${count} (последовательно)\n`);

  let totalBytes = 0;
  let totalMs = 0;

  for (let i = 1; i <= count; i++) {
    let result;
    try {
      result = await measureOnce(url);
    } catch (err) {
      const reason = err.cause?.message || err.message;
      console.error(`Запрос #${i} завершился ошибкой: ${reason}`);
      process.exit(1);
    }

    totalBytes += result.bytes;
    totalMs += result.ms;

    const speed = result.ms > 0 ? result.bytes / 1e6 / (result.ms / 1000) : 0;
    console.log(
      `#${String(i).padStart(2)}  ${fmtMB(result.bytes).padStart(9)} MB  ` +
        `${fmtMs(result.ms).padStart(9)} ms  ${speed.toFixed(2).padStart(8)} MB/s`
    );
  }

  const avgMs = totalMs / count;
  const speedMBs = totalMs > 0 ? totalBytes / 1e6 / (totalMs / 1000) : 0;
  const speedMbits = speedMBs * 8;

  console.log('\n──────────── Итог ────────────');
  console.log(`Скачано всего:   ${fmtMB(totalBytes)} MB (${totalBytes} байт)`);
  console.log(`Среднее время:   ${fmtMs(avgMs)} ms на запрос`);
  console.log(`Скорость:        ${speedMBs.toFixed(2)} MB/s (${speedMbits.toFixed(2)} Мбит/с)`);
}

main();
