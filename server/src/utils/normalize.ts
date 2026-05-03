export function normalizeName(value: string) {
  if (!value) return "";

  const callSigns = [...value.matchAll(/\(([A-Z]{3,5})\)/g)]
    .map((match) => match[1].toLowerCase())
    .join(" ");

  return `${value} ${callSigns}`
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/\[[^\]]*]/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(tv|channel|network|television|east|west|hd|fhd|uhd|sd|24 7|1080p|720p|540p|480p|film|movie|movies)\b/g, "")
    .trim()
    .replace(/\s+/g, " ");
}

function levenshteinDistance(left: string, right: string) {
  if (left === right) return 0;
  if (!left) return right.length;
  if (!right) return left.length;

  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = Array.from({ length: right.length + 1 }, () => 0);

  for (let i = 1; i <= left.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + cost
      );
    }
    previous.splice(0, previous.length, ...current);
  }

  return previous[right.length];
}

function ratio(left: string, right: string) {
  const longest = Math.max(left.length, right.length);
  if (longest === 0) return 0;
  return 1 - levenshteinDistance(left, right) / longest;
}

export function similarity(a: string, b: string) {
  const left = normalizeName(a);
  const right = normalizeName(b);
  if (!left || !right) return 0;
  if (left === right) return 1;

  const leftSorted = left.split(" ").sort().join(" ");
  const rightSorted = right.split(" ").sort().join(" ");

  return Math.max(ratio(left, right), ratio(leftSorted, rightSorted));
}
