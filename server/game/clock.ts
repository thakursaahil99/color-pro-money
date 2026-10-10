/** Single source of server time. Tests swap it to simulate the passage of time. */
let nowFn: () => number = () => Date.now();

export const clock = {
  now: () => nowFn(),
  set(fn: () => number) {
    nowFn = fn;
  },
  reset() {
    nowFn = () => Date.now();
  },
};
