// Pointer capture keeps a held direction active without selecting text or losing releases.
export function bindRepeatControls(
  buttons,
  { step, next, blocked, delay = 320, interval = 150 },
) {
  let timer = null,
    pointer = null,
    direction = null;
  const stop = () => {
    clearTimeout(timer);
    timer = null;
    pointer = null;
    direction = null;
  };
  const tick = () => {
    if (!direction || blocked()) return stop();
    const following = next(...direction);
    if (!following) return stop();
    direction = following;
    if (!step(...direction)) return stop();
    timer = setTimeout(tick, interval);
  };
  for (const button of buttons) {
    const dir = [Number(button.dataset.dx), Number(button.dataset.dy)];
    button.addEventListener("contextmenu", (event) => event.preventDefault());
    button.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || blocked()) return;
      event.preventDefault();
      stop();
      pointer = event.pointerId;
      direction = dir;
      button.setPointerCapture?.(event.pointerId);
      if (!step(...dir) || (!dir[0] && !dir[1])) return stop();
      timer = setTimeout(tick, delay);
    });
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"])
      button.addEventListener(type, (event) => {
        if (pointer === event.pointerId) stop();
      });
    button.addEventListener("click", (event) => {
      if (event.detail === 0 && !blocked()) step(...dir);
    });
  }
  window.addEventListener("blur", stop);
  document.addEventListener("visibilitychange", stop);
  return stop;
}
