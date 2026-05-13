export function createStore(initialState) {
  let state = initialState;
  const listeners = new Set();

  return {
    getState() {
      return state;
    },

    patch(partial) {
      state = {
        ...state,
        ...partial,
        trainer: { ...state.trainer, ...(partial.trainer || {}) },
        telemetry: { ...state.telemetry, ...(partial.telemetry || {}) },
        ui: { ...state.ui, ...(partial.ui || {}) },
      };

      listeners.forEach((listener) => listener(state));
    },

    subscribe(listener) {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },
  };
}
