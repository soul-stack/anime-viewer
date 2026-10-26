// Compare title structure before relaxing punctuation or a missing subtitle.
// Season, cour/part and special-edition markers must never be discarded.
const compact = value => String(value || '').normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
const roman = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10, xi: 11, xii: 12 };
const unicodeRoman = { 'Ⅰ': 1, 'Ⅱ': 2, 'Ⅲ': 3, 'Ⅳ': 4, 'Ⅴ': 5, 'Ⅵ': 6, 'Ⅶ': 7, 'Ⅷ': 8, 'Ⅸ': 9, 'Ⅹ': 10, 'Ⅺ': 11, 'Ⅻ': 12,
  'ⅰ': 1, 'ⅱ': 2, 'ⅲ': 3, 'ⅳ': 4, 'ⅴ': 5, 'ⅵ': 6, 'ⅶ': 7, 'ⅷ': 8, 'ⅸ': 9, 'ⅹ': 10, 'ⅺ': 11, 'ⅻ': 12 };
const numberText = '[0-9零〇一二三四五六七八九十百两ivx]+';

function number(value) {
  value = String(value).toLowerCase();
  if (/^\d+$/.test(value)) return Number(value);
  if (roman[value]) return roman[value];
  const digits = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (value.length === 1 && value in digits) return digits[value];
  if (/^[一二三四五六七八九]?十[一二三四五六七八九]?$/.test(value)) {
    const [tens, units] = value.split('十');
    return (tens ? digits[tens] : 1) * 10 + (units ? digits[units] : 0);
  }
  return null;
}

function describe(value) {
  const original = String(value || '').trim();
  let text = original.replace(/[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩⅪⅫⅰⅱⅲⅳⅴⅵⅶⅷⅸⅹⅺⅻ]/g, marker => ` 第${unicodeRoman[marker]}季 `)
    .normalize('NFKC').toLowerCase();
  const seasons = new Set(), parts = new Set(), editions = new Set();
  const mark = (set, value) => { const parsed = number(value); if (parsed !== null) set.add(parsed); };

  // An explicit split cour is different even if both pages number their episodes from 1.
  text = text.replace(new RegExp(`(?:\\b(?:part|cour)\\s*|第\\s*)(${numberText})\\s*(?:部分|部|篇)?(?=$|[\\s~:：()（）\u4e00-\u9fff])`, 'gi'), (whole, value) => {
    // 第2季/第2期 are seasons, not parts; this branch does not consume those markers.
    if (/^第/.test(whole) && !/(?:部分|部|篇)$/.test(whole)) return whole;
    mark(parts, value); return ' ';
  });
  text = text.replace(/(?:下半(?:季|部)?|后半(?:季|部)?|後半(?:季|部)?|下篇)/g, () => { parts.add(2); return ' '; });
  text = text.replace(/(?:上半(?:季|部)?|前半(?:季|部)?|上篇)/g, () => { parts.add(1); return ' '; });

  function seasonMarker(whole, value, offset, input) {
    const parsed = number(value);
    if (parsed === null) return whole;
    seasons.add(parsed);
    const prefix = input.slice(0, offset).trim();
    const suffix = input.slice(offset + whole.length).trim();
    // A subtitle after a season marker can be omitted by a provider. Keep it as
    // a separate component so two explicitly different subtitles cannot match.
    return compact(prefix).length >= 3 && suffix ? ' ~ ' : ' ';
  }
  text = text.replace(new RegExp(`第\\s*(${numberText})\\s*(?:季|期)`, 'gi'), seasonMarker);
  text = text.replace(new RegExp(`\\bseason\\s*(${numberText})\\b`, 'gi'), seasonMarker);
  text = text.replace(/\b(\d+)(?:st|nd|rd|th)\s+season\b/gi, seasonMarker);
  text = text.replace(/\bs([0-9]+)\b/gi, seasonMarker);
  text = text.replace(/(?<![a-z0-9])([ivx]{1,5})(?![a-z0-9])/gi, (whole, value, offset, input) => {
    if (compact(input.slice(0, offset)).length < 3) return whole;
    return seasonMarker(whole, value, offset, input);
  });

  const editionPatterns = [
    ['movie', /剧场版|劇場版|电影版|電影版|映画|\bmovie\b/gi],
    ['ova', /\b(?:ova|oad)\b/gi],
    ['special', /特别篇|特別篇|特别版|特別版|\bspecial\b/gi],
    ['recap', /总集(?:篇|编|編|版)?|總集(?:篇|編|版)?|\brecap\b/gi],
    ['commentary', /解说|解說/gi],
    ['trailer', /预告|預告|\b(?:pv|trailer)\b/gi],
  ];
  for (const [kind, pattern] of editionPatterns) {
    text = text.replace(pattern, () => { editions.add(kind); return ' '; });
  }
  text = text.trim().replace(/^[~:：\s]+|[~:：\s]+$/g, '');
  const separator = /[~:：]|\s[-—–]\s/.exec(text);
  const prefix = separator ? text.slice(0, separator.index).trim() : text;
  const canSplit = separator && compact(prefix).length >= 3;
  const main = canSplit ? prefix : text;
  const subtitle = canSplit ? text.slice(separator.index + separator[0].length).replace(/^[~:：\s]+|[~:：\s]+$/g, '') : '';
  return {
    original, main, subtitle: compact(subtitle), full: compact(text), key: compact(main),
    season: seasons.size ? [...seasons][0] : 1,
    explicitSeason: seasons.size > 0,
    part: parts.size ? [...parts][0] : 1,
    editions: [...editions].sort().join(','),
    ambiguous: seasons.size > 1 || parts.size > 1,
  };
}

function matchTitle(candidate, target) {
  const left = describe(candidate), right = describe(target);
  if (!left.full || !right.full || left.ambiguous || right.ambiguous) return false;
  if (left.season !== right.season || left.part !== right.part || left.editions !== right.editions) return false;
  if (left.full === right.full) return true;
  // For unnumbered works a colon can denote a different adaptation (for example
  // Fate/stay night versus its named routes). Do not treat that as a safe alias.
  return left.explicitSeason && right.explicitSeason && left.key === right.key &&
    (!left.subtitle || !right.subtitle || left.subtitle === right.subtitle);
}

function searchTerms(target) {
  const parsed = describe(target);
  if (!parsed.original) return [];
  const result = [parsed.original];
  if (!parsed.ambiguous && parsed.key.length >= 3 && compact(parsed.main) !== compact(parsed.original)) {
    result.push(parsed.main);
  }
  return [...new Set(result)];
}

module.exports = { matchTitle, searchTerms };
