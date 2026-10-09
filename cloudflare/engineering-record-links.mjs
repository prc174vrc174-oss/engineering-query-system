/** @typedef {{id:string,name:string,relativePath:string,modifiedTime:string,content?:string}} Note */

function normalized(value) {
  try { value = decodeURIComponent(value); } catch {}
  const parts = [];
  for (const part of value.replace(/\\/g, '/').split('#')[0].replace(/\.md$/i, '').toLowerCase().split('/')) {
    if (!part || part === '.') continue;
    if (part === '..' && parts.length && parts.at(-1) !== '..') parts.pop();
    else parts.push(part);
  }
  return parts.join('/');
}

function readableMarkdown(content) {
  let fence = '';
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '').split(/\r?\n/).map(line => {
    const marker = /^\s*(`{3,}|~{3,})(.*)$/.exec(line);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = '';
      return '';
    }
    return fence ? '' : line;
  }).join('\n').replace(/%%[\s\S]*?%%/g, '').replace(/(`+)[\s\S]*?\1/g, '');
}

function references(content) {
  const text = readableMarkdown(content), result = [];
  for (const match of text.matchAll(/(?<!\\)\[\[([^\]\n]+)\]\]/g)) result.push(match[1].split('|')[0].trim());
  for (const match of text.matchAll(/(?<!\\)\]\(/g)) {
    let depth = 1, end = match.index + 2;
    for (; end < text.length; end++) {
      if (text[end] === '\\') { end++; continue; }
      if (text[end] === '(') depth++;
      if (text[end] === ')' && --depth === 0) break;
    }
    if (!depth) result.push(text.slice(match.index + 2, end).trim().replace(/\s+["'][^"']*["']$/, '').replace(/^<([\s\S]*)>$/, '$1'));
  }
  for (const match of text.matchAll(/https?:\/\/[^\s<>]+/g)) result.push(match[0].replace(/[.,，。;；!！、）]+$/, ''));
  return result;
}

/** @param {Note} target */
export function backlinkPatterns(target) {
  const name = target.name.replace(/\.md$/i, '');
  const pieces = name.split(/[\s%_()[\]#?]+/).filter(value => value.length >= 2);
  return [...new Set([name, ...pieces].flatMap(value => [value, encodeURI(value), encodeURIComponent(value)]).concat(target.id).filter(Boolean))]
    .map(value => '%' + value.toLowerCase().replace(/[\\%_]/g, '\\$&') + '%');
}

/** @param {Note[]} candidates @param {Note} target @param {Note[]} catalog */
export function referencingNotes(candidates, target, catalog) {
  function resolves(reference, source) {
    if (!reference || reference.startsWith('#')) return false;
    if (/^(?:https?:\/\/|engineering-query\.html\?)/i.test(reference)) {
      let url;
      try { url = new URL(reference, 'https://engineering-query.prc174.chatgpt.site/'); } catch { return false; }
      if (!['https://engineering-query.prc174.chatgpt.site', 'https://prc174vrc174-oss.github.io'].includes(url.origin)) return false;
      const id = url.searchParams.get('recordId');
      if (id) return id === target.id;
      reference = url.searchParams.get('recordName') || '';
    } else if (/^[a-z][a-z0-9+.-]*:/i.test(reference)) return false;
    if (!reference) return false;
    const wanted = normalized(reference);
    const parent = source.relativePath.replace(/[^/]*$/, '');
    const relative = catalog.find(note => normalized(note.relativePath) === normalized(parent + reference));
    const exact = catalog.find(note => normalized(note.relativePath) === wanted);
    if (relative || exact) return (relative || exact).id === target.id;
    const matches = catalog.filter(note => normalized(note.name) === wanted.split('/').at(-1));
    return matches.length === 1 && matches[0].id === target.id;
  }
  return candidates.filter(note => note.id !== target.id && references(note.content || '').some(ref => resolves(ref, note)))
    .map(({content, ...metadata}) => metadata);
}
