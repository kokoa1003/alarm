const STORAGE_KEY = 'alarms';
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
const SOUND_OPTIONS = [
  { id: 'bell', name: 'Bell', frequency: 880, url: '' },
  { id: 'chime', name: 'Chime', frequency: 1175, url: '' },
  { id: 'digital', name: 'Digital', frequency: 660, url: '' }
];

const elements = {
  alarmList: document.getElementById('alarmList'),
  emptyState: document.getElementById('emptyState'),
  addAlarmButton: document.getElementById('addAlarmButton'),
  alarmFormDialog: document.getElementById('alarmFormDialog'),
  alarmForm: document.getElementById('alarmForm'),
  formTitle: document.getElementById('formTitle'),
  timeInput: document.getElementById('timeInput'),
  labelInput: document.getElementById('labelInput'),
  daysContainer: document.getElementById('daysContainer'),
  soundSelect: document.getElementById('soundSelect'),
  enabledInput: document.getElementById('enabledInput'),
  cancelButton: document.getElementById('cancelButton'),
  deleteButton: document.getElementById('deleteButton'),
  ringOverlay: document.getElementById('ringOverlay'),
  ringTime: document.getElementById('ringTime'),
  ringLabel: document.getElementById('ringLabel'),
  stopAlarmButton: document.getElementById('stopAlarmButton'),
  unlockAudioButton: document.getElementById('unlockAudioButton')
};

let alarms = loadAlarms();
let editingAlarmId = null;
let activeRing = null;
let tickLock = '';
let audioUnlocked = false;
let pendingAlarm = null;

function init() {
  prepareSoundSources();
  buildDaysSelector();
  buildSoundSelector();
  renderAlarms();
  bindEvents();
  setInterval(checkAlarms, 1000);
}

function prepareSoundSources() {
  SOUND_OPTIONS.forEach((sound) => {
    sound.url = createToneWavUrl(sound.frequency);
  });
}

function createToneWavUrl(frequency) {
  const sampleRate = 44100;
  const durationSec = 0.45;
  const frameCount = Math.floor(sampleRate * durationSec);
  const dataSize = frameCount * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  for (let i = 0; i < frameCount; i += 1) {
    const t = i / sampleRate;
    const attack = Math.min(i / (sampleRate * 0.02), 1);
    const release = Math.min((frameCount - i) / (sampleRate * 0.05), 1);
    const envelope = attack * release;
    const sample = Math.sin(2 * Math.PI * frequency * t) * 0.4 * envelope;
    view.setInt16(44 + i * 2, Math.floor(sample * 32767), true);
  }

  const blob = new Blob([buffer], { type: 'audio/wav' });
  return URL.createObjectURL(blob);
}

function writeAscii(view, offset, text) {
  for (let i = 0; i < text.length; i += 1) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}

function bindEvents() {
  elements.addAlarmButton.addEventListener('click', openCreateDialog);
  elements.cancelButton.addEventListener('click', () => elements.alarmFormDialog.close());
  elements.alarmForm.addEventListener('submit', onSubmitAlarm);
  elements.deleteButton.addEventListener('click', onDeleteAlarm);
  elements.stopAlarmButton.addEventListener('click', stopActiveAlarm);
  elements.unlockAudioButton.addEventListener('click', unlockAudio);
}

function buildDaysSelector() {
  elements.daysContainer.innerHTML = '';
  WEEKDAYS.forEach((day, index) => {
    const label = document.createElement('label');
    label.className = 'day-chip';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = String(index);
    checkbox.dataset.day = String(index);
    label.append(checkbox, day);
    elements.daysContainer.append(label);
  });
}

function buildSoundSelector() {
  SOUND_OPTIONS.forEach((sound) => {
    const option = document.createElement('option');
    option.value = sound.id;
    option.textContent = sound.name;
    elements.soundSelect.append(option);
  });
}

function openCreateDialog() {
  editingAlarmId = null;
  elements.formTitle.textContent = 'アラーム作成';
  elements.deleteButton.classList.add('hidden');
  elements.timeInput.value = '07:00';
  elements.labelInput.value = '';
  elements.enabledInput.checked = true;
  elements.soundSelect.value = SOUND_OPTIONS[0].id;
  setSelectedDays([1, 2, 3, 4, 5]);
  elements.alarmFormDialog.showModal();
}

function openEditDialog(alarmId) {
  const alarm = alarms.find((item) => item.id === alarmId);
  if (!alarm) {
    return;
  }
  editingAlarmId = alarmId;
  elements.formTitle.textContent = 'アラーム編集';
  elements.deleteButton.classList.remove('hidden');
  elements.timeInput.value = alarm.time;
  elements.labelInput.value = alarm.label;
  elements.enabledInput.checked = alarm.enabled;
  elements.soundSelect.value = alarm.sound;
  setSelectedDays(alarm.days);
  elements.alarmFormDialog.showModal();
}

function onSubmitAlarm(event) {
  event.preventDefault();
  const days = getSelectedDays();
  const payload = {
    id: editingAlarmId ?? crypto.randomUUID(),
    time: elements.timeInput.value,
    label: elements.labelInput.value.trim() || 'アラーム',
    days,
    sound: elements.soundSelect.value,
    enabled: elements.enabledInput.checked
  };

  if (!payload.time) {
    return;
  }

  if (editingAlarmId) {
    alarms = alarms.map((alarm) => (alarm.id === editingAlarmId ? payload : alarm));
  } else {
    alarms.push(payload);
  }

  persistAlarms();
  renderAlarms();
  elements.alarmFormDialog.close();
}

function onDeleteAlarm() {
  if (!editingAlarmId) {
    return;
  }
  alarms = alarms.filter((alarm) => alarm.id !== editingAlarmId);
  persistAlarms();
  renderAlarms();
  elements.alarmFormDialog.close();
}

function renderAlarms() {
  elements.alarmList.innerHTML = '';
  elements.emptyState.classList.toggle('hidden', alarms.length !== 0);

  alarms
    .slice()
    .sort((a, b) => a.time.localeCompare(b.time))
    .forEach((alarm) => {
      const item = document.createElement('li');
      item.className = 'alarm-item';

      const mainButton = document.createElement('button');
      mainButton.className = 'alarm-main';
      mainButton.type = 'button';
      mainButton.addEventListener('click', () => openEditDialog(alarm.id));

      const time = document.createElement('div');
      time.className = 'alarm-time';
      time.textContent = alarm.time;

      const meta = document.createElement('div');
      meta.className = 'alarm-meta';
      meta.textContent = `${alarm.label} / ${formatDays(alarm.days)} / ${alarm.sound}`;

      mainButton.append(time, meta);

      const toggle = document.createElement('input');
      toggle.type = 'checkbox';
      toggle.checked = alarm.enabled;
      toggle.addEventListener('change', () => {
        alarm.enabled = toggle.checked;
        persistAlarms();
      });

      item.append(mainButton, toggle);
      elements.alarmList.append(item);
    });
}

function checkAlarms() {
  if (activeRing) {
    return;
  }

  const now = new Date();
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const today = now.getDay();

  const minuteKey = `${today}-${hhmm}`;
  if (tickLock === minuteKey) {
    return;
  }
  tickLock = minuteKey;

  const matched = alarms.find((alarm) => alarm.enabled && alarm.time === hhmm && alarm.days.includes(today));
  if (!matched) {
    return;
  }

  triggerAlarm(matched);
}

function triggerAlarm(alarm) {
  pendingAlarm = alarm;
  elements.ringTime.textContent = alarm.time;
  elements.ringLabel.textContent = alarm.label;
  elements.ringOverlay.classList.remove('hidden');

  if (!audioUnlocked) {
    elements.unlockAudioButton.textContent = '音声を有効化して再生';
    elements.unlockAudioButton.classList.remove('hidden');
    return;
  }
  startAlarmSound(alarm);
}

function startAlarmSound(alarm) {
  const sound = SOUND_OPTIONS.find((item) => item.id === alarm.sound) ?? SOUND_OPTIONS[0];
  const audio = new Audio(sound.url);
  audio.loop = true;
  audio.volume = 0;

  const startedAt = performance.now();
  const rampTimer = setInterval(() => {
    const elapsedSec = (performance.now() - startedAt) / 1000;
    audio.volume = Math.min(elapsedSec / 30, 1);
    if (audio.volume >= 1) {
      clearInterval(rampTimer);
    }
  }, 250);

  audio
    .play()
    .then(() => {
      activeRing = { audio, rampTimer };
      pendingAlarm = null;
    })
    .catch(() => {
      clearInterval(rampTimer);
      pendingAlarm = alarm;
      elements.unlockAudioButton.textContent = '音声を有効化して再生';
      elements.unlockAudioButton.classList.remove('hidden');
    });
}

function stopActiveAlarm() {
  if (!activeRing) {
    return;
  }
  clearInterval(activeRing.rampTimer);
  activeRing.audio.pause();
  activeRing.audio.currentTime = 0;
  activeRing = null;
  pendingAlarm = null;
  elements.ringOverlay.classList.add('hidden');
  elements.unlockAudioButton.textContent = '音声を有効化';
  elements.unlockAudioButton.classList.add('hidden');
}

function unlockAudio() {
  const sample = new Audio(SOUND_OPTIONS[0].url);
  sample.volume = 0;
  sample
    .play()
    .then(() => {
      sample.pause();
      sample.currentTime = 0;
      audioUnlocked = true;
      if (pendingAlarm) {
        startAlarmSound(pendingAlarm);
      } else {
        elements.unlockAudioButton.classList.add('hidden');
      }
    })
    .catch(() => {
      audioUnlocked = false;
      alert('ブラウザの仕様により音が有効化できませんでした。再度タップしてください。');
    });
}

function loadAlarms() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed;
  } catch {
    return [];
  }
}

function persistAlarms() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(alarms));
}

function getSelectedDays() {
  return Array.from(elements.daysContainer.querySelectorAll('input[type="checkbox"]:checked'), (input) => Number(input.value));
}

function setSelectedDays(days) {
  const daySet = new Set(days);
  elements.daysContainer.querySelectorAll('input[type="checkbox"]').forEach((input) => {
    input.checked = daySet.has(Number(input.value));
  });
}

function formatDays(days) {
  if (!days.length || days.length === 7) {
    return '毎日';
  }
  return days
    .slice()
    .sort((a, b) => a - b)
    .map((day) => WEEKDAYS[day])
    .join('');
}

init();
