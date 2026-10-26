/**
 * Whether a video opened in a viewer starts without sound.
 *
 * The setting asks for silence, and the viewer's own memory overrides it: a
 * person who unmuted one clip is watching a run of them with sound, so the
 * next one they step to should not fall silent again.
 */
export function startsMuted(openMuted: boolean, soundOn: boolean): boolean {
  return openMuted && !soundOn;
}
