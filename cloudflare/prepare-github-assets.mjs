import {readFile,writeFile} from 'node:fs/promises';
const root = new URL('../',import.meta.url);
const path = new URL('public/engineering-records-d1.js',root);
let source = await readFile(path,'utf8');
const oldRemote = "var remote = /\\.github\\.io$/i.test(location.hostname) ? 'https://engineering-query.prc174.chatgpt.site' : '';";
const newRemote = "var remote = /\\.github\\.io$/i.test(location.hostname) ? 'https://engineering-records-api.janyu056.workers.dev' : '';";
if (!source.includes(oldRemote) && !source.includes(newRemote)) throw new Error('Unexpected engineering API configuration; review before syncing.');
source = source.replace(oldRemote,newRemote);
const previous = `var result = await call(api, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'refresh', force: force }) });`;
const continued = `var result;
      // Continue resumable Cloudflare sync batches until all full texts are present.
      do {
        result = await call(api, { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'refresh', force: force }) });
        if (result.syncing && !result.busy) {
          setStatus('正在更新工程紀錄，剩餘 ' + result.remaining + ' 篇…', 'loading');
          await new Promise(function (resolve) { setTimeout(resolve, 1000); });
        }
      } while (result.syncing && !result.busy);`;
if (!source.includes(previous) && !source.includes(continued)) throw new Error('Unexpected refresh code; review before syncing.');
source = source.replace(previous,continued);
await writeFile(path,source);
const servicePath = new URL('public/service-worker.js',root);
const service = await readFile(servicePath,'utf8');
await writeFile(servicePath,service.replace(/const CACHE_NAME = '[^']+';/,"const CACHE_NAME = 'engineering-query-pwa-v216-cloudflare-summary-40-records';"));
