import { V1Controller } from './controllers/v1';
import { V2Controller } from './controllers/v2';
import { Player, type LoadedTrack } from './engine/player';
import { Recorder } from './engine/recorder';
import { PointerInput } from './input/pointer';
import { Library, type Album, type TrackMeta } from './library/store';
import { formatConfigTxt, formatTrackTxt, parseConfigTxt, parseTrackTxt, stemFromFilename } from './library/trackfile';
import { Stage, lookKind, type Look } from './scene/stage';
import { Split, MODEL_MB, decodeForModel } from './separate/separate';
import { ARMS, STEMS, type Arm, type Command, type Controller, type Stem } from './spec/common';
import { V1 } from './spec/v1';
import { HELP_COMMON, HELP_V1, HELP_V2 } from './ui/help';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const ALBUMS: Album[] = ['demo', 'custom', 'recordings'];
const ALBUM_NAME: Record<Album, string> = { demo: 'Demo', custom: 'Your music', recordings: 'Recordings' };
const store = {
  get(k: string) {
    try {
      return localStorage.getItem('stem.' + k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string) {
    try {
      localStorage.setItem('stem.' + k, v);
    } catch {
      /* private window */
    }
  },
};
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export class App {
  static async start() {
    const app = new App();
    await app.init();
    if (location.search.includes('debug')) (window as never as { __sp: App }).__sp = app;
    return app;
  }

  ctx = new AudioContext({ sampleRate: 44100, latencyHint: 'interactive' });
  player = new Player(this.ctx);
  lib = new Library(this.ctx);
  stage = new Stage($<HTMLCanvasElement>('stage'));
  recorder = new Recorder(this.ctx, this.player.tap);
  v1 = new V1Controller((c) => this.run(c));
  v2 = new V2Controller((c) => this.run(c));
  input: PointerInput;
  album: Album = 'demo';
  index = 0;
  partnerIndex = 0;
  volume = 0.75;
  private meta: TrackMeta | null = null;
  private loadToken = 0;
  private lastMenu = '';
  private captionTimer = 0;
  private aux: MediaStreamAudioSourceNode | null = null;
  private auxStream: MediaStream | null = null;
  private chargeState: 'off' | 'charging' | 'reverse' = 'off';
  private keyHeld = new Set<string>();
  private keyLevel: Partial<Record<Arm, number>> = {};
  private split = new Split();
  private lastFrame = performance.now();
  private batteryAt = 0;
  private splitting = false;

  constructor() {
    this.input = new PointerInput($('stage'), this.stage, () => this.controller);
    this.input.onTouch = () => this.ctx.resume();
    this.input.onPort = (id) => (id === 'aux' ? this.toggleAux() : this.cycleCharge());
    this.input.onLatch = (h) => h.length && this.caption(`Holding ${h.join(' + ')}`);
  }

  get kind() {
    return lookKind(this.stage.look);
  }
  get controller(): Controller {
    return this.kind === 'v2' ? this.v2 : this.v1;
  }

  async init() {
    await this.player.init();
    await this.lib.init();
    this.player.onEnded = () => this.ended();
    const b = parseFloat(store.get('battery') ?? '');
    this.v2.battery = Number.isFinite(b) ? b : 0.8;
    this.v2.muteOnClick = store.get('muteClick') === '1';
    const q = new URLSearchParams(location.search);
    const look = (q.get('look') as Look) ?? (store.get('look') as Look) ?? 'tan';
    this.bindUi();
    this.setLook(['tan', 'bao', 'clear', 'v2'].includes(look) ? look : 'tan');
    if (q.get('view') === 'flat') this.stage.view('flat', true);
    this.pressPower(this.v1);
    this.pressPower(this.v2);
    $('caption').classList.remove('on');
    requestAnimationFrame((t) => this.frame(t));
    await this.loadCurrent();
    if (this.lib.custom.length && !q.has('debug')) {
      this.album = 'custom';
      this.index = 0;
      await this.loadCurrent();
    }
  }

  private pressPower(c: Controller) {
    const t = performance.now();
    c.down('power', t);
    c.up('power', t);
  }

  // Commands from the two controllers.
  private run(c: Command) {
    const p = this.player;
    switch (c.t) {
      case 'play':
        this.ctx.resume();
        p.play();
        this.caption('Play');
        break;
      case 'pause':
        p.pause();
        if (this.controller.powered) this.caption('Pause');
        break;
      case 'stemGains': {
        const floor = V1.config.minVolumeDb;
        const gains = {} as Record<Stem, number>;
        for (const s of STEMS) gains[s] = c.gains[s] > 0 ? Math.pow(10, (floor * (1 - c.gains[s])) / 20) : 0;
        p.setStemGains(gains, V1.config.isolationRampMs);
        break;
      }
      case 'speed':
        p.setRate(c.rate);
        this.caption(
          c.rate === 1
            ? 'Normal speed'
            : `${c.rate < 0 ? 'Reverse ' : ''}${Math.round(Math.abs(c.rate) * 100)} % speed`,
        );
        break;
      case 'pitch':
        p.setPitch(c.semitones);
        this.caption(c.semitones === 0 ? 'Normal pitch' : `Pitch ${c.semitones > 0 ? '+' : ''}${c.semitones}`);
        break;
      case 'scratch':
        p.scratch();
        this.caption('Record scratch');
        break;
      case 'loop':
        p.setLoop(c.beats);
        this.caption(
          c.beats === null ? 'Loop off' : this.kind === 'v2' ? `${c.beats} beat loop` : `${c.beats / 4} bar loop`,
        );
        break;
      case 'slipLoop':
        p.setSlip(c.beats);
        this.caption(c.beats === null ? 'Slip released' : `${c.beats} beat slip loop`);
        break;
      case 'nudgeLoop':
        p.nudgeLoop(c.dir);
        this.caption(c.dir > 0 ? 'Loop moved forward' : 'Loop moved back');
        break;
      case 'effect':
        p.setEffect(c.index, c.amount);
        this.caption(`${V1.effects[c.index]} ${Math.round(c.amount * 100)} %`);
        break;
      case 'clearEffects':
        p.clearEffects();
        break;
      case 'track':
        if (c.transition && p.partner && this.partnerIndex !== this.index) this.startTransition();
        else this.step(c.dir);
        break;
      case 'seek':
        p.seek(c.seconds);
        break;
      case 'volume':
        this.volume = Math.max(0, Math.min(1, this.volume + c.delta));
        this.applyVolume();
        this.caption(`Volume ${Math.round(this.volume * 100)} %`);
        break;
      case 'album': {
        const i = ALBUMS.indexOf(this.album);
        this.album = ALBUMS[(i + 1) % 3];
        this.index = 0;
        this.caption(ALBUM_NAME[this.album]);
        this.loadCurrent();
        break;
      }
      case 'record':
        this.record(c.on);
        break;
      case 'pair':
        this.caption('Pairing');
        this.pair();
        break;
      case 'link':
        this.caption(c.on ? 'Connected' : 'Disconnected');
        break;
      case 'manage':
        this.openManage();
        break;
      case 'power':
        this.caption(c.on ? 'On' : 'Off');
        break;
      case 'stemSource':
        if (!p.partner) {
          this.caption('Add a second song to mix');
          return;
        }
        p.swapStem(c.stem, c.swapped);
        this.caption(`${c.stem === 'other' ? 'melody' : c.stem} ${c.swapped ? 'switched' : 'reverted'}`);
        break;
      case 'mixPartner':
        this.movePartner(c.dir);
        break;
      case 'split':
        this.openManage();
        $<HTMLInputElement>('file-input').focus();
        this.caption('Add a song to split');
        break;
      case 'factoryReset':
        this.factoryReset();
        break;
    }
  }

  private applyVolume() {
    const gain = Math.pow(10, (this.meta?.gainDb ?? 0) / 20);
    this.player.setVolume(this.volume * gain);
  }

  // Tracks.
  private list() {
    const l = this.lib.tracks(this.album);
    if (this.album !== 'recordings' || !l.length) return l;
    const all: TrackMeta = {
      id: 'all-recordings',
      album: 'recordings',
      title: 'All recordings',
      bpm: 120,
      colours: l[0].colours,
    };
    return [...l, all];
  }

  private step(dir: -1 | 1) {
    const n = this.list().length;
    if (!n) return;
    this.index = (this.index + dir + n) % n;
    this.loadCurrent();
  }

  private ended() {
    this.step(1);
  }

  async loadCurrent(keepPlaying = this.player.playing) {
    const token = ++this.loadToken;
    const list = this.list();
    const meta = list[this.index];
    if (!meta) {
      this.player.dispose();
      this.player.playing = false;
      this.meta = null;
      this.updateNow();
      $('title').textContent = this.album === 'recordings' ? 'No recordings yet' : 'No songs yet: open Library';
      return;
    }
    $('title').textContent = meta.title;
    $('album').textContent = ALBUM_NAME[this.album];
    this.setColours(meta);
    try {
      const track = meta.id === 'all-recordings' ? await this.lib.loadAllRecordings() : await this.lib.load(meta);
      if (token !== this.loadToken || !track) return;
      this.meta = meta;
      this.player.loadPartner(null);
      this.player.resetSwaps();
      this.player.load(track);
      this.applyVolume();
      if (meta.id === 'all-recordings') {
        // Newest at full volume, the others at the lowest light.
        this.v1.levels = { top: 4, right: 1, bottom: 1, left: 1 };
        this.player.setStemGains({ vocals: 1, other: 0.08, drums: 0.08, bass: 0.08 });
      } else if (this.kind === 'v1') {
        this.v1.levels = { top: 4, right: 4, bottom: 4, left: 4 };
        this.player.setStemGains({ vocals: 1, other: 1, drums: 1, bass: 1 });
      }
      if (keepPlaying) this.player.play();
      this.updateNow();
      this.partnerIndex = this.index;
      if (this.kind === 'v2') this.movePartner(1, true);
    } catch (e) {
      console.warn(e);
      this.caption('This track could not be read');
    }
  }

  private setColours(m: TrackMeta) {
    this.v1.colours = m.colours;
    this.v2.trackColour = m.colours[0];
  }

  /** Loads the song that swapped stems and transitions come from. */
  private async movePartner(dir: -1 | 1, quiet = false) {
    const l = this.lib.tracks(this.album);
    const free = l.filter((m) => m.album !== 'recordings');
    if (free.length < 2) {
      this.player.loadPartner(null);
      return;
    }
    let i = this.partnerIndex;
    do i = (i + dir + l.length) % l.length;
    while (i === this.index);
    this.partnerIndex = i;
    const token = this.loadToken;
    const track: LoadedTrack = await this.lib.load(l[i]);
    if (token !== this.loadToken) return;
    this.player.loadPartner(track);
    this.v2.partnerColour = l[i].colours[0];
    if (!quiet) this.caption(`Mix: ${l[i].title}`);
  }

  private startTransition() {
    if (this.v2.transitioning) return;
    this.v2.transitioning = true;
    const l = this.lib.tracks(this.album);
    const next = this.partnerIndex;
    const beat = 60 / (this.meta?.bpm ?? 120);
    this.caption('Transition');
    const token = ++this.loadToken;
    this.player.transition(beat * 4, () => {
      this.v2.transitioning = false;
      if (token !== this.loadToken) return;
      this.player.promotePartner();
      this.index = next;
      this.meta = l[next];
      this.setColours(l[next]);
      this.applyVolume();
      this.updateNow();
      this.caption('Transition complete');
      this.partnerIndex = next;
      this.movePartner(1, true);
    });
  }

  private updateNow() {
    $('album').textContent = ALBUM_NAME[this.album];
    if (this.meta) $('title').textContent = this.meta.title;
  }

  // Devices.
  setLook(look: Look) {
    const before = this.kind;
    if (before !== lookKind(look)) {
      this.input.reset();
      this.player.resetSwaps();
      this.player.setLoop(null);
      this.player.setStemGains({ vocals: 1, other: 1, drums: 1, bass: 1 });
      if (this.player.playing) {
        this.player.pause();
      }
      this.v1.playing = false;
      this.v2.playing = false;
      this.v1.levels = { top: 4, right: 4, bottom: 4, left: 4 };
    }
    this.stage.setLook(look);
    store.set('look', look);
    document
      .querySelectorAll<HTMLButtonElement>('[data-look]')
      .forEach((b) => b.setAttribute('aria-checked', String(b.dataset.look === look)));
    this.buildA11y();
    if (before !== lookKind(look) && lookKind(look) === 'v2') this.movePartner(1, true);
  }

  private buildA11y() {
    const box = $('a11y-controls');
    box.textContent = '';
    const items: { id: string; label: string }[] = [{ id: 'centre', label: 'Centre' }];
    if (this.kind === 'v2') {
      items.push(
        { id: 'top', label: 'Vocals point' },
        { id: 'right', label: 'Melody point' },
        { id: 'bottom', label: 'Drums point' },
        { id: 'left', label: 'Bass point' },
      );
    }
    for (const c of this.stage.shape.controls)
      if (c.id !== 'aux' && c.id !== 'usb') items.push({ id: c.id, label: c.label });
    for (const it of items) {
      const b = document.createElement('button');
      b.textContent = it.label;
      b.addEventListener('click', () => {
        this.ctx.resume();
        const t = performance.now();
        this.controller.down(it.id, t);
        setTimeout(() => this.controller.up(it.id, performance.now()), 60);
      });
      box.append(b);
    }
  }

  private async record(on: boolean) {
    if (on) {
      this.ctx.resume();
      this.recorder.start();
      this.caption('Recording started');
      return;
    }
    const r = await this.recorder.stop();
    if (!r) return;
    await this.lib.addRecording(r.blob, r.seconds, V1.config.recordSlots);
    this.caption('Recording saved');
    this.renderLists();
  }

  private async pair() {
    const media = navigator.mediaDevices as MediaDevices & { selectAudioOutput?: () => Promise<{ deviceId: string }> };
    const ctx = this.ctx as AudioContext & { setSinkId?: (id: string) => Promise<void> };
    if (media?.selectAudioOutput && ctx.setSinkId) {
      try {
        const d = await media.selectAudioOutput();
        await ctx.setSinkId(d.deviceId);
        this.caption('Connected');
      } catch {
        /* the user closed the picker */
      }
    }
  }

  private async toggleAux() {
    if (this.aux) {
      this.aux.disconnect();
      this.auxStream?.getTracks().forEach((t) => t.stop());
      this.aux = null;
      this.caption('Aux in off');
      return;
    }
    try {
      this.ctx.resume();
      this.auxStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false },
      });
      this.aux = this.ctx.createMediaStreamSource(this.auxStream);
      this.aux.connect(this.player.master);
      this.caption('Aux in on');
    } catch {
      this.caption('No access to an audio input');
    }
  }

  private cycleCharge() {
    this.chargeState = this.chargeState === 'off' ? 'charging' : this.chargeState === 'charging' ? 'reverse' : 'off';
    this.v2.charging = this.chargeState === 'charging';
    this.caption({ off: 'USB-C unplugged', charging: 'Charging', reverse: 'Reverse charge on' }[this.chargeState]);
  }

  private async factoryReset() {
    for (const m of [...this.lib.custom, ...this.lib.recordings]) await this.lib.remove(m);
    this.album = 'demo';
    this.index = 0;
    this.caption('Reset complete');
    this.renderLists();
    this.loadCurrent(false);
  }

  private caption(t: string) {
    const el = $('caption');
    el.textContent = t;
    el.classList.add('on');
    clearTimeout(this.captionTimer);
    this.captionTimer = window.setTimeout(() => el.classList.remove('on'), 1800);
  }

  private frame(t: number) {
    requestAnimationFrame((n) => this.frame(n));
    const dt = Math.min(0.1, (t - this.lastFrame) / 1000);
    this.lastFrame = t;
    const now = performance.now();
    const c = this.controller;
    c.tick(now);
    const levels = this.player.playing ? this.player.levels() : undefined;
    const lights = c.lights(now, levels);
    this.stage.device.setLeds(lights.leds, lights.indicator);
    // The open library covers the scene during a split, and with no graphics card drawing would starve it.
    if (!(this.splitting && $<HTMLDialogElement>('manage').open)) this.stage.render(dt);

    const menu = this.kind === 'v2' ? this.v2.menu : this.v1.menu;
    if (menu !== this.lastMenu) {
      if (this.lastMenu)
        this.caption(
          {
            main: 'Main',
            loop: this.kind === 'v2' ? 'Loop menu' : 'Loop and speed',
            effects: 'Effects',
            speed: 'Speed and pitch',
          }[menu],
        );
      this.lastMenu = menu;
    }

    const p = this.player;
    $('time').textContent = this.meta
      ? `${fmt(p.position)} / ${fmt(p.duration)}  ${Math.round(this.meta.bpm)} BPM`
      : '';

    // Auto transition on the speaker, when the end of the track comes near.
    if (this.kind === 'v2' && p.playing && p.partner && !p.loop && !this.v2.transitioning && p.rate > 0) {
      const bars = 3 * 4 * p.beatSeconds;
      if (p.duration - p.position < bars + 0.5) this.startTransition();
    }

    // Simulated battery.
    if (now - this.batteryAt > 2000) {
      this.batteryAt = now;
      const v = this.v2;
      if (this.chargeState === 'charging') v.battery = Math.min(1, v.battery + 0.002);
      else if (this.chargeState === 'reverse') v.battery = Math.max(0, v.battery - 0.0006);
      else if (p.playing) v.battery = Math.max(0, v.battery - 0.0002);
      store.set('battery', v.battery.toFixed(3));
    }
  }

  // Interface around the device.
  private bindUi() {
    document
      .querySelectorAll<HTMLButtonElement>('[data-look]')
      .forEach((b) => b.addEventListener('click', () => this.setLook(b.dataset.look as Look)));
    document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((b) =>
      b.addEventListener('click', () => {
        const name = b.dataset.view!;
        const v2 = this.kind === 'v2';
        if (name === 'buttons') this.stage.view(v2 ? 135 : 50);
        else if (name === 'ports') this.stage.view(v2 ? 225 : 228);
        else this.stage.view(name as 'front' | 'back');
      }),
    );
    $('open-manage').addEventListener('click', () => this.openManage());
    $('open-help').addEventListener('click', () => {
      $('help-body').innerHTML = (this.kind === 'v2' ? HELP_V2 + HELP_V1 : HELP_V1 + HELP_V2) + HELP_COMMON;
      $<HTMLDialogElement>('help').showModal();
    });
    document.querySelectorAll('dialog').forEach((d) => {
      d.querySelector('.close')?.addEventListener('click', () => d.close());
      d.addEventListener('click', (e) => e.target === d && d.close());
    });
    $<HTMLInputElement>('file-input').addEventListener('change', (e) => this.addFiles(e.target as HTMLInputElement));
    $<HTMLInputElement>('folder-input').addEventListener('change', (e) => this.addFiles(e.target as HTMLInputElement));
    $<HTMLInputElement>('mute-click').addEventListener('change', (e) => {
      const on = (e.target as HTMLInputElement).checked;
      this.v2.muteOnClick = on;
      store.set('muteClick', on ? '1' : '0');
    });
    const cfg = $<HTMLTextAreaElement>('config');
    const saved = store.get('config');
    if (saved) this.applyConfig(saved);
    cfg.value = formatConfigTxt(V1.config);
    $('config-save').addEventListener('click', () => {
      this.applyConfig(cfg.value);
      store.set('config', cfg.value);
      this.caption('Settings applied');
    });
    $('secret').addEventListener('dblclick', () => this.openDebug());
    $<HTMLInputElement>('battery').addEventListener(
      'input',
      (e) => (this.v2.battery = +(e.target as HTMLInputElement).value / 100),
    );
    $('factory').addEventListener('click', () => {
      this.factoryReset();
      $<HTMLDialogElement>('manage').close();
    });
    document.addEventListener('keydown', (e) => this.key(e, true));
    document.addEventListener('keyup', (e) => this.key(e, false));
  }

  private applyConfig(text: string) {
    const c = parseConfigTxt(text);
    Object.assign(V1.config, c);
    const steps = V1.speedSteps as unknown as number[];
    steps[0] = V1.config.slow1;
    steps[2] = V1.config.fast1;
    steps[3] = V1.config.fast2;
  }

  private openManage() {
    this.renderLists();
    $<HTMLInputElement>('mute-click').checked = this.v2.muteOnClick;
    const d = $<HTMLDialogElement>('manage');
    if (!d.open) d.showModal();
  }

  private async openDebug() {
    const m = $('debug-menu');
    m.hidden = false;
    const est = await navigator.storage?.estimate?.();
    const pct = est?.quota ? ((est.usage ?? 0) / est.quota) * 100 : 0;
    $('debug-info').textContent =
      `OS 0.1.0, storage ${pct.toFixed(1)} % (${(await this.lib.persistent()) ? 'persistent' : 'memory only'}), battery ${Math.round(this.v2.battery * 100)} %`;
    $<HTMLInputElement>('battery').value = String(Math.round(this.v2.battery * 100));
  }

  private renderLists() {
    const songs = $('songs');
    const recs = $('recs');
    songs.textContent = '';
    recs.textContent = '';
    const line = (text: string, sub: string, acts: [string, () => void][]) => {
      const li = document.createElement('li');
      const s = document.createElement('span');
      s.textContent = text + ' ';
      const small = document.createElement('small');
      small.textContent = sub;
      s.append(small);
      const a = document.createElement('div');
      a.className = 'acts';
      for (const [label, fn] of acts) {
        const b = document.createElement('button');
        b.textContent = label;
        b.addEventListener('click', fn);
        a.append(b);
      }
      li.append(s, a);
      return li;
    };
    for (const m of this.lib.custom) {
      const li = line(m.title, `${Math.round(m.bpm)} BPM`, [
        ['Play', () => this.jump('custom', m)],
        ['Edit', () => this.editTrack(li, m)],
        ['Delete', () => this.remove(m)],
      ]);
      songs.append(li);
    }
    if (!this.lib.custom.length) songs.append(line('No songs yet', '', []));
    for (const m of this.lib.recordings) {
      recs.append(
        line(m.title, fmt(m.seconds ?? 0), [
          ['Play', () => this.jump('recordings', m)],
          ['Download', () => this.download(m)],
          ['Delete', () => this.remove(m)],
        ]),
      );
    }
    if (!this.lib.recordings.length)
      recs.append(line('No recordings yet', `Keeps the newest ${V1.config.recordSlots}`, []));
  }

  private editTrack(li: HTMLElement, m: TrackMeta) {
    if (li.querySelector('textarea')) return;
    const box = document.createElement('textarea');
    box.rows = 4;
    box.spellcheck = false;
    box.ariaLabel = `TRACK.txt for ${m.title}`;
    box.value = formatTrackTxt({ title: m.title, bpm: m.bpm, colours: m.colours, gainDb: m.gainDb });
    const save = document.createElement('button');
    save.textContent = 'Save';
    save.addEventListener('click', async () => {
      const i = parseTrackTxt(box.value);
      m.title = i.title ?? m.title;
      m.bpm = i.bpm ?? m.bpm;
      m.colours = i.colours ?? m.colours;
      m.gainDb = i.gainDb ?? m.gainDb;
      await this.lib.saveMeta(m);
      if (this.meta?.id === m.id) {
        const t = this.player.track;
        if (t) t.bpm = m.bpm;
        this.setColours(m);
        this.applyVolume();
        this.updateNow();
      }
      this.renderLists();
    });
    li.append(box, save);
  }

  private jump(album: Album, m: TrackMeta) {
    this.album = album;
    this.index = this.lib.tracks(album).indexOf(m);
    $<HTMLDialogElement>('manage').close();
    this.loadCurrent();
  }

  private async remove(m: TrackMeta) {
    const wasCurrent = this.meta?.id === m.id;
    await this.lib.remove(m);
    this.renderLists();
    if (wasCurrent || this.album === m.album) {
      this.index = Math.min(this.index, Math.max(0, this.list().length - 1));
      if (wasCurrent) this.loadCurrent();
    }
  }

  private async download(m: TrackMeta) {
    const blob = await this.lib.recordingBlob(m);
    if (!blob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${m.title}.${(m.mime ?? '').includes('ogg') ? 'ogg' : (m.mime ?? '').includes('mp4') ? 'm4a' : 'webm'}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  private async addFiles(input: HTMLInputElement) {
    const files = [...(input.files ?? [])];
    input.value = '';
    if (!files.length) return;
    const trackTxt = files.find((f) => /^track\.txt$/i.test(f.name));
    const info = trackTxt ? parseTrackTxt(await trackTxt.text()) : {};
    const audio = files.filter((f) => !/\.txt$/i.test(f.name) && !f.name.startsWith('.'));
    const by = new Map<Stem, File>();
    for (const f of audio) {
      const s = stemFromFilename(f.name);
      if (s && !by.has(s)) by.set(s, f);
    }
    try {
      if (by.size === 4 && audio.length === 4) {
        const folder = (files[0] as File & { webkitRelativePath?: string }).webkitRelativePath?.split('/')[0];
        const title = info.title ?? (folder || `Stems ${this.lib.custom.length + 1}`);
        const m = await this.lib.addFromFiles(title, Object.fromEntries(by) as Record<Stem, File>, {
          bpm: info.bpm,
          colours: info.colours,
          gainDb: info.gainDb,
        });
        this.caption('Added');
        this.renderLists();
        this.jumpIfEmpty(m);
        return;
      }
      for (const f of audio) await this.splitFile(f, info.title);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg !== 'Cancelled') this.setSplit(`Could not add this: ${msg}`, 0);
    }
  }

  private jumpIfEmpty(m: TrackMeta) {
    if (this.album !== 'custom') {
      this.album = 'custom';
      this.index = this.lib.custom.indexOf(m);
      this.loadCurrent();
    }
  }

  private setSplit(text: string, value: number) {
    $('split').hidden = false;
    $('split-text').textContent = text;
    $<HTMLProgressElement>('split-bar').value = value;
  }

  private async modelCached() {
    try {
      const r = await navigator.storage.getDirectory();
      const d = await r.getDirectoryHandle('models');
      const f = await (await d.getFileHandle('htdemucs_embedded.onnx')).getFile();
      return f.size > 100e6;
    } catch {
      return false;
    }
  }

  private async splitFile(file: File, title?: string) {
    const name = title ?? file.name.replace(/\.[^.]+$/, '');
    const go = $('split-go');
    const cancel = $('split-cancel');
    if (!(await this.modelCached())) {
      this.setSplit(
        `Splitting uses a ${MODEL_MB} MB model. It downloads once from Hugging Face and stays in this browser. Your music never leaves this computer.`,
        0,
      );
      go.hidden = false;
      const ok = await new Promise<boolean>((res) => {
        go.onclick = () => res(true);
        cancel.onclick = () => res(false);
      });
      go.hidden = true;
      if (!ok) {
        $('split').hidden = true;
        return;
      }
    }
    let m: TrackMeta;
    this.splitting = true;
    try {
      this.setSplit(`Reading ${name}`, 0);
      let aborted = false;
      cancel.onclick = () => {
        aborted = true;
        this.split.cancel();
        $('split').hidden = true;
      };
      const input = await decodeForModel(file);
      if (aborted) return;
      const r = await this.split.run(input, (p) => {
        const pct = Math.round(p.value * 100);
        if (p.stage === 'download') this.setSplit(`Downloading model: ${pct} %`, p.value);
        else if (p.stage === 'prepare') this.setSplit('Preparing the model', 0);
        else
          this.setSplit(
            `Splitting ${name}: ${pct} % (${p.provider === 'webgpu' ? 'graphics card' : 'processor, slower'})`,
            p.value,
          );
      });
      this.setSplit('Saving stems', 1);
      m = await this.lib.addFromChannels(name, r.stems, r.sampleRate);
    } finally {
      this.splitting = false;
    }
    $('split').hidden = true;
    this.caption('Song added');
    this.renderLists();
    this.jumpIfEmpty(m);
  }

  private key(e: KeyboardEvent, down: boolean) {
    if ((e.target as HTMLElement).closest('input, textarea, dialog')) return;
    if (down) this.ctx.resume();
    const c = this.controller;
    const now = performance.now();
    const map: Record<string, string> = {
      ' ': 'centre',
      p: 'power',
      '=': 'plus',
      '+': 'plus',
      '-': 'minus',
      '[': 'prev',
      ']': 'next',
      b: 'bt',
      f: 'fm',
    };
    const arrows: Record<string, Arm> = { ArrowUp: 'top', ArrowRight: 'right', ArrowDown: 'bottom', ArrowLeft: 'left' };
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (k === 'l' && down && !e.metaKey && !e.ctrlKey) {
      this.openManage();
      return;
    }
    const id = map[k];
    if (id) {
      if (id === 'bt' || id === 'fm') {
        if (this.kind !== 'v2') return;
      }
      e.preventDefault();
      if (down) {
        if (!e.repeat) c.down(id, now);
      } else c.up(id, now);
      return;
    }
    const arm = arrows[k];
    if (!arm) return;
    e.preventDefault();
    if (this.kind === 'v2') {
      if (down) {
        if (!e.repeat) c.down(arm, now);
      } else c.up(arm, now);
      return;
    }
    const pointer = 1000 + ARMS.indexOf(arm);
    if (down) {
      if (e.repeat) return;
      this.keyHeld.add(k);
      if (e.shiftKey) {
        c.slide?.(arm, pointer, 0.99, now);
      } else {
        // Each press steps one light down, wrapping back to full.
        const lvl = this.keyLevel[arm] ?? 4;
        const nextLvl = lvl === 0 ? 4 : lvl - 1;
        this.keyLevel[arm] = nextLvl;
        c.slide?.(arm, pointer, nextLvl === 0 ? 0 : (nextLvl - 0.5) / 4, now);
      }
    } else if (this.keyHeld.delete(k)) c.slideEnd?.(arm, pointer, now);
  }
}
