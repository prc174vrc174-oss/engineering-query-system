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
export function backlinkNeedles(target) {
  const name = target.name.replace(/\.md$/i, '');
  const pieces = name.split(/[\s%_()[\]#?]+/).filter(value => value.length >= 2);
  return [...new Set([name, ...pieces].flatMap(value => [value, encodeURI(value), encodeURIComponent(value)]).concat(target.id).filter(Boolean))]
    .map(value => value.toLowerCase());
}

/** @param {Note[]} candidates @param {Note} target @param {Note[]} catalog */
export function referencingNotes(candidates, target, catalog) {
  // Normalize the catalog once per request, instead of for every reference.
  const paths = new Map(), names = new Map();
  for (const note of catalog) {
    const path = normalized(note.relativePath), name = normalized(note.name);
    if (!paths.has(path)) paths.set(path, note);
    const named = names.get(name);
    if (named) named.count++;
    else names.set(name, { note, count: 1 });
  }
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
    const relative = paths.get(normalized(parent + reference));
    const exact = paths.get(wanted);
    if (relative || exact) return (relative || exact).id === target.id;
    const match = names.get(wanted.split('/').at(-1));
    return !!match && match.count === 1 && match.note.id === target.id;
  }
  return candidates.filter(note => note.id !== target.id && references(note.content || '').some(ref => resolves(ref, note)))
    .map(({content, ...metadata}) => metadata);
}
