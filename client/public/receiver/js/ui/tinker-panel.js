export class TinkerPanel {
  constructor(elements) {
    this.elements = elements;
  }

  render(state) {
    const telemetry = state.telemetry || {};

    if (this.elements.tinkerCumulativeRewardValue) {
      this.elements.tinkerCumulativeRewardValue.textContent = Number(telemetry.cumulativeReward || 0).toFixed(2);
    }
  }
}
