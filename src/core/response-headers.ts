/**
 * One header of a response, whatever case the platform spelled its name in.
 *
 * Header names are case-insensitive, and requestUrl does not promise a case.
 * The desktop hands them over lowercased, the way Chromium's network stack
 * does, and every read here was written against that: `["content-type"]`.
 * The phone does not. iOS answers through NSHTTPURLResponse, which gives the
 * names in their canonical form, `Content-Type`, and the lowercase lookup
 * found nothing. Every response read there as one with no type at all, so a
 * video's page was saved as the video, because an untyped response was let
 * through as a file that simply had not said what it was.
 *
 * An exact match is tried first, since that is what the desktop always has.
 */
export function headerValue(
  headers: Readonly<Record<string, string>> | null | undefined,
  name: string
): string | undefined {
  if (!headers) return undefined;
  const exact = headers[name];
  if (exact !== undefined) return exact;

  const wanted = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === wanted) return headers[key];
  }
  return undefined;
}
