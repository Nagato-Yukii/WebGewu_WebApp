import { getServerConfig, getRTCConfiguration } from "../../js/config.js";
import { createDisplayStringArray } from "../../js/stats.js";
import { VideoPlayer } from "../../js/videoplayer.js";
import { RenderStreaming } from "../../module/renderstreaming.js";
import { WebSocketSignaling } from "../../module/signaling.js";
import { createEnvelope } from "./protocol/envelope.js";
import { RtcChannelClient } from "./transport/rtc-channel.js";
import { createStore } from "./app/store.js";
import { ApiClient } from "./app/api-client.js";
import { SceneController } from "./app/scene-controller.js";
import { TinkerController } from "./app/tinker-controller.js";
import { TinkerPanel } from "./ui/tinker-panel.js";

/** @type {Element} */
let playButton;
/** @type {RenderStreaming} */
let renderstreaming;
/** @type {RTCDataChannel | null} */
let controlChannel = null;
let isStartingStreaming = false;

const ROBOT_POLICIES = {
  X02Lite: [
    { label: '1. Walk', statusLabel: 'Walk', skillType: 'bipedWalk' },
    { label: '2. Run', statusLabel: 'Run', skillType: 'bipedRun' },
    { label: '3. Jump', statusLabel: 'Jump', skillType: 'bipedJump' },
  ],
  Go2: [
    { label: '1. Trot', statusLabel: 'Trot', skillType: 'quadTrot' },
    { label: '2. Bound', statusLabel: 'Bound', skillType: 'quadBound' },
    { label: '3. Pronk', statusLabel: 'Pronk', skillType: 'quadPronk' },
  ],
  Go2W: [
    { label: '1. Drive', statusLabel: 'Drive', skillType: 'wheelDrive' },
    { label: '2. Walk', statusLabel: 'Walk', skillType: 'wheelWalk' },
    { label: '3. Jump', statusLabel: 'Jump', skillType: 'wheelJump' },
  ],
  OpenLoong: [
    { label: '1. Walk', statusLabel: 'Walk', skillType: 'bipedWalk' },
    { label: '2. Run', statusLabel: 'Run', skillType: 'bipedRun' },
    { label: '3. Jump', statusLabel: 'Jump', skillType: 'bipedJump' },
  ],
  Tron1: [
    { label: '1. Drive', statusLabel: 'Drive', skillType: 'wheelDrive' },
    { label: '2. Walk', statusLabel: 'Walk', skillType: 'wheelWalk' },
    { label: '3. Jump', statusLabel: 'Jump', skillType: 'wheelJump' },
  ],
};

let selectedRobot = 'X02Lite';
let selectedSkillType = '';
let activePanelName = '';
let tinkerLiftAssistCurriculum = 1;
let isTinkerTrainerRequestPending = false;
let latencyProbeIntervalId = null;
let latencyProbeSequence = 0;
const pendingLatencyPings = new Map();
const latencyProbeIntervalMs = 3000;
const roboHetuKeyState = {
  forward: false,
  back: false,
  left: false,
  right: false,
  rotateLeft: false,
  rotateRight: false,
};
const setupPromise = setup();

const codecPreferences = document.getElementById('codecPreferences');
const supportsSetCodecPreferences = window.RTCRtpTransceiver &&
  'setCodecPreferences' in window.RTCRtpTransceiver.prototype;
const messageDiv = document.getElementById('message');
messageDiv.style.display = 'none';

const playerDiv = document.getElementById('player');
const lockMouseCheck = document.getElementById('lockMouseCheck');
const videoPlayer = new VideoPlayer();
const coverPanel = document.getElementById('cover-panel');
const webrlPanel = document.getElementById('webrl-panel');
const robohetuPanel = document.getElementById('robohetu-panel');
const webtinkerPanel = document.getElementById('webtinker-panel');
const startWebrlButton = document.getElementById('startWebrlButton');
const startRoboHetuButton = document.getElementById('startRoboHetuButton');
const startWebTinkerButton = document.getElementById('startWebTinkerButton');
const backToDirectoryFromWebrl = document.getElementById('backToDirectoryFromWebrl');
const backToDirectoryFromRobohetu = document.getElementById('backToDirectoryFromRobohetu');
const backToDirectoryFromWebtinker = document.getElementById('backToDirectoryFromWebtinker');
const tinkerTrainingToggleButton = document.getElementById('tinkerTrainingToggleButton');
const tinkerLiftAssistCurriculumValue = document.getElementById('tinkerLiftAssistCurriculumValue');
const tinkerCumulativeRewardValue = document.getElementById('tinkerCumulativeRewardValue');
const robotButtons = document.querySelectorAll('#robotButtonRow .robot-button');
const policyButtonRow = document.getElementById('policyButtonRow');
const selectionStatus = document.getElementById('selectionStatus');
const currentRobotLabel = document.getElementById('currentRobotLabel');
const tinkerStore = createStore({
  trainer: {
    state: 'idle',
    pid: null,
    runId: 'webtinkerrl',
    scriptPath: '',
    logFile: '',
    trainerWorkingDirectory: '',
    trainerPort: 5004,
    delayMs: 10000,
    error: '',
  },
  telemetry: {
    trainEnabled: false,
    episodeStepCount: 0,
    totalTrainingStepCount: 0,
    totalFalls: 0,
    totalCoins: 0,
    cumulativeReward: 0,
    stepReward: 0,
    liftAssistCurriculum: 1,
    currentLiftAssistForce: 0,
    hasTelemetry: false,
  },
  ui: {
    activePanel: '',
  },
});
const rtcChannelClient = new RtcChannelClient();
const apiClient = new ApiClient();
const sceneController = new SceneController(rtcChannelClient);
const tinkerController = new TinkerController(apiClient, rtcChannelClient, sceneController, tinkerStore);
const tinkerPanel = new TinkerPanel({
  tinkerCumulativeRewardValue,
});

rtcChannelClient.on('telemetry.tinker', (envelope) => {
  const telemetry = envelope && envelope.payload ? envelope.payload : null;
  if (!telemetry) {
    return;
  }

  tinkerStore.patch({
    telemetry: {
      trainEnabled: !!telemetry.trainEnabled,
      episodeStepCount: Number(telemetry.episodeStepCount) || 0,
      totalTrainingStepCount: Number(telemetry.totalTrainingStepCount) || 0,
      totalFalls: Number(telemetry.totalFalls) || 0,
      totalCoins: Number(telemetry.totalCoins) || 0,
      cumulativeReward: Number(telemetry.cumulativeReward) || 0,
      stepReward: Number(telemetry.stepReward) || 0,
      liftAssistCurriculum: Number(telemetry.liftAssistCurriculum) || 0,
      currentLiftAssistForce: Number(telemetry.currentLiftAssistForce) || 0,
      hasTelemetry: true,
    },
    trainer: {
      state: telemetry.trainEnabled ? 'training_active' : tinkerStore.getState().trainer.state,
    },
  });
});

rtcChannelClient.on('latency.pong', (envelope) => {
  const payload = envelope && envelope.payload ? envelope.payload : null;
  if (!payload) {
    return;
  }

  const webRecvTs = Date.now();
  const sentMetadata = pendingLatencyPings.get(payload.echoId);
  if (payload.echoId) {
    pendingLatencyPings.delete(payload.echoId);
  }

  const webSendTs = Number(sentMetadata?.webSendTs ?? payload.webTs) || 0;
  const unityRxTs = Number(payload.unityRxTs) || 0;
  const unityTxTs = Number(payload.unityTxTs) || 0;
  const unityProcessingMs = Math.max(0, unityTxTs - unityRxTs);
  const rttMs = webSendTs > 0 ? Math.max(0, webRecvTs - webSendTs) : NaN;
  const estimatedOneWayMs = Number.isFinite(rttMs)
    ? Math.max(0, (rttMs - unityProcessingMs) / 2)
    : NaN;
  const sequence = Number(payload.sequence ?? sentMetadata?.sequence) || 0;
  console.log(
    `[LatencyProbe] seq=${sequence} rtt=${Number.isFinite(rttMs) ? rttMs.toFixed(1) : 'n/a'}ms ` +
    `unityProc=${unityProcessingMs.toFixed(1)}ms estOneWay=${Number.isFinite(estimatedOneWayMs) ? estimatedOneWayMs.toFixed(1) : 'n/a'}ms`,
  );
});

tinkerStore.subscribe((state) => {
  if (state.telemetry.hasTelemetry) {
    tinkerLiftAssistCurriculum = Number(state.telemetry.liftAssistCurriculum) || 0;
    renderTinkerLiftAssistCurriculum();
  }

  renderTinkerTrainingState();
  tinkerPanel.render(state);
});

startWebrlButton.addEventListener('click', () => {
  handleSceneSelection('webrl', 'WebRL_Laboratory');
});

startRoboHetuButton.addEventListener('click', () => {
  handleSceneSelection('robohetu', 'RoboHeTu');
});

startWebTinkerButton.addEventListener('click', () => {
  void handleSceneSelection('webtinker', 'WebTinkerRL');
});

backToDirectoryFromWebrl.addEventListener('click', handleReturnToDirectory);
backToDirectoryFromRobohetu.addEventListener('click', handleReturnToDirectory);
if (backToDirectoryFromWebtinker) {
  backToDirectoryFromWebtinker.addEventListener('click', handleReturnToDirectory);
}
if (tinkerTrainingToggleButton) {
  tinkerTrainingToggleButton.addEventListener('click', handleTinkerTrainingToggle);
}
robotButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const nextRobot = button.dataset.target;
    if (selectedRobot !== nextRobot) {
      selectedRobot = nextRobot;
      selectedSkillType = '';
    }
    renderRobotSelection();
    renderPolicyButtons();
  });
});

renderRobotSelection();
renderPolicyButtons();
renderTinkerTrainingState();
renderTinkerLiftAssistCurriculum();
resetTinkerTelemetry();
renderTinkerTrainerStatus();

window.document.oncontextmenu = function () {
  return false;
};

window.addEventListener('resize', function () {
  videoPlayer.resizeVideo();
}, true);

window.addEventListener('beforeunload', async () => {
  cancelPendingWebTinkerSceneLoad();
  resetRoboHetuKeyState();
  sendRoboHetuMoveState();
  stopLatencyProbe();
  if (!renderstreaming) {
    return;
  }
  await renderstreaming.stop();
  controlChannel = null;
}, true);

window.addEventListener('keydown', handleRoboHetuKeyDown, false);
window.addEventListener('keyup', handleRoboHetuKeyUp, false);
window.addEventListener('blur', handleRoboHetuWindowBlur, false);

function renderRobotSelection() {
  currentRobotLabel.textContent = `Robot: ${selectedRobot}`;
  robotButtons.forEach((button) => {
    button.classList.toggle('active', button.dataset.target === selectedRobot);
  });
}

function renderPolicyButtons() {
  policyButtonRow.innerHTML = '';

  const policies = ROBOT_POLICIES[selectedRobot] || [];
  policies.forEach((policy) => {
    const button = document.createElement('button');
    button.className = 'control-button policy-button';
    button.textContent = policy.label;
    button.classList.toggle('active', policy.skillType === selectedSkillType);
    button.addEventListener('click', () => {
      selectedSkillType = policy.skillType;
      sendModelChange(selectedRobot, policy.skillType);
      renderPolicyButtons();
      selectionStatus.textContent = `${selectedRobot} / ${policy.statusLabel}`;
    });
    policyButtonRow.appendChild(button);
  });

  if (!selectedSkillType) {
    selectionStatus.textContent = '';
  }
}

function sendModelChange(target, skillType) {
  if (!controlChannel || controlChannel.readyState !== 'open') {
    console.warn('Model control channel is not ready.');
    return;
  }

  controlChannel.send(JSON.stringify({
    command: 'changeModel',
    target: target,
    skillType: skillType
  }));
}

function setActivePanel(panelName) {
  activePanelName = panelName;
  coverPanel.style.display = 'none';
  webrlPanel.style.display = panelName === 'webrl' ? 'block' : 'none';
  robohetuPanel.style.display = panelName === 'robohetu' ? 'block' : 'none';
  webtinkerPanel.style.display = panelName === 'webtinker' ? 'block' : 'none';
}

function resetOverlayState() {
  activePanelName = '';
  coverPanel.style.display = 'none';
  webrlPanel.style.display = 'none';
  robohetuPanel.style.display = 'none';
  webtinkerPanel.style.display = 'none';
}

function showSceneSelector() {
  activePanelName = '';
  coverPanel.style.display = 'flex';
  webrlPanel.style.display = 'none';
  robohetuPanel.style.display = 'none';
  webtinkerPanel.style.display = 'none';
}

function requestSceneLoad(target) {
  sceneController.requestSceneLoad(target, {
    mode: 'additive',
    forceReload: false,
  });
}

function cancelPendingWebTinkerSceneLoad() {
  tinkerController.cancelPending();
}

function flushPendingSceneLoad() {
  sceneController.flush();
}

async function setup() {
  const res = await getServerConfig();
  showWarningIfNeeded(res.startupMode);
  showCodecSelect();
  showPlayButton();
}

function showWarningIfNeeded(startupMode) {
  const warningDiv = document.getElementById('warning');
  if (startupMode == 'private') {
    warningDiv.innerHTML = '<h4>Warning</h4> This sample is not working on Private Mode.';
    warningDiv.hidden = false;
  }
}

function showPlayButton() {
  if (!document.getElementById('playButton')) {
    const elementPlayButton = document.createElement('img');
    elementPlayButton.id = 'playButton';
    elementPlayButton.src = '../../images/Play.png';
    elementPlayButton.alt = 'Start Streaming';
    playButton = document.getElementById('player').appendChild(elementPlayButton);
    playButton.addEventListener('click', onClickPlayButton);
  }
}

function onClickPlayButton() {
  void startStreamingIfNeeded();
}

function sendTinkerTrainingFlag(enabled) {
  return rtcChannelClient.send(createEnvelope('training.set_flag', {
    enabled: enabled,
    source: 'external',
  }));
}

function scheduleWebTinkerSceneLoad(sceneTarget, delaySeconds) {
  void sceneTarget;
  void delaySeconds;
}

async function requestLocalWebTinkerSessionStart(forceRestart = false) {
  try {
    return await tinkerController.start({
      forceRestart: forceRestart,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    tinkerStore.patch({
      trainer: {
        state: 'error',
        error: message,
      },
    });
    return null;
  }
}
async function handleSceneSelection(panelName, sceneTarget) {
  if (panelName !== 'webtinker') {
    cancelPendingWebTinkerSceneLoad();
  }

  if (activePanelName === 'robohetu' && panelName !== 'robohetu') {
    resetRoboHetuKeyState();
    sendRoboHetuMoveState();
  }

  if (panelName === 'webtinker') {
    setActivePanel(panelName);
    renderTinkerTrainingState();
    resetTinkerTelemetry();
    renderTinkerTrainerStatus();
    await requestLocalWebTinkerSessionStart();
    return;
  }

  setActivePanel(panelName);
  requestSceneLoad(sceneTarget);
}

function handleReturnToDirectory() {
  const previousPanel = activePanelName;
  cancelPendingWebTinkerSceneLoad();
  if (previousPanel === 'webtinker') {
    tinkerController.stop();
  }
  resetRoboHetuKeyState();
  sendRoboHetuMoveState();
  resetTinkerTelemetry();
  showSceneSelector();
  if (previousPanel !== 'webtinker') {
    requestSceneLoad('GlobalManager');
  }
}

async function handleTinkerTrainingToggle() {
  if (isTinkerTrainerRequestPending) {
    return;
  }

  isTinkerTrainerRequestPending = true;
  renderTinkerTrainingState();

  try {
    await requestLocalWebTinkerSessionStart(true);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    tinkerStore.patch({
      trainer: {
        state: 'error',
        error: message,
      },
    });
  } finally {
    isTinkerTrainerRequestPending = false;
    renderTinkerTrainingState();
    renderTinkerTrainerStatus();
  }
}

function renderTinkerTrainingState() {
  if (!tinkerTrainingToggleButton) {
    return;
  }

  const trainerState = tinkerStore.getState().trainer.state;
  const isBusy = isTinkerTrainerRequestPending || trainerState === 'bootstrapping';

  if (isBusy) {
    tinkerTrainingToggleButton.textContent = 'Starting Local Trainer...';
  } else {
    tinkerTrainingToggleButton.textContent = 'Restart Local Trainer Bootstrap';
  }

  tinkerTrainingToggleButton.disabled = isBusy;
  tinkerTrainingToggleButton.classList.toggle('active', trainerState === 'bootstrapping' || trainerState === 'training_active');

}

function resetTinkerTelemetry() {
  tinkerLiftAssistCurriculum = 1;
  renderTinkerLiftAssistCurriculum();
  tinkerStore.patch({
    telemetry: {
      trainEnabled: false,
      episodeStepCount: 0,
      totalTrainingStepCount: 0,
      totalFalls: 0,
      totalCoins: 0,
      cumulativeReward: 0,
      stepReward: 0,
      liftAssistCurriculum: 1,
      currentLiftAssistForce: 0,
      hasTelemetry: false,
    },
  });
}

function renderTinkerLiftAssistCurriculum() {
  if (tinkerLiftAssistCurriculumValue) {
    tinkerLiftAssistCurriculumValue.textContent = tinkerLiftAssistCurriculum.toFixed(2);
  }
}

function handleControlChannelMessage(event) {
  if (typeof event.data !== 'string') {
    return;
  }
  rtcChannelClient.dispatch(event.data);
}

function sendLatencyPing() {
  const envelope = createEnvelope('latency.ping', {
    sequence: ++latencyProbeSequence,
  });

  pendingLatencyPings.set(envelope.id, {
    webSendTs: envelope.ts,
    sequence: latencyProbeSequence,
  });

  const sent = rtcChannelClient.send(envelope);
  if (!sent) {
    pendingLatencyPings.delete(envelope.id);
  }
}

function startLatencyProbe() {
  if (latencyProbeIntervalId !== null) {
    return;
  }

  sendLatencyPing();
  latencyProbeIntervalId = window.setInterval(() => {
    sendLatencyPing();
  }, latencyProbeIntervalMs);
}

function stopLatencyProbe() {
  if (latencyProbeIntervalId !== null) {
    window.clearInterval(latencyProbeIntervalId);
    latencyProbeIntervalId = null;
  }

  pendingLatencyPings.clear();
}

function renderTinkerTelemetry() {
  tinkerPanel.render(tinkerStore.getState());
}

function renderTinkerTrainerStatus() {
  renderTinkerTrainingState();
  tinkerPanel.render(tinkerStore.getState());
}

function handleRoboHetuKeyDown(event) {
  if (activePanelName !== 'robohetu') {
    return;
  }

  const handled = updateRoboHetuKeyState(event.code, true);
  if (handled) {
    event.preventDefault();
    sendRoboHetuMoveState();
    return;
  }

  if (event.repeat) {
    return;
  }

  const mode = resolveRoboHetuMode(event.code);
  if (mode === null) {
    return;
  }

  event.preventDefault();
  sendRoboHetuMode(mode);
}

function handleRoboHetuKeyUp(event) {
  if (activePanelName !== 'robohetu') {
    return;
  }

  if (!updateRoboHetuKeyState(event.code, false)) {
    return;
  }

  event.preventDefault();
  sendRoboHetuMoveState();
}

function handleRoboHetuWindowBlur() {
  if (activePanelName !== 'robohetu') {
    return;
  }

  resetRoboHetuKeyState();
  sendRoboHetuMoveState();
}

function updateRoboHetuKeyState(code, isPressed) {
  switch (code) {
    case 'KeyW':
      roboHetuKeyState.forward = isPressed;
      return true;
    case 'KeyS':
      roboHetuKeyState.back = isPressed;
      return true;
    case 'KeyA':
      roboHetuKeyState.left = isPressed;
      return true;
    case 'KeyD':
      roboHetuKeyState.right = isPressed;
      return true;
    case 'KeyQ':
      roboHetuKeyState.rotateLeft = isPressed;
      return true;
    case 'KeyE':
      roboHetuKeyState.rotateRight = isPressed;
      return true;
    default:
      return false;
  }
}

function resetRoboHetuKeyState() {
  roboHetuKeyState.forward = false;
  roboHetuKeyState.back = false;
  roboHetuKeyState.left = false;
  roboHetuKeyState.right = false;
  roboHetuKeyState.rotateLeft = false;
  roboHetuKeyState.rotateRight = false;
}

function resolveRoboHetuMode(code) {
  switch (code) {
    case 'Digit1':
      return 0;
    case 'Digit2':
      return 1;
    case 'Digit3':
      return 2;
    default:
      return null;
  }
}

function sendRoboHetuMoveState() {
  if (!controlChannel || controlChannel.readyState !== 'open') {
    return;
  }

  const moveX = (roboHetuKeyState.right ? 1 : 0) - (roboHetuKeyState.left ? 1 : 0);
  const moveY = (roboHetuKeyState.forward ? 1 : 0) - (roboHetuKeyState.back ? 1 : 0);
  const rotate = (roboHetuKeyState.rotateRight ? 1 : 0) - (roboHetuKeyState.rotateLeft ? 1 : 0);

  controlChannel.send(JSON.stringify({
    command: 'roboHetuMove',
    moveX: moveX,
    moveY: moveY,
    rotate: rotate,
  }));
}

function sendRoboHetuMode(mode) {
  if (!controlChannel || controlChannel.readyState !== 'open') {
    return;
  }

  controlChannel.send(JSON.stringify({
    command: 'roboHetuMode',
    mode: mode,
  }));
}

async function startStreamingIfNeeded() {
  await setupPromise;

  if (renderstreaming || isStartingStreaming) {
    return;
  }

  isStartingStreaming = true;

  if (playButton) {
    playButton.style.display = 'none';
  }

  if (!document.getElementById('Video')) {
    videoPlayer.createPlayer(playerDiv, lockMouseCheck);
  }

  try {
    await setupRenderStreaming();
  } catch (error) {
    console.error('Failed to start streaming.', error);
    if (playButton) {
      playButton.style.display = 'block';
    }
  } finally {
    isStartingStreaming = false;
  }
}

async function setupRenderStreaming() {
  codecPreferences.disabled = true;

  const signaling = new WebSocketSignaling();
  const config = getRTCConfiguration();
  renderstreaming = new RenderStreaming(signaling, config);
  renderstreaming.onConnect = onConnect;
  renderstreaming.onDisconnect = onDisconnect;
  renderstreaming.onTrackEvent = (data) => videoPlayer.addTrack(data.track);
  renderstreaming.onGotOffer = setCodecPreferences;

  await renderstreaming.start();
  await renderstreaming.createConnection();
}

function onConnect() {
  controlChannel = renderstreaming.createDataChannel('input');
  rtcChannelClient.bind(controlChannel);
  controlChannel.addEventListener('open', () => {
    flushPendingSceneLoad();
    startLatencyProbe();
  });
  videoPlayer.setupInput(controlChannel);
  flushPendingSceneLoad();
  showSceneSelector();
  showStatsMessage();
}

async function onDisconnect(connectionId) {
  clearStatsMessage();
  cancelPendingWebTinkerSceneLoad();
  stopLatencyProbe();
  rtcChannelClient.unbind();
  sceneController.clearPending();
  messageDiv.style.display = 'block';
  messageDiv.innerText = `Disconnect peer on ${connectionId}.`;

  await renderstreaming.stop();
  controlChannel = null;
  renderstreaming = null;
  isStartingStreaming = false;
  resetOverlayState();
  renderTinkerTrainingState();
  resetTinkerTelemetry();
  renderTinkerTrainerStatus();
  videoPlayer.deletePlayer();
  if (supportsSetCodecPreferences) {
    codecPreferences.disabled = false;
  }
  showPlayButton();
}

function setCodecPreferences() {
  /** @type {RTCRtpCodecCapability[] | null} */
  let selectedCodecs = null;
  if (supportsSetCodecPreferences) {
    const preferredCodec = codecPreferences.options[codecPreferences.selectedIndex];
    if (preferredCodec.value !== '') {
      const [mimeType, sdpFmtpLine] = preferredCodec.value.split(' ');
      const { codecs } = RTCRtpSender.getCapabilities('video');
      const selectedCodecIndex = codecs.findIndex(c => c.mimeType === mimeType && c.sdpFmtpLine === sdpFmtpLine);
      const selectCodec = codecs[selectedCodecIndex];
      selectedCodecs = [selectCodec];
    }
  }

  if (selectedCodecs == null) {
    return;
  }
  const transceivers = renderstreaming.getTransceivers().filter(t => t.receiver.track.kind == 'video');
  if (transceivers && transceivers.length > 0) {
    transceivers.forEach(t => t.setCodecPreferences(selectedCodecs));
  }
}

function showCodecSelect() {
  if (!supportsSetCodecPreferences) {
    messageDiv.style.display = 'block';
    messageDiv.innerHTML = 'Current Browser does not support <a href="https://developer.mozilla.org/en-US/docs/Web/API/RTCRtpTransceiver/setCodecPreferences">RTCRtpTransceiver.setCodecPreferences</a>.';
    return;
  }

  const codecs = RTCRtpSender.getCapabilities('video').codecs;
  codecs.forEach(codec => {
    if (['video/red', 'video/ulpfec', 'video/rtx'].includes(codec.mimeType)) {
      return;
    }
    const option = document.createElement('option');
    option.value = (codec.mimeType + ' ' + (codec.sdpFmtpLine || '')).trim();
    option.innerText = option.value;
    codecPreferences.appendChild(option);
  });
  codecPreferences.disabled = false;
}

/** @type {RTCStatsReport} */
let lastStats;
/** @type {number} */
let intervalId;

function showStatsMessage() {
  intervalId = setInterval(async () => {
    if (renderstreaming == null) {
      return;
    }

    const stats = await renderstreaming.getStats();
    if (stats == null) {
      return;
    }

    const array = createDisplayStringArray(stats, lastStats);
    if (array.length) {
      messageDiv.style.display = 'block';
      messageDiv.innerHTML = array.join('<br>');
    }
    lastStats = stats;
  }, 1000);
}

function clearStatsMessage() {
  if (intervalId) {
    clearInterval(intervalId);
  }
  lastStats = null;
  intervalId = null;
  messageDiv.style.display = 'none';
  messageDiv.innerHTML = '';
}

resetOverlayState();




